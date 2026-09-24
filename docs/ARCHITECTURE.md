# Architecture

This orients readers to the implemented system, not a completed production rollout.
Open work is identified in the [execution ledger](PRODUCTION_READINESS_EXECUTION.md).

## Responsibilities

| Layer | Responsibility | Entry point |
| --- | --- | --- |
| Next.js routes | Navigation, server routes, auth integration, metadata | [`app/`](../app/) |
| Product components | Editing and presentation, not authorization authority | [`PostJobPage.tsx`](../components/PostJobPage.tsx) |
| Frontend contracts | Typed API mapping, drafts, validation, Backend/Mock adapters | [`backendClient.ts`](../lib/backendClient.ts) |
| API routers | Request validation, authenticated actor, response contract | [`backend/app/api/v1/`](../backend/app/api/v1/) |
| Services | Domain transitions, workflow orchestration, provider boundaries | [`services/`](../backend/app/services/) |
| Repositories | Queries, claims, pagination, persistence | [`repositories/`](../backend/app/repositories/) |
| Models/migrations | Durable records, additive schema evolution | [`models/`](../backend/app/models/), [`alembic/`](../backend/alembic/) |
| Scenarios | Repeatable multi-role fixtures, not live customers | [`creator_scenarios/`](../fixtures/creator_scenarios/) |

PostgreSQL is the intended production database. SQLite supports lightweight
development and deterministic tests. Prisma/SQLite also remains for legacy/local
frontend paths; it is not a second authoritative production store.

## Job creation and AI import

```text
Manual entry ───────────────────────────────────┐
                                               ▼
Text / public URL → private import → review → canonical job draft
                                               │
                                      validated Post Job flow
                                               │
                                      explicit user publication
```

Import source, decisions, attempts, and target draft have explicit state. Public
source retrieval uses a shared safe outbound-fetch boundary. Provider failures
must preserve recoverable user work. Import output is not a published job and
cannot skip canonical validation.

Read [`job_import_service.py`](../backend/app/services/job_import_service.py),
[`safe_outbound_fetch.py`](../backend/app/services/safe_outbound_fetch.py), and
the [unified import flow](AI_JOB_IMPORT_UNIFIED_FLOW.md).

**Remaining:** processing still has request-bound execution; owned durable workers,
cross-worker proof, and complete spending reservations are AI/R5 work. The recovery
sweeper must not be described as a completed execution worker.

## Applications and conversations

Screening answers, applications/interests, participant status, and messages form
one workflow. Recruiters see received applications; talent see sent applications.
Pipeline and conversation views operate on the same underlying records.

The backend authorizes participants and transitions. Persisted HTTP state is the
source of truth; realtime events improve freshness but cannot replace it. Private
notes and snapshots must not leak to public or counterparty responses. External
application navigation is distinct from internal submission.

Read [`messaging_service.py`](../backend/app/services/messaging_service.py),
[`marketplace.py`](../backend/app/api/v1/routers/marketplace.py), and
[`ApplicationsWorkspace.tsx`](../components/you/ApplicationsWorkspace.tsx).

**Remaining:** deterministic marketplace issues are CORRECT/R3; shared Redis
realtime and socket resource protection remain REALTIME/R7 work.

## Authentication and visibility

NextAuth connects browser login to the FastAPI identity/session layer. Google
identity is independently verified server-side. Persistent session rotation,
revocation, and administrator strong authentication have dedicated security tests.
Browser credential isolation is **not complete**: AUTH-007 tracks remaining
access-token consumers and the WebSocket ticket transition.

Suspension and deletion hiding are independent states. Shared
[`account_state.py`](../backend/app/core/account_state.py) supplies object and SQL
checks; [`public_visibility.py`](../backend/app/repositories/public_visibility.py)
applies eligibility before counts, ranking, and pagination. Hiding a listing does
not erase authorized private workspace history.

**Remaining:** browser/cache/sitemap transition certification is VIS-001B, not
implicitly proven by SQL tests.

## Durable email intent

```text
Domain transaction → email_outbox → enabled worker → suppression/consent → provider
                                      │
                          production disabled: leave queued
```

Requests enqueue mail with their domain transaction instead of sending SMTP inline.
Workers own retry/delivery state. Production cannot select/use a mock provider;
disabled delivery pauses. Nonproduction test providers exercise transitions without
real recipients. See [NOTIFICATIONS.md](NOTIFICATIONS.md).

**Remaining:** expiry revalidation, committed/fenced claims, bounded off-loop SMTP,
and crash/ambiguous-acceptance recovery are EMAIL-006B/EMAIL-007. SMTP acceptance
does not prove inbox delivery or reading; exactly-once delivery is not claimed.

## Reliability and evidence

Outbound fetching, URL/redirect validation, quotas, request-body bounds, HTTP
admission, and provider deadlines belong in reusable boundaries. Do not relax
production configuration to obtain a demonstration.

Lockfiles, additive Alembic revisions, validation commands, CI recipes, operational
exercises, and handoffs make changes recoverable. Canonical scenarios align mocks
with backend fixtures.

Source assertions do not prove runtime behavior; SQLite does not prove PostgreSQL
locking; Dockerfiles do not prove built images; workflow files do not prove hosted
CI passed. Evidence is recorded separately.

Large workspace/service modules are acknowledged technical debt. This presentation
does not cosmetically reorganize them at the expense of working behavior or history.
