# CreatorJobs Application Status Management

This document defines the authoritative status model used by Inbox, Pipeline,
messaging, notifications, Timeline, and engagement creation.

The product presents two simple concepts:

- **Manage privately**: organize a relationship without notifying the other person.
- **Share a decision**: communicate an outcome and update both participants.

The backend keeps those concepts separate so a private recruiting decision never
leaks accidentally, while a consequential outcome can never appear to succeed on
only one side.

## Authoritative State

| Concern | Source of truth | Rule |
| --- | --- | --- |
| Private workflow | `job_applications.status`, `talent_interests.status` | Visible to the manager; lower-risk stages may remain private. |
| Shared lifecycle | `participant_status` | What the counterparty may see. It changes only through an explicit shared outcome or sender withdrawal. |
| Optimistic concurrency | `status_version` | Every first-party transition sends `expected_version`; stale writes return `409`. |
| Durable history | `interaction_status_events` | Records private transitions and shared decisions. Sender reads include only `audience=participants`. |
| Idempotency | `interaction_transition_requests` | Binds a key to actor, record, action, status, and expected version. |
| Engagement | `engagements` | Begins exactly once after application `hired` or hiring request `accepted`. |
| Trusted chat event | `messages` with `kind=status_update` | Created by the transition service; users cannot forge it. |
| Notification | `notifications` | Created in the same transaction as a shared outcome and deduplicated. |
| Delivery intent | `email_outbox` | Queued in the transaction; external delivery occurs only after commit. |
| Archive | per-participant conversation archive timestamp | Private organization only; it never changes lifecycle status or status version. |

## State Invariants

- Manager status represents private workflow management.
- `participant_status` represents the state visible to the counterparty.
- An application in `hired` must also have participant status `hired` and exactly
  one matching engagement.
- A hiring request in `accepted` must also have participant status `accepted` and
  exactly one matching engagement.
- Participant-visible Hired or Accepted cannot exist without the matching manager
  outcome and engagement.
- A private `rejected` application does not close messaging. Communicating that
  decision updates `participant_status` and then closes ordinary messaging.
- Hired and Accepted remain messageable because collaboration continues in the
  same thread.
- Archive never changes either lifecycle status.
- Unknown legacy archived records are never restored to a fabricated `new` stage.
  They retain `legacy_archive_resolution_required` until deliberately resolved.
- A later shared lifecycle outcome cannot be overwritten by a lower private stage.

These checks belong in `interaction_transition_service.py`, not only in frontend
rendering.

## Application Lifecycle

| Manager state | Other-user visibility | Communication | Valid manager transitions |
| --- | --- | --- | --- |
| `new` | Pending/New | Initial application event | Reviewing, Shortlisted, Interviewing, Hired, Rejected |
| `reviewing` | Unchanged | Private | Shortlisted, Interviewing, Hired, Rejected |
| `shortlisted` | Unchanged until shared | Optional explicit update | Reviewing, Interviewing, Hired, Rejected |
| `interviewing` | Interviewing | Automatically shared | Hired, Rejected |
| `rejected` | Unchanged until shared | Optional explicit update | May return to an active stage only before rejection is shared |
| `hired` | Hired | Automatically shared; creates engagement | None; engagement controls take over |
| `withdrawn` | Withdrawn | Applicant-owned shared outcome | None |

Archive is not a lifecycle state in current first-party flows. It is a private,
per-viewer conversation property.

## Hiring-Request Lifecycle

| Manager state | Other-user visibility | Communication | Valid manager transitions |
| --- | --- | --- | --- |
| `new` | Pending/New | Initial request event | Reviewing, Accepted, Declined |
| `reviewing` | Unchanged | Private | Accepted, Declined |
| `accepted` | Accepted | Automatically shared; creates engagement | None |
| `declined` | Declined | Automatically shared | None |
| `withdrawn` | Withdrawn | Recruiter-owned shared outcome | None |

`accepted` is canonical. `contacted` is accepted only as temporary legacy input and
is normalized immediately.

## Canonical API

Single-record transitions:

```text
POST /api/v1/applications/{id}/transition
POST /api/v1/talent-interests/{id}/transition
```

Request body:

```json
{
  "status": "hired",
  "expected_version": 2,
  "idempotency_key": "uuid"
}
```

Repeated successful intent returns a semantic no-op:

```json
{
  "outcome": "already_in_state",
  "current_status": "hired",
  "status_version": 3
}
```

Optional application decision communication uses:

```text
POST /api/v1/applications/{id}/status-communication
```

Archive uses source-specific `/archive` endpoints and does not mutate status.

The old PATCH status routes are isolated compatibility adapters. They derive a
version, log `legacy_transition_without_version`, and are not called by the current
first-party UI. Remove them after identified legacy clients migrate.

