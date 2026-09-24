# AI features: implementation and roadmap

This guide separates working application code from planned capabilities. It is a
product/source overview, not a claim of live provider availability, measured model
accuracy, or production readiness. The [execution ledger](PRODUCTION_READINESS_EXECUTION.md)
remains authoritative; the application is currently `NO-GO` for customer launch.

## Implemented capabilities

### 1. AI Job Import

A recruiter can start with pasted job text or a supported public job URL instead
of entering every field manually. The import pipeline retrieves and normalizes
the source, requests structured extraction, and reconciles the result against the
same domain rules used by ordinary job posting.

It can prepare fields such as role, responsibilities, skills, work arrangement,
location, and compensation when the source and field policy support them. Explicit
facts, allowed contextual inferences, suggestions, conflicting values, and missing
information retain distinct provenance. High-risk terms must not be invented to
make a draft look complete. Ambiguous values can remain unresolved for the recruiter.

The output is a **private draft**. The normal Post Job editor owns editing,
validation, preview, saving, and explicit publication. Import routes cannot publish.
Manual posting remains available without an AI provider.

Source: [import service](../backend/app/services/job_import_service.py),
[processing service](../backend/app/services/job_import_processing_service.py),
[provider boundary](../backend/app/services/job_import_provider.py),
[import API](../backend/app/api/v1/routers/job_imports.py).
Design: [unified import flow](AI_JOB_IMPORT_UNIFIED_FLOW.md).

### 2. Draft Assistant (Bea)

Before the native draft handoff, Bea presents unresolved decisions one at a time.
The recruiter can answer, skip optional clarification, or continue manually. Answers
and conversation checkpoints are persisted, so the conversation can resume rather
than relying only on browser state. Recruiter answers take precedence over extraction.

This is a constrained, server-owned clarification workflow around AI-assisted
extraction—not an open-ended chatbot or an autonomous agent. After handoff, Bea does
not become a second editor or replace Post Job's ordinary controls.

Source: [conversation service](../backend/app/services/job_import_conversation_service.py),
[conversation rules](../backend/app/core/job_import_conversation.py),
[assistant canvas](../components/import-job/assistant/DraftAssistantCanvas.tsx).
Design: [conversation and handoff](AI_JOB_IMPORT_CONVERSATIONAL_GUIDANCE.md).

### 3. Company/channel About enrichment

For an eligible hiring identity, the application can fill an empty About field.
It prefers existing descriptions and usable company introductions from the imported
source. Where needed, provider-backed official-site discovery and summarization can
prepare a short description from retrieved evidence.

The server checks identity, source suitability, and summary grounding. Existing
recruiter text wins; results are discarded when the identity changes or the recruiter
has written the field while enrichment runs. Insufficient evidence or provider failure
can leave the field blank for manual entry. These checks are not independent employer
verification or a guarantee that model output is accurate.

This is automatic empty-field enrichment, not a new user-requested writing assistant.
Its current execution uses application-process background tasks, not a durable worker.
Do not assume that every import quota or pause control also governs this separate path.

Source: [enrichment service and race guards](../backend/app/services/brand_enrichment_service.py),
[job API scheduling](../backend/app/api/v1/routers/jobs.py),
[site-discovery adapter](../backend/app/integrations/openai/brand_site_finder.py),
[summary adapter](../backend/app/integrations/openai/brand_summary_adapter.py).

## Existing safeguards and remaining limits

For job import, the repository includes authenticated owner-scoped access, a shared
hardened outbound fetcher, bounded inputs/outputs, a model allowlist, deadlines,
bounded retries, per-user quotas/concurrency admission, duplicate-request handling,
and attempt-owned lease recovery. Deterministic tests use controlled providers;
they are not evidence of real-model accuracy or hosted PostgreSQL contention.

The shared system allowance counts logical extraction attempts over a rolling window.
**It is not a currency budget or a durable provider-billing ledger.** Import processing
still awaits work in an API request; persisted state and a stranded-attempt sweeper do
not constitute a durable execution queue.

`JOB_IMPORT_ENABLED` gates new import provider work on the server while preserving
already-prepared drafts. It reads application settings at the call boundary; this
alone does not provide an operator-controlled, shared runtime switch across processes
or cancellation of already-running provider calls.

Import payloads are limited to source material and extraction instructions/schema,
not account credentials, unrelated profiles, or private conversations. Source text can
itself contain personal information. Request storage settings do not establish zero
retention; deployment-specific provider data controls still need review. No paid model
call is needed to run the deterministic examples below.

