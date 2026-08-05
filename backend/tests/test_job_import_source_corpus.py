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


def _extraction_for(source: GoldenSource) -> dict:
    """The machine result for a run: nothing, or a realistic reading of the prose.

    Modelled rather than live so the corpus is deterministic, but shaped exactly
    like a real reply — evidenced fields and evidenced conflicts — so precedence
    between a visible statement and a structured claim is genuinely exercised.
    """

    fields = [
        {
            "field_path": path,
            "value": value,
            "provenance": "extracted_from_source",
            "evidence": [{"snippet": f"{path} stated in the source"}],
        }
        for path, value in source.model_fields.items()
    ]
    conflicts = [
        {
            "field_path": path,
            "values": [
                {
                    "value": value,
                    "evidence": [{"snippet": f"{path} reading {index + 1}"}],
                }
                for index, value in enumerate(values)
            ],
            "explanation": "The source was read two ways.",
        }
        for path, values in source.model_conflicts.items()
    ]
    return {**_EMPTY_EXTRACTION, "fields": fields, "conflicts": conflicts}


async def _prepare(
    client: AsyncClient, source: GoldenSource, *, with_model: bool = False
) -> tuple[str, dict, str]:
    """Ingest one corpus source exactly as the product would."""

    label = f"corpus-{source.key.replace('_', '-')}{'-m' if with_model else ''}"
    headers, owner_id = await _auth(client, label)

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

    payload = _extraction_for(source) if with_model else _EMPTY_EXTRACTION
    async with TestSessionLocal() as session:
        service = JobImportService(
            JobImportRepository(session), JobService(JobRepository(session))
        )
        await service.record_extraction_result(
            UUID(draft_id),
            JobImportExtractionResponse.model_validate(payload),
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


# ---------------------------------------------------------------------------
# The same sources, read as a working model would read them.
#
# Facts that only exist in prose cannot reach a draft deterministically, so they
# are declared separately and asserted here. This is where precedence between a
# visible statement and a structured claim is actually exercised.
# ---------------------------------------------------------------------------


@pytest.mark.anyio
@pytest.mark.parametrize("source", CORPUS, ids=lambda item: item.key)
async def test_prose_facts_reach_the_draft_and_are_not_asked_back(
    client: AsyncClient, source: GoldenSource
) -> None:
    expected = {**source.established, **source.established_with_model}
    if not expected:
        pytest.skip(f"{source.key} has nothing to establish from prose")

    draft_id, headers, _title = await _prepare(client, source, with_model=True)
    asked = await _walk(client, draft_id, headers)

    false_questions = [path for path in asked if path in expected]
    assert not false_questions, (
        f"{source.key}: asked for facts the source states — {false_questions}. "
        f"{source.note}"
    )

    current = (
        await client.get(f"/api/v1/job-imports/drafts/{draft_id}", headers=headers)
    ).json()
    settled = {
        item["field_path"]: item["effective_value"]
        for item in current["fields"]
        if item["provenance_state"] != "missing"
    }
    for field_path, value in expected.items():
        if field_path in source.contested:
            continue
        assert field_path in settled, (
            f"{source.key}: {field_path} is in the source and not in the draft. "
            f"{source.note}"
        )
        actual = settled[field_path]
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            assert float(str(actual)) == float(value), f"{source.key}.{field_path}"
        elif isinstance(value, list):
            assert set(actual or []) >= set(value), f"{source.key}.{field_path}"
        elif isinstance(value, str) and isinstance(actual, str):
            assert value.casefold() in actual.casefold(), (
                f"{source.key}.{field_path}: {actual!r} does not reflect {value!r}"
            )


@pytest.mark.anyio
@pytest.mark.parametrize(
    "source",
    [item for item in CORPUS if item.contested],
    ids=lambda item: item.key,
)
async def test_a_genuine_conflict_is_offered_as_clickable_choices(
    client: AsyncClient, source: GoldenSource
) -> None:
    """A recruiter should never retype a value the page already contains."""

    draft_id, headers, _title = await _prepare(client, source, with_model=True)
    begun = await client.post(
        f"/api/v1/job-imports/drafts/{draft_id}/conversation/begin", headers=headers
    )
    assert begun.status_code == 200, begun.text

    seen: dict[str, dict] = {}
    question = begun.json().get("active_question")
    for _ in range(20):
        if question is None:
            break
        if question["field_path"] in source.contested:
            seen[question["field_path"]] = question
        shape = question.get("answer") or {}
        alternatives = question.get("alternatives") or []
        if alternatives:
            value: object = alternatives[0]["value"]
        elif shape.get("choices"):
            value = shape["choices"][0]
            if shape.get("is_list"):
                key = shape.get("item_key")
                value = [{key: value}] if key else [value]
        elif shape.get("kind") == "number":
            value = 5
        elif shape.get("kind") == "date":
            value = "2027-01-15"
        else:
            value = "Supplied by the corpus conflict run."
        answered = await client.post(
            f"/api/v1/job-imports/drafts/{draft_id}/conversation/answer",
            headers=headers,
            json={"field_path": question["field_path"], "value": value},
        )
        if answered.status_code != 200:
            break
        question = answered.json().get("active_question")

    for field_path in source.contested:
        assert field_path in seen, f"{source.key}: {field_path} was never put to anyone"
        offered = seen[field_path].get("alternatives") or []
        choices = seen[field_path].get("answer", {}).get("choices") or []
        assert offered or choices, (
            f"{source.key}.{field_path}: a conflict with no clickable options makes "
            "the recruiter retype something the page already contains"
        )
