"""No question may ask for something the page already said.

Runs every corpus source through the real pipeline with **no model output at
all**, then counts questions that ask for a fact the golden manifest says is on
the page. That count must be zero.

The empty extraction is the point. It reproduces the case that has caused every
reported complaint — a model run that timed out, came back malformed, or simply
missed a field — and proves the deterministic layer still carries the draft. If
this passes, a bad model run cannot turn into recruiter data entry.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from conftest import TestSessionLocal
from httpx import AsyncClient
from job_source_corpus import CORPUS, GoldenSource
from test_job_import_checkpoint import _auth

from app.repositories.job_import_repository import JobImportRepository
from app.repositories.job_repository import JobRepository
from app.schemas.job_import import JobImportExtractionResponse
from app.services.job_import_service import JobImportService
from app.services.job_service import JobService
from app.services.job_url_fetcher import normalize_public_job_html

_EMPTY_EXTRACTION = {
    "extraction_schema_version": 1,
    "target_listing_schema_version": 3,
    "fields": [],
    "conflicts": [],
    "missing_fields": [],
    "warnings": [],
}


async def _prepare(client: AsyncClient, source: GoldenSource) -> tuple[str, dict, str]:
    """Ingest one corpus source exactly as the product would, model output aside."""

    headers, owner_id = await _auth(client, f"corpus-{source.key.replace('_', '-')}")

    metadata: dict = {}
    if source.html is not None:
        text, page_title, metadata = normalize_public_job_html(
            source.html, final_url="https://boards.example.com/jobs/1"
        )
        title = page_title or source.title
    else:
        text = source.pasted_text or ""
        title = source.title

    created = await client.post(
        "/api/v1/job-imports/sources",
        headers=headers,
        json={
            "source_type": "pasted_text",
            "source_title": title,
            "original_text": text,
            "idempotency_key": uuid4().hex,
        },
    )
    assert created.status_code == 201, created.text
    source_id = created.json()["id"]

    if metadata:
        async with TestSessionLocal() as session:
            repository = JobImportRepository(session)
            stored = await repository.get_source_for_owner(UUID(source_id), owner_id)
            assert stored is not None
            await repository.update_source(stored, {"retrieval_metadata": metadata})
            await session.commit()

    draft = await client.post(
        f"/api/v1/job-imports/sources/{source_id}/drafts",
        headers=headers,
        json={
            "extraction_schema_version": 1,
            "target_listing_schema_version": 3,
            "idempotency_key": uuid4().hex,
        },
    )
    assert draft.status_code == 201, draft.text
    draft_id = draft.json()["id"]

    # Deliberately empty: the model contributed nothing to this draft.
    async with TestSessionLocal() as session:
        service = JobImportService(
            JobImportRepository(session), JobService(JobRepository(session))
        )
        await service.record_extraction_result(
            UUID(draft_id),
            JobImportExtractionResponse.model_validate(_EMPTY_EXTRACTION),
            owner_user_id=owner_id,
        )

    return draft_id, headers, title


async def _prepared(client: AsyncClient, draft_id: str, headers: dict) -> None:
    """Run the preparation step the product runs before showing anything.

    Deterministic derivation — title signals, pay implications, structured
    reconciliation — happens as the assistant advances, so a draft read before
    that has not been prepared yet.
    """

    begun = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
    )
    assert begun.status_code == 200, begun.text


async def _walk(client: AsyncClient, draft_id: str, headers: dict) -> list[str]:
    """Answer through the conversation, recording every field it asks about."""

    begun = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
    )
    assert begun.status_code == 200, begun.text

    asked: list[str] = []
    question = begun.json().get("active_question")
    for _ in range(30):
        if question is None:
            break
        asked.append(question["field_path"])
        shape = question.get("answer") or {}
        if shape.get("choices"):
            value: object = shape["choices"][0]
            if shape.get("is_list"):
                key = shape.get("item_key")
                value = [{key: value}] if key else [value]
        elif shape.get("kind") == "number":
            value = 5
        elif shape.get("kind") == "date":
            value = "2027-01-15"
        else:
            value = "Supplied by the source corpus run."
        answered = await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
            headers=headers,
            json={"field_path": question["field_path"], "value": value},
        )
        if answered.status_code != 200:
            break
        question = answered.json().get("active_question")
    return asked


@pytest.mark.anyio
@pytest.mark.parametrize("source", CORPUS, ids=lambda item: item.key)
async def test_no_source_known_fact_is_ever_asked_back(
    client: AsyncClient, source: GoldenSource
) -> None:
    """The invariant, measured per page.

    A question for a field the manifest lists as established is a defect —
    whatever caused it. That is the whole point: the cause has been different
    every time, and only the symptom is stable enough to test.
    """

    draft_id, headers, _title = await _prepare(client, source)
    asked = await _walk(client, draft_id, headers)

    false_questions = [
        field_path for field_path in asked if field_path in source.established
    ]
    assert not false_questions, (
        f"{source.key}: asked for facts the page states — {false_questions}. "
        f"{source.note}"
    )


@pytest.mark.anyio
@pytest.mark.parametrize("source", CORPUS, ids=lambda item: item.key)
async def test_established_facts_reach_the_draft(
    client: AsyncClient, source: GoldenSource
) -> None:
    """Not asking is not enough — the value has to actually be there.

    A field can avoid a question by being suppressed, which would be worse than
    asking: the draft would silently open without it.
    """

    if not source.established:
        pytest.skip(f"{source.key} establishes nothing deterministically")

    draft_id, headers, _title = await _prepare(client, source)
    await _prepared(client, draft_id, headers)
    current = (
        await client.get(f"/api/v1/job-imports/drafts/{draft_id}", headers=headers)
    ).json()
    settled = {
        item["field_path"]: item["effective_value"]
        for item in current["fields"]
        if item["provenance_state"] != "missing"
    }

    missing = [
        field_path
        for field_path in source.established
        if field_path not in settled and field_path not in source.contested
    ]
    assert not missing, (
        f"{source.key}: the page states these and the draft does not carry them — "
        f"{missing}. {source.note}"
    )


@pytest.mark.anyio
@pytest.mark.parametrize("source", CORPUS, ids=lambda item: item.key)
async def test_established_values_are_the_ones_the_page_stated(
    client: AsyncClient, source: GoldenSource
) -> None:
    """A wrong value is worse than a question, because nobody is asked to check."""

    if not source.established:
        pytest.skip(f"{source.key} establishes nothing deterministically")

    draft_id, headers, _title = await _prepare(client, source)
    await _prepared(client, draft_id, headers)
    current = (
        await client.get(f"/api/v1/job-imports/drafts/{draft_id}", headers=headers)
    ).json()
    settled = {
        item["field_path"]: item["effective_value"] for item in current["fields"]
    }

    for field_path, expected in source.established.items():
        if field_path in source.contested or field_path not in settled:
            continue
        actual = settled[field_path]
        if isinstance(expected, str) and isinstance(actual, str):
            # Substring, so a manifest can name the meaningful part of prose.
            assert expected.casefold() in actual.casefold(), (
                f"{source.key}.{field_path}: {actual!r} does not reflect {expected!r}"
            )
        elif isinstance(expected, (int, float)):
            assert float(str(actual)) == float(expected), (
                f"{source.key}.{field_path}: {actual!r} != {expected!r}"
            )
        else:
            assert actual == expected, f"{source.key}.{field_path}"


@pytest.mark.anyio
async def test_a_page_that_says_nothing_is_still_allowed_to_ask(
    client: AsyncClient,
) -> None:
    """Guard the guard.

    If suppression ever became too aggressive these tests would pass by asking
    nothing at all, which would be a worse product. A genuinely sparse listing
    must still produce questions.
    """

    sparse = next(item for item in CORPUS if item.key == "sparse_listing")
    draft_id, headers, _title = await _prepare(client, sparse)
    asked = await _walk(client, draft_id, headers)
    assert asked, "a listing that states nothing must still be asked about"
