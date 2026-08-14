from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Select, and_, delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.oauth_credentials import OAuthCredentialValues
from app.models import (
    EmailVerificationToken,
    HiringIdentity,
    Job,
    OAuthAccount,
    PasswordResetToken,
    PortfolioItem,
    Role,
    RoleQuestion,
    RoleQuestionOption,
    TalentListing,
    User,
    UserContentStyle,
    UsernameHistory,
    UserRole,
    UserRoleAnswer,
    UserYouTubeChannel,
    YouTubeChannel,
)
from app.services.oauth_credential_storage import OAuthCredentialStorage


class OAuthAccountCollisionError(Exception):
    """A provider identity is already linked through a different account path."""


class AuthRepository:
    def __init__(
        self,
        session: AsyncSession,
        oauth_credential_storage: OAuthCredentialStorage | None = None,
    ):
        self.session = session
        # Direct repository construction is common in isolated domain tests.
        # Application requests inject the configured storage policy in deps.py;
        # this fallback preserves local/test behavior without inventing a key.
        self.oauth_credential_storage = (
            oauth_credential_storage or OAuthCredentialStorage.plaintext_compatibility()
        )

    async def get_user_by_email(self, email: str) -> User | None:
        stmt: Select[tuple[User]] = select(User).where(User.email == email)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_user_by_username(self, username: str) -> User | None:
        stmt: Select[tuple[User]] = select(User).where(User.username == username)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_user_by_id(self, user_id: UUID) -> User | None:
        stmt: Select[tuple[User]] = select(User).where(User.id == user_id)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def create_user(
        self,
        *,
        email: str,
        password_hash: str | None,
        username: str | None = None,
        display_name: str | None = None,
        email_verified_at: datetime | None = None,
        account_type: str = "TALENT",
        account_type_selected_at: datetime | None = None,
        onboarding_intent: str = "DECIDE_LATER",
        onboarding_intent_selected_at: datetime | None = None,
    ) -> User:
        user = User(
            email=email,
            username=username,
            display_name=display_name,
            password_hash=password_hash,
            email_verified_at=email_verified_at,
            account_type=account_type,
            account_type_selected_at=account_type_selected_at,
            onboarding_intent=onboarding_intent,
            onboarding_intent_selected_at=onboarding_intent_selected_at,
        )
        self.session.add(user)
        await self.session.flush()
        await self.session.refresh(user)
        return user

    async def create_email_verification_token(
        self,
        *,
        user_id: UUID,
        token: str,
        expires_at: datetime,
    ) -> EmailVerificationToken:
        row = EmailVerificationToken(user_id=user_id, token=token, expires_at=expires_at)
        self.session.add(row)
        await self.session.flush()
        await self.session.refresh(row)
        return row

    async def get_email_verification_token(self, token: str) -> EmailVerificationToken | None:
        stmt: Select[tuple[EmailVerificationToken]] = select(EmailVerificationToken).where(
            EmailVerificationToken.token == token
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_latest_email_verification_token_for_user(
        self, *, user_id: UUID
    ) -> EmailVerificationToken | None:
        stmt: Select[tuple[EmailVerificationToken]] = (
            select(EmailVerificationToken)
            .where(EmailVerificationToken.user_id == user_id)
            .order_by(EmailVerificationToken.created_at.desc())
            .limit(1)
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def invalidate_unused_email_verification_tokens_for_user(
        self, *, user_id: UUID, used_at: datetime
    ) -> None:
        stmt = (
            update(EmailVerificationToken)
            .where(
                EmailVerificationToken.user_id == user_id,
                EmailVerificationToken.used_at.is_(None),
            )
            .values(used_at=used_at)
        )
        await self.session.execute(stmt)

    async def create_password_reset_token(
        self,
        *,
        user_id: UUID,
        token: str,
        expires_at: datetime,
    ) -> PasswordResetToken:
        row = PasswordResetToken(user_id=user_id, token=token, expires_at=expires_at)
        self.session.add(row)
        await self.session.flush()
        await self.session.refresh(row)
        return row

    async def get_password_reset_token(self, token: str) -> PasswordResetToken | None:
        stmt: Select[tuple[PasswordResetToken]] = select(PasswordResetToken).where(
            PasswordResetToken.token == token
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def invalidate_unused_password_reset_tokens_for_user(
        self, *, user_id: UUID, used_at: datetime
    ) -> None:
        stmt = (
            update(PasswordResetToken)
            .where(
                PasswordResetToken.user_id == user_id,
                PasswordResetToken.used_at.is_(None),
            )
            .values(used_at=used_at)
        )
        await self.session.execute(stmt)

    async def upsert_oauth_account(
        self,
        *,
        user_id: UUID,
        provider: str,
        provider_account_id: str,
        access_token: str | None,
        refresh_token: str | None,
        expires_at: int | None,
        scope: str | None,
    ) -> OAuthAccount:
        row = await self.get_oauth_account_by_provider_subject(
            provider=provider,
            provider_account_id=provider_account_id,
        )
        if row is None:
            existing_for_user = await self.get_oauth_account_for_user(
                user_id=user_id,
                provider=provider,
            )
            if (
                existing_for_user is not None
                and existing_for_user.provider_account_id != provider_account_id
            ):
                raise OAuthAccountCollisionError(
                    "A different Google identity is already linked to this account"
                )
            row = OAuthAccount(
                user_id=user_id,
                provider=provider,
                provider_account_id=provider_account_id,
                expires_at=expires_at,
                scope=scope,
            )
            self.oauth_credential_storage.write(
                row,
                access_token=access_token,
                refresh_token=refresh_token,
                preserve_refresh_token=False,
            )
            self.session.add(row)
            await self.session.flush()
            await self.session.refresh(row)
            return row

        if row.user_id != user_id:
            raise OAuthAccountCollisionError(
                "This Google identity is already linked to another account"
            )
        self.oauth_credential_storage.write(
            row,
            access_token=access_token,
            refresh_token=refresh_token,
        )
        row.expires_at = expires_at
        row.scope = scope
        await self.session.flush()
        await self.session.refresh(row)
        return row

    async def get_oauth_account_by_provider_subject(
        self,
        *,
        provider: str,
        provider_account_id: str,
    ) -> OAuthAccount | None:
        stmt: Select[tuple[OAuthAccount]] = select(OAuthAccount).where(
            OAuthAccount.provider == provider,
            OAuthAccount.provider_account_id == provider_account_id,
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    def get_oauth_credential_values(self, account: OAuthAccount) -> OAuthCredentialValues:
        """Return redacted-repr provider credentials through the storage policy."""

        return self.oauth_credential_storage.read(account)

    async def get_latest_oauth_account_for_user(
        self,
        *,
        user_id: UUID,
        provider: str,
    ) -> OAuthAccount | None:
        stmt: Select[tuple[OAuthAccount]] = (
            select(OAuthAccount)
            .where(OAuthAccount.user_id == user_id, OAuthAccount.provider == provider)
            .order_by(OAuthAccount.updated_at.desc())
            .limit(1)
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_oauth_account_for_user(
        self,
        *,
        user_id: UUID,
        provider: str,
    ) -> OAuthAccount | None:
        stmt: Select[tuple[OAuthAccount]] = (
            select(OAuthAccount)
            .where(OAuthAccount.user_id == user_id, OAuthAccount.provider == provider)
            .order_by(OAuthAccount.updated_at.desc())
            .limit(1)
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def upsert_youtube_channel(
        self,
        *,
        channel_id: str,
        title: str,
        thumbnail_url: str | None,
    ) -> YouTubeChannel:
        stmt: Select[tuple[YouTubeChannel]] = select(YouTubeChannel).where(
            YouTubeChannel.channel_id == channel_id
        )
        row = (await self.session.execute(stmt)).scalar_one_or_none()
        if row is None:
            row = YouTubeChannel(
                channel_id=channel_id,
                title=title,
                thumbnail_url=thumbnail_url,
            )
            self.session.add(row)
            await self.session.flush()
            await self.session.refresh(row)
            return row

        row.title = title
        row.thumbnail_url = thumbnail_url
        await self.session.flush()
        await self.session.refresh(row)
        return row

    async def ensure_user_youtube_channel_link(
        self,
        *,
        user_id: UUID,
        youtube_channel_id: UUID,
    ) -> None:
        stmt: Select[tuple[UserYouTubeChannel]] = select(UserYouTubeChannel).where(
            UserYouTubeChannel.user_id == user_id,
            UserYouTubeChannel.youtube_channel_id == youtube_channel_id,
        )
        existing = (await self.session.execute(stmt)).scalar_one_or_none()
        if existing is not None:
            return
        self.session.add(
            UserYouTubeChannel(user_id=user_id, youtube_channel_id=youtube_channel_id)
        )
        await self.session.flush()

    async def list_user_youtube_channels(self, *, user_id: UUID) -> list[YouTubeChannel]:
        stmt: Select[tuple[YouTubeChannel]] = (
            select(YouTubeChannel)
            .join(
                UserYouTubeChannel,
                UserYouTubeChannel.youtube_channel_id == YouTubeChannel.id,
            )
            .where(UserYouTubeChannel.user_id == user_id)
            .order_by(YouTubeChannel.title.asc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def list_hiring_identities_for_user(self, *, user_id: UUID) -> list[HiringIdentity]:
        stmt: Select[tuple[HiringIdentity]] = (
            select(HiringIdentity)
            .where(HiringIdentity.owner_user_id == user_id)
            .order_by(HiringIdentity.created_at.desc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_hiring_identity_for_user(
        self, *, user_id: UUID, identity_id: UUID
    ) -> HiringIdentity | None:
        stmt: Select[tuple[HiringIdentity]] = select(HiringIdentity).where(
            HiringIdentity.owner_user_id == user_id,
            HiringIdentity.id == identity_id,
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def create_hiring_identity(self, *, user_id: UUID, data: dict[str, Any]) -> HiringIdentity:
        row = HiringIdentity(owner_user_id=user_id, **data)
        self.session.add(row)
        await self.session.flush()
        await self.session.refresh(row)
        return row

    async def delete_hiring_identity(self, row: HiringIdentity) -> None:
        await self.session.delete(row)
        await self.session.flush()

    async def get_user_youtube_channel_by_channel_id(
        self, *, user_id: UUID, channel_id: str
    ) -> YouTubeChannel | None:
        stmt: Select[tuple[YouTubeChannel]] = (
            select(YouTubeChannel)
            .join(
                UserYouTubeChannel,
                UserYouTubeChannel.youtube_channel_id == YouTubeChannel.id,
            )
            .where(
                UserYouTubeChannel.user_id == user_id,
                YouTubeChannel.channel_id == channel_id,
            )
            .limit(1)
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def user_has_youtube_channel(self, *, user_id: UUID, channel_id: str) -> bool:
        stmt = (
            select(UserYouTubeChannel.user_id)
            .join(YouTubeChannel, YouTubeChannel.id == UserYouTubeChannel.youtube_channel_id)
            .where(and_(UserYouTubeChannel.user_id == user_id, YouTubeChannel.channel_id == channel_id))
            .limit(1)
        )
        return (await self.session.execute(stmt)).scalar_one_or_none() is not None

    async def create_username_history_entry(self, *, user_id: UUID, old_username: str) -> None:
        self.session.add(UsernameHistory(user_id=user_id, old_username=old_username))
        await self.session.flush()

    async def get_username_history(self, username: str) -> UsernameHistory | None:
        stmt: Select[tuple[UsernameHistory]] = select(UsernameHistory).where(
            UsernameHistory.old_username == username
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def list_portfolio_items_for_user(self, *, user_id: UUID) -> list[PortfolioItem]:
        stmt: Select[tuple[PortfolioItem]] = (
            select(PortfolioItem)
            .where(PortfolioItem.user_id == user_id)
            .order_by(PortfolioItem.created_at.desc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def list_public_portfolio_items_for_user(self, *, user_id: UUID) -> list[PortfolioItem]:
        stmt: Select[tuple[PortfolioItem]] = (
            select(PortfolioItem)
            .where(
                PortfolioItem.user_id == user_id,
                PortfolioItem.is_public.is_(True),
                PortfolioItem.publish_status == "published",
            )
            .order_by(PortfolioItem.created_at.desc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def create_portfolio_item(self, *, user_id: UUID, data: dict[str, Any]) -> PortfolioItem:
        row = PortfolioItem(user_id=user_id, **data)
        self.session.add(row)
        await self.session.flush()
        await self.session.refresh(row)
        return row

    async def get_portfolio_item_for_user(
        self, *, user_id: UUID, item_id: UUID
    ) -> PortfolioItem | None:
        stmt: Select[tuple[PortfolioItem]] = select(PortfolioItem).where(
            PortfolioItem.user_id == user_id,
            PortfolioItem.id == item_id,
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def delete_portfolio_item_for_user(self, *, user_id: UUID, item_id: UUID) -> bool:
        stmt = delete(PortfolioItem).where(
            PortfolioItem.user_id == user_id,
            PortfolioItem.id == item_id,
        )
        result = await self.session.execute(stmt)
        return bool(result.rowcount and result.rowcount > 0)

    async def list_jobs_for_user_public(self, *, user_id: UUID) -> list[Job]:
        stmt: Select[tuple[Job]] = (
            select(Job)
            .where(
                Job.posted_by_user_id == user_id,
                Job.status == "published",
                Job.deleted_at.is_(None),
            )
            .order_by(Job.created_at.desc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def list_talent_listings_for_user_public(self, *, user_id: UUID) -> list[TalentListing]:
        stmt: Select[tuple[TalentListing]] = (
            select(TalentListing)
            .where(
                TalentListing.owner_user_id == user_id,
                TalentListing.deleted_at.is_(None),
                TalentListing.status.in_(("published", "featured")),
            )
            .order_by(TalentListing.is_featured.desc(), TalentListing.created_at.desc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def count_jobs_for_user_public(self, *, user_id: UUID) -> int:
        stmt = (
            select(func.count())
            .select_from(Job)
            .where(
                Job.posted_by_user_id == user_id,
                Job.status == "published",
                Job.deleted_at.is_(None),
            )
        )
        return int((await self.session.execute(stmt)).scalar_one())

    async def list_roles(self) -> list[Role]:
        stmt: Select[tuple[Role]] = (
            select(Role)
            .where(Role.is_active.is_(True))
            .order_by(Role.popularity_score.desc(), Role.name.asc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_role_by_id(self, role_id: UUID) -> Role | None:
        stmt: Select[tuple[Role]] = select(Role).where(Role.id == role_id)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def create_role(self, *, name: str, category: str) -> Role:
        role = Role(name=name.strip(), category=category)
        self.session.add(role)
        await self.session.flush()
        return role

    async def list_role_questions_for_role(self, *, role_id: UUID) -> list[RoleQuestion]:
        stmt: Select[tuple[RoleQuestion]] = (
            select(RoleQuestion)
            .where(RoleQuestion.role_id == role_id)
            .order_by(RoleQuestion.created_at.asc(), RoleQuestion.label.asc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def list_role_questions_for_roles(self, *, role_ids: list[UUID]) -> list[RoleQuestion]:
        if not role_ids:
            return []
        stmt: Select[tuple[RoleQuestion]] = (
            select(RoleQuestion)
            .where(RoleQuestion.role_id.in_(role_ids))
            .order_by(RoleQuestion.created_at.asc(), RoleQuestion.label.asc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def list_role_questions_by_ids(self, *, question_ids: list[UUID]) -> list[RoleQuestion]:
        if not question_ids:
            return []
        stmt: Select[tuple[RoleQuestion]] = (
            select(RoleQuestion)
            .where(RoleQuestion.id.in_(question_ids))
            .order_by(RoleQuestion.created_at.asc(), RoleQuestion.label.asc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_role_question_by_id(self, *, role_question_id: UUID) -> RoleQuestion | None:
        stmt: Select[tuple[RoleQuestion]] = select(RoleQuestion).where(RoleQuestion.id == role_question_id)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def list_role_question_options_for_questions(
        self, *, question_ids: list[UUID]
    ) -> list[RoleQuestionOption]:
        if not question_ids:
            return []
        stmt: Select[tuple[RoleQuestionOption]] = (
            select(RoleQuestionOption)
            .where(RoleQuestionOption.question_id.in_(question_ids))
            .order_by(RoleQuestionOption.created_at.asc(), RoleQuestionOption.value.asc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def list_user_roles(self, *, user_id: UUID) -> list[UserRole]:
        stmt: Select[tuple[UserRole]] = (
            select(UserRole).where(UserRole.user_id == user_id).order_by(UserRole.created_at.asc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def replace_user_roles(self, *, user_id: UUID, role_ids: list[UUID]) -> None:
        await self.session.execute(delete(UserRole).where(UserRole.user_id == user_id))
        deduped_role_ids: list[UUID] = []
        seen: set[UUID] = set()
        for role_id in role_ids:
            if role_id in seen:
                continue
            seen.add(role_id)
            deduped_role_ids.append(role_id)
        for role_id in deduped_role_ids:
            self.session.add(UserRole(user_id=user_id, role_id=role_id))
        await self.session.flush()

    async def list_user_role_answers(self, *, user_id: UUID) -> list[UserRoleAnswer]:
        stmt: Select[tuple[UserRoleAnswer]] = (
            select(UserRoleAnswer)
            .where(UserRoleAnswer.user_id == user_id)
            .order_by(UserRoleAnswer.updated_at.desc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def upsert_user_role_answer(
        self, *, user_id: UUID, role_question_id: UUID, answer: Any
    ) -> UserRoleAnswer:
        stmt: Select[tuple[UserRoleAnswer]] = select(UserRoleAnswer).where(
            UserRoleAnswer.user_id == user_id,
            UserRoleAnswer.role_question_id == role_question_id,
        )
        row = (await self.session.execute(stmt)).scalar_one_or_none()
        if row is None:
            row = UserRoleAnswer(
                user_id=user_id,
                role_question_id=role_question_id,
                answer=answer,
            )
            self.session.add(row)
            await self.session.flush()
            await self.session.refresh(row)
            return row

        row.answer = answer
        await self.session.flush()
        await self.session.refresh(row)
        return row

    async def delete_user_role_answers_not_in_questions(
        self, *, user_id: UUID, question_ids: list[UUID]
    ) -> None:
        if question_ids:
            stmt = delete(UserRoleAnswer).where(
                UserRoleAnswer.user_id == user_id,
                UserRoleAnswer.role_question_id.notin_(question_ids),
            )
        else:
            stmt = delete(UserRoleAnswer).where(UserRoleAnswer.user_id == user_id)
        await self.session.execute(stmt)

    async def get_user_content_style(self, *, user_id: UUID) -> UserContentStyle | None:
        stmt: Select[tuple[UserContentStyle]] = select(UserContentStyle).where(
            UserContentStyle.user_id == user_id
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def upsert_user_content_style(self, *, user_id: UUID, data: dict[str, Any]) -> UserContentStyle:
        row = await self.get_user_content_style(user_id=user_id)
        if row is None:
            row = UserContentStyle(user_id=user_id, **data)
            self.session.add(row)
            await self.session.flush()
            await self.session.refresh(row)
            return row

        self.update_values(row, **data)
        await self.session.flush()
        await self.session.refresh(row)
        return row

    async def get_role_by_name(self, *, name: str) -> Role | None:
        stmt: Select[tuple[Role]] = select(Role).where(func.lower(Role.name) == name.lower())
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def commit(self) -> None:
        await self.session.commit()

    async def rollback(self) -> None:
        await self.session.rollback()

    @staticmethod
    def update_values(row: Any, **updates: Any) -> Any:
        for key, value in updates.items():
            setattr(row, key, value)
        return row