## Transaction Boundary

One database transaction creates or updates:

- manager status
- participant-visible status, when shared
- status version
- durable history
- engagement, for Hired or Accepted
- trusted system message
- in-app notification
- outbox row

Only after commit:

- WebSocket emission
- email or push delivery
- analytics and other external integrations

Realtime and delivery failures never roll back a valid transition. They are logged
and retried independently. A pre-commit persistence failure rolls back the entire
transition, preventing partial states such as Hired without an engagement.

## Bulk Actions

Hired and Accepted are never bulk actions. They are consequential shared outcomes
and are confirmed one relationship at a time.

Bulk actions are limited to lower-risk organization:

- Applications: Reviewing, Shortlisted, private Not selected, Archive
- Hiring requests: Reviewing, Archive

Drag/drop follows the same rule. A single Hired or Accepted drop opens confirmation;
a multi-selection cannot target those outcomes.

## UI Feedback Contract

Every visible control must produce one of:

- `Updating…`
- authoritative success (`Saved privately`, `Shared with Priya`, `Already hired`)
- a confirmation prompt
- a clear validation or permission reason
- an actionable error and retry path
- a deliberately disabled state with an explanation

Inbox and Pipeline use the same transition API and refresh from backend state. The
Timeline renders durable history. Stale `409` responses show `Changed elsewhere —
latest status loaded.` and trigger a refresh. Hired and Accepted remain messageable.

## Interaction Inventory

The release audit treats an unexplained no-op as a defect. Each control has one
authoritative outcome and focused coverage:

| Control | Required observable result |
| --- | --- |
| Inbox/Pipeline tabs | Selected view and URL update; content remains available. |
| Talent/Recruiter mode | Mode, direction labels, URL, and records update together. |
| Conversation row/card | Opens the exact persisted thread and marks it read. |
| Reviewing/Shortlisted/Not selected | Shows `Updating…`, then private confirmation or actionable error. |
| Share decision | Creates one participant event, notification, and trusted message. |
| Hired/Accepted | Opens confirmation, commits atomically, displays shared success, and exposes engagement controls. |
| Archive/Unarchive | Persists per viewer without changing lifecycle or notifying the other person. |
| Withdraw | Sender-only confirmation and one shared outcome. |
| Private note save/delete | Shows panel-level pending/success/error and never enters shared output. |
| Message send | Persists one idempotent message or retains the draft with a retryable error. |
| Engagement actions | Show pending state and server-calculated next actions. |
| Notification deep link | Opens the correct mode, view, and thread. |
| Mobile/keyboard menus | Consequential action remains reachable, confirmable, cancellable, and focus-restoring. |

Bulk menus deliberately omit Hired and Accepted. Current-state actions are removed
or return `already_in_state`; they never create duplicate side effects.

## Observability

Structured transition logs contain only safe operational fields:

- transition ID and interaction type/ID
- actor user ID
- previous/new status and version
- idempotency identifier
- engagement created/reused
- notification/message/outbox result
- final outcome and structured error code

Logs never contain message bodies, private notes, tokens, passwords, secrets, or
sensitive profile content. `/api/v1/admin/interaction-integrity` exposes migration
integrity findings to authorized administrators.

## Release Gate

SQLite remains the fast backend test default. PostgreSQL is mandatory for release:

```bash
cd backend
PYTHON_BIN=/path/to/python ./scripts/test_interaction_status_postgres.sh
```

The script starts disposable local PostgreSQL, performs upgrade/downgrade/upgrade,
injects historical fixtures, and tests concurrent Hired, Accepted, conflicting
status changes, decision communication, engagement uniqueness, and deduplication.
It never uses hosted Neon.

Before release, also verify twice from freshly restored QA data:

1. Application → Hired from Inbox and Pipeline.
2. Hiring request → Accepted from Inbox and Pipeline.
3. Both participants agree after hard refresh, sign-out/sign-in, mode switching,
   and persona switching.
4. Repeated/concurrent actions create no duplicate engagement, history, message,
   notification, or outbox row.
5. Messaging remains open for Hired/Accepted and closes only for a shared terminal
   outcome, withdrawal, blocking, suspension, or deleted participants.

## Relevant Files

- `backend/app/services/interaction_status.py`
- `backend/app/services/interaction_transition_service.py`
- `backend/app/services/messaging_service.py`
- `backend/alembic/versions/0039_interaction_status_history.py`
- `components/you/ApplicationsWorkspace.tsx`
- `components/you/PipelineBoard.tsx`
- `lib/applicationPipeline.ts`
- `backend/tests/test_interaction_transitions.py`
- `backend/tests/test_interaction_transitions_postgres.py`
- `backend/tests/test_interaction_migration_postgres.py`
- `tests/e2e/qa/qa-personas.spec.ts`