## Planned production completion — R5

These extend the existing import experience; they do not remove it or redesign Post Job.

| Work remaining | Why it matters | Existing ledger mapping |
| --- | --- | --- |
| Owned durable import/enrichment workers; operation status, retry and cancellation | Work survives browser closure and process restart; stale workers cannot overwrite newer results | `AI-001`, R5 |
| Atomic worst-case spending reservations and durable accounting | Multiple workers and uncertain retries cannot overspend admitted monetary budgets | `AI-004`, `RATE-005` |
| Coordinated admission/worker pause controls | Operators can stop new work and understand the cost of already-running calls | `AI-011` extension, R5 |
| PostgreSQL contention, worker-crash and recovery proof | SQLite and mocked-provider success are not multi-worker production evidence | `AI-003A`, `AI-003B`, `AI-001` |
| Expanded evaluation/release evidence and configured provider checks | Cover ambiguity, injection, malformed inputs, outages, actual model availability and data controls | `AI-010`, `AI-005`, `AI-006`, `AI-009` |

Existing validated subcontracts remain valid only within their recorded evidence.
See [R5 in the approved roadmap](PRODUCTION_RELEASE_ROADMAP.md#r5--durable-budget-controlled-ai-beta)
and the ledger for exact statuses; this overview does not promote unfinished items.

## Planned product additions — F6 / FEAT-006

Status: **`NOT_STARTED`**. These are optional additions after the required safety
foundation, not features already available to reviewers or customers.

| Audience | Planned assistance | User control |
| --- | --- | --- |
| Recruiters | Review a job brief for clarity and missing information | Suggestions only; recruiter chooses edits |
| Recruiters | Suggest screening questions and show proposed wording side by side | Explicit approval; canonical job validation remains authoritative |
| Talent | Improve application clarity using selected, truthful facts | No invented experience, qualifications, or automatic application |
| Talent | Edit portfolio descriptions and identify unanswered questions | User-selected content only; editable output, no automatic sending |

Each requires separate opt-in feature controls and budgets, privacy checks,
hallucination/prompt-injection evaluations, outage handling, and manual fallback.
No autonomous rejection, hiring decision, opaque candidate score, or unsupported
suitability percentage is proposed. See [F6 and its dependencies](PRODUCTION_RELEASE_ROADMAP.md#additive-feature-waves-both-audiences).

The broader roadmap also proposes non-AI improvements: recruiter templates and
shortlists, talent application drafts, opted-in saved-search digests, interview
calendar invitations, customer-safe support, and factual private analytics. Those
are separately tracked F1–F5/F7 additions, not implied AI capabilities.

## Evidence reviewers can inspect

| Contract | Representative tests |
| --- | --- |
| Private draft, canonical handoff, repeated requests | [import readiness](../backend/tests/test_job_import_readiness.py), [frontend integration](../tests/integratedImportSearchRelease.test.mjs) |
| Inference and ambiguous source handling | [inference](../backend/tests/test_job_import_inference.py), [source corpus](../backend/tests/test_job_import_source_corpus.py) |
| Hostile input and provider privacy | [prompt injection](../backend/tests/test_import_prompt_injection.py), [payload privacy](../backend/tests/test_job_import_provider_privacy.py) |
| Quotas, attempt allowance, pause behavior | [quota](../backend/tests/test_job_import_quota.py), [shared attempt budget](../backend/tests/test_job_import_system_budget.py), [kill switch](../backend/tests/test_job_import_kill_switch.py) |
| Brand identity, grounding, and provider contracts | [enrichment](../backend/tests/test_brand_enrichment.py), [site finder](../backend/tests/test_brand_site_finder.py), [summary adapter](../backend/tests/test_brand_summary_adapter.py) |

Use the [local setup](local-auth-testing.md) for dependencies. For a small,
deterministic backend review, run from `backend/`:

```bash
APP_ENV=test DATABASE_URL=sqlite+aiosqlite:///:memory: OPENAI_API_KEY='' \
  .venv/bin/python -m pytest \
  tests/test_job_import_readiness.py \
  tests/test_job_import_provider_privacy.py \
  tests/test_job_import_kill_switch.py \
  tests/test_import_prompt_injection.py \
  tests/test_brand_enrichment.py \
  tests/test_brand_site_finder.py \
  tests/test_brand_summary_adapter.py -q
```

This selection is not the full AI evaluation, security, browser, or release matrix.
The [handoff](PRODUCTION_READINESS_HANDOFF.md) records what was actually rerun.
