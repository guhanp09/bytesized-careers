"""Recording that someone agreed, and answering what they still owe.

Two operations, and the interesting decisions are both about honesty rather than
mechanism.

Recording is idempotent by construction, not by checking first. A client that
retries an accept must produce one agreement, and "select, then insert if
absent" is a race that produces two rows or an integrity error under exactly the
double-click this is meant to survive.

Asking what is outstanding compares against the CURRENT version. Someone who
accepted last year's terms is treated identically to someone who never accepted
anything, because the alternative is a change to the terms taking effect without
anyone agreeing to it.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.legal_documents import current_version, outstanding_documents
from app.models.legal_acceptance import LegalAcceptance


async def record_acceptance(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    document_key: str,
    version: str | None = None,
    now: datetime | None = None,
) -> str:
    """Record agreement to one document, once.

    The version defaults to the current one and is validated either way, so a
    caller cannot record agreement to a version this build has never heard of —
    such a row would be indistinguishable from a real acceptance while
    describing wording nobody can produce.
    """

    # Raises for an unknown document whether or not a version was supplied, so a
    # typo cannot create an acceptance that looks real and describes wording
    # nobody can produce.
    accepted_version = version or current_version(document_key)

    values = {
        "id": uuid.uuid4(),
        "user_id": user_id,
        "document_key": document_key,
        "version": accepted_version,
        "accepted_at": now or datetime.now(UTC),
    }
    dialect = session.bind.dialect.name if session.bind is not None else ""
    insert = postgresql_insert if dialect == "postgresql" else sqlite_insert
    await session.execute(
        insert(LegalAcceptance)
        .values(**values)
        .on_conflict_do_nothing(
            index_elements=["user_id", "document_key", "version"]
        )
    )
    return accepted_version


async def accepted_versions(
    session: AsyncSession, user_id: uuid.UUID
) -> dict[str, str]:
    """The latest version this person accepted, per document.

    "Latest" by accepted_at rather than by string comparison: versions are dates
    today and could stop being dates tomorrow, and an ordering rule that depends
    on the format silently breaks when the format changes.
    """

    rows = await session.execute(
        select(LegalAcceptance)
        .where(LegalAcceptance.user_id == user_id)
        .order_by(LegalAcceptance.accepted_at)
    )
    latest: dict[str, str] = {}
    for row in rows.scalars():
        latest[row.document_key] = row.version
    return latest


async def documents_awaiting_acceptance(
    session: AsyncSession, user_id: uuid.UUID
) -> tuple[str, ...]:
    """What this person must accept before continuing."""

    return outstanding_documents(await accepted_versions(session, user_id))
