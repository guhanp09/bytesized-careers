from __future__ import annotations

from datetime import UTC, datetime

from conftest import TestSessionLocal
from httpx import AsyncClient
from sqlalchemy import select

from app.models import EmailVerificationToken, Role, RoleQuestion, RoleQuestionOption, User
from app.services.youtube_service import YouTubeVideoMetadataResult


async def _latest_token_for_email(email: str) -> str:
    async with TestSessionLocal() as session:
        user = (await session.execute(select(User).where(User.email == email))).scalar_one()
        row = (
            await session.execute(
                select(EmailVerificationToken)
                .where(EmailVerificationToken.user_id == user.id)
                .order_by(EmailVerificationToken.created_at.desc())
                .limit(1)
            )
        ).scalar_one()
        return row.token


async def _register_verify_login(
    client: AsyncClient,
    *,
    email: str,
    username: str,
    password: str = "supersecure123",
) -> tuple[str, str]:
    register = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "username": username},
    )
    assert register.status_code == 200

    token = await _latest_token_for_email(email)
    verify = await client.post("/api/v1/auth/verify-email", json={"token": token})
    assert verify.status_code == 200

    login = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200
    payload = login.json()
    return payload["access_token"], payload["user"]["id"]


async def _seed_role_graph() -> tuple[str, str]:
    async with TestSessionLocal() as session:
        role = Role(
            name="Video Editor Test Seed",
            category="Production",
            description="Cuts short-form and long-form creator content.",
        )
        session.add(role)
        await session.flush()
        question = RoleQuestion(
            role_id=role.id,
            label="Primary editing format",
            help_text="Choose one",
            type="single_select",
            required=True,
        )
        session.add(question)
        await session.flush()
        session.add(
            RoleQuestionOption(
                question_id=question.id,
                value="Short-form",
            )
        )
        await session.commit()
        return str(role.id), str(question.id)


async def test_roles_answers_content_style_and_completion_flow(client: AsyncClient) -> None:
    bearer, _user_id = await _register_verify_login(
        client,
        email="phase1-owner@example.com",
        username="phase1_owner",
    )
    role_id, question_id = await _seed_role_graph()

    roles = await client.get("/api/v1/roles")
    assert roles.status_code == 200
    assert any(item["id"] == role_id for item in roles.json()["items"])

    questions = await client.get(f"/api/v1/roles/{role_id}/questions")
    assert questions.status_code == 200
    assert any(item["id"] == question_id for item in questions.json()["items"])

    save_roles = await client.post(
        "/api/v1/user/roles",
        headers={"Authorization": f"Bearer {bearer}"},
        json={"role_ids": [role_id]},
    )
    assert save_roles.status_code == 200
    assert len(save_roles.json()["items"]) == 1

    save_answers = await client.post(
        "/api/v1/user/role-answers",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "answers": [
                {"role_question_id": question_id, "answer": "Short-form"},
            ]
        },
    )
    assert save_answers.status_code == 200
    assert save_answers.json()["items"][0]["answer"] == "Short-form"

    save_content_style = await client.post(
        "/api/v1/user/content-style",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "primary_niche": "Education",
            "format": ["Shorts", "Long-form"],
            "tone": ["Educational", "Conversational"],
            "target_audience": "New creators who want retention systems",
        },
    )
    assert save_content_style.status_code == 200
    assert save_content_style.json()["primary_niche"] == "Education"

    create_portfolio = await client.post(
        "/api/v1/me/portfolio",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "title": "Retention cuts bundle",
            "description": "Phase 1 portfolio seed",
            "status": "past",
            "is_public": True,
        },
    )
    assert create_portfolio.status_code == 201

    completion = await client.get(
        "/api/v1/profile/completion",
        headers={"Authorization": f"Bearer {bearer}"},
    )
    assert completion.status_code == 200
    completion_data = completion.json()
    assert completion_data["completion_percent"] == 100
    assert completion_data["missing_required_sections"] == []


async def test_portfolio_youtube_ingest_and_listing(client: AsyncClient, monkeypatch) -> None:
    bearer, user_id = await _register_verify_login(
        client,
        email="phase1-youtube@example.com",
        username="phase1_youtube",
    )

    monkeypatch.setattr(
        "app.services.profile_service.extract_video_id",
        lambda _url: "abc123xyz12",
    )

    async def fake_fetch_youtube_video_metadata(_video_id: str) -> YouTubeVideoMetadataResult:
        return YouTubeVideoMetadataResult(
            video_id="abc123xyz12",
            title="How we edited this growth short",
            description="A public description",
            thumbnail_url="https://example.com/thumb.jpg",
            channel_name="Creator Channel",
            channel_id="UCabc",
            view_count=12000,
            like_count=500,
            comment_count=20,
            published_date=datetime.now(UTC),
            duration="8:14",
            duration_iso="PT8M14S",
            duration_label="8:14",
            thumbnail_options=[
                {"quality": "high", "url": "https://example.com/thumb.jpg", "width": 480, "height": 360}
            ],
            video_url="https://www.youtube.com/watch?v=abc123xyz12",
        )

    monkeypatch.setattr(
        "app.services.profile_service.fetch_youtube_video_metadata",
        fake_fetch_youtube_video_metadata,
    )

    create_from_youtube = await client.post(
        "/api/v1/portfolio/youtube",
        headers={"Authorization": f"Bearer {bearer}"},
        json={
            "youtube_url": "https://www.youtube.com/watch?v=abc123xyz12",
            "retention_percent": 47.5,
            "user_role_in_project": "Editor",
            "status": "past",
            "is_public": True,
        },
    )
    assert create_from_youtube.status_code == 201
    payload = create_from_youtube.json()
    assert payload["youtube_url"] == "https://www.youtube.com/watch?v=abc123xyz12"
    assert payload["retention_percent"] == 47.5
    assert payload["channel_name"] == "Creator Channel"

    listing = await client.get(f"/api/v1/portfolio/{user_id}")
    assert listing.status_code == 200
    assert len(listing.json()["items"]) >= 1
