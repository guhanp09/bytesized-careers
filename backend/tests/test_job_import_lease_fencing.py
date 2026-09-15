"""An old attempt must never release a newer attempt's durable ownership."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from app.models import JobImportDraft, JobImportSource, User
from app.repositories.job_import_repository import JobImportRepository
from app.services.job_import_processing_service import (
    JobImportProcessingService,
    _processing_worker_id,
)


@pytest.fixture
async def leased_import(db_session):
    owner = User(email=f"lease-fence-{uuid4().hex}@example.test")
    db_session.add(owner)
    await db_session.flush()
    source = JobImportSource(
        owner_user_id=owner.id,
        source_type="pasted_text",
        original_text="Video editor wanted.",
        content_fingerprint=uuid4().hex,
    )
    db_session.add(source)
    await db_session.flush()
    draft = JobImportDraft(
        owner_user_id=owner.id,
        source_id=source.id,
        target_listing_schema_version=3,
        processing_status="processing",
        processing_attempts=2,
        processing_worker_id="request-new-owner",
        processing_lease_expires_at=datetime.now(UTC) + timedelta(minutes=5),
    )
    db_session.add(draft)
    await db_session.commit()
    return draft


async def test_failure_cleanup_cannot_clear_a_lease_reclaimed_after_failure_commit(
    db_session, leased_import
):
    draft = leased_import
    old_attempt = uuid4()

    async def failure_committed_before_takeover(*args, **kwargs):
        assert kwargs["expected_processing_attempt_id"] == old_attempt
        # Represent the interleaving after the old failure's commit and before
        # its cleanup: a new claimant already owns the row in leased_import.
        return draft

    import_service = SimpleNamespace(
        repository=JobImportRepository(db_session),
        mark_processing_failed=failure_committed_before_takeover,
    )
    processing = JobImportProcessingService(import_service, provider=None)
    original_deadline = draft.processing_lease_expires_at
    await processing._mark_failed_if_current(
        draft.id,
        owner_user_id=draft.owner_user_id,
        processing_attempt_id=old_attempt,
        error_code="JOB_IMPORT_PROVIDER_FAILED",
        message="Draft preparation failed.",
        provider_audit=None,
    )
    await db_session.refresh(draft)
    assert draft.processing_worker_id == "request-new-owner"
    assert draft.processing_lease_expires_at.replace(tzinfo=UTC) == original_deadline
    assert draft.processing_attempts == 2
    assert draft.processing_next_attempt_at is None


@pytest.mark.parametrize("retry", [False, True])
@pytest.mark.parametrize("owns_lease", [False, True])
async def test_both_cleanup_paths_release_only_the_exact_attempt(
    db_session, leased_import, retry, owns_lease
):
    draft = leased_import
    attempt = UUID("12345678-1234-4000-8000-000000000001")
    other = UUID("12345678-1234-4000-8000-000000000002")
    # These used to share the abbreviated worker ID. Even that near-collision
    # must not grant the old attempt authority over a new lease.
    original_worker = _processing_worker_id(attempt if owns_lease else other)
    draft.processing_worker_id = original_worker
    await db_session.commit()
    original_deadline = draft.processing_lease_expires_at
    processing = JobImportProcessingService(
        SimpleNamespace(repository=JobImportRepository(db_session)), provider=None
    )
    await processing._release_lease(
        draft.id, processing_attempt_id=attempt, retry=retry
    )
    await db_session.refresh(draft)
    if owns_lease:
        assert draft.processing_worker_id is None
        assert draft.processing_lease_expires_at is None
        assert (draft.processing_next_attempt_at is not None) == retry
    else:
        assert draft.processing_worker_id == original_worker
        assert draft.processing_lease_expires_at.replace(tzinfo=UTC) == original_deadline
        assert draft.processing_next_attempt_at is None
    assert draft.processing_attempts == 2
