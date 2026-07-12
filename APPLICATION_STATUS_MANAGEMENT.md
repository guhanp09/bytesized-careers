# CreatorJobs Application And Hiring-Request Status Model

This document describes the production status model used by Inbox, Pipeline,
notifications, timelines, messaging, and engagement creation.

The key rule is that the manager's private pipeline state is separate from the
participant-facing relationship state. A recruiter can organize applicants
without exposing private assessment, while real outcomes are shared
consistently with the other participant.

## Sources Of Truth

| Concern | Backend source | Inbox | Pipeline | Other-user visibility | Final rule |
| --- | --- | --- | --- | --- | --- |
| Manager pipeline stage | `job_applications.status`, `talent_interests.status` | Owner sees it in headers, list badges, timeline, and menus | Owner sees it in columns and stage chips | Hidden unless intentionally shared | Backend status is authoritative and survives reload |
| Participant-facing state | `participant_status` | Sender sees this in sent/received lists and conversation state | Sender boards use this display status | Visible to the other participant | Only updated for shared outcomes, optional shortlist sharing, withdrawal, or decline |
| Status history/system event | Server-created `Message.kind=status_update` or event message | Rendered as trusted timeline/system message | Reflected after refetch/sync | Only when shared | Ordinary user messages cannot forge trusted status events |
| Notification | `notifications` table via backend dispatch | Bell/deep links select the exact thread and mode | Counts update from persisted notification rows | Only recipient sees it | Internal-only changes create no counterparty notification |
| Messaging availability | Messaging service checks the source record state | Composer remains open for active and accepted/hired states | Same rule after selecting the record | Same thread for both sides | Hired/contacted stay messageable; rejected/declined/withdrawn close where intended |
| Engagement creation | Engagement service via backend transition | Engagement summary appears when available | Same source after refresh | Shared participants see relationship progress | Created exactly once for hired applications and accepted hiring requests |
| Archive state | Manager status `archived` | Moves to archived views for the manager | Moves to archived group | Private unless the source was already terminal/shared | Archive is cleanup, not rejection |

## Application Transition Matrix

Applications are submitted by Talent and managed by the Recruiter or hiring
owner.

| Status | Who can set it | Visibility | Notify other user? | System message? | Messaging | Valid next states |
| --- | --- | --- | --- | --- | --- | --- |
| `new` | System on application | Applicant and recruiter see arrival/pending state | Yes, initial application notification to recruiter | Application-created event | Open | `reviewing`, `shortlisted`, `interviewing`, `hired`, `rejected`, `archived` |
| `reviewing` | Recruiter | Internal-only | No | No | Open | `shortlisted`, `interviewing`, `hired`, `rejected`, `archived` |
| `shortlisted` | Recruiter | Internal by default; optionally shared | Only when recruiter explicitly chooses to inform | Only when shared | Open | `reviewing`, `interviewing`, `hired`, `rejected`, `archived` |
| `interviewing` | Recruiter | Shared | Yes, automatic | Yes | Open | `shortlisted`, `hired`, `rejected`, `archived` |
| `hired` | Recruiter | Shared terminal pipeline outcome | Yes, automatic | Yes | Open; engagement controls take over | None |
| `rejected` | Recruiter | Shared terminal outcome | Yes, automatic | Yes | Closed for application thread | `archived` |
| `withdrawn` | Applicant | Shared sender outcome | Yes, automatic to recruiter | Yes | Closed for application thread | `archived` |
| `archived` | Recruiter, after allowed source state | Internal cleanup | No | No | Depends on underlying participant state | None |

Selecting the same status again is an idempotent no-op. It returns the current
authoritative record without creating another notification, trusted message,
timeline event, unread count, or engagement.

## Hiring-Request Transition Matrix

Hiring requests are sent by Recruiters and managed by Talent.

| Status | Who can set it | Visibility | Notify other user? | System message? | Messaging | Valid next states |
| --- | --- | --- | --- | --- | --- | --- |
| `new` | System on hiring request | Recruiter and talent see pending/new state | Yes, initial request notification to talent | Hiring-request-created event | Open | `reviewing`, `contacted`, `declined`, `archived` |
| `reviewing` | Talent | Internal-only | No | No | Open | `contacted`, `declined`, `archived` |
| `contacted` | Talent | Shared accepted outcome | Yes, automatic | Yes | Open; engagement controls take over | None |
| `declined` | Talent | Shared terminal outcome | Yes, automatic | Yes | Closed for hiring-request thread | `archived` |
| `withdrawn` | Recruiter | Shared sender outcome | Yes, automatic to talent | Yes | Closed for hiring-request thread | `archived` |
| `archived` | Talent, after allowed source state | Internal cleanup | No | No | Depends on underlying participant state | None |

## Internal, Optional, And Shared Categories

Internal-only statuses:

- Application: `reviewing`, `archived`
- Hiring request: `reviewing`, `archived`

These are for the manager's own organization. They persist across Inbox and
Pipeline, but they do not notify the other participant or publish a shared
timeline message.

Optionally communicated statuses:

- Application: `shortlisted`

Shortlisting is useful privately while comparing candidates. The Pipeline and
conversation controls may ask whether to inform the applicant. If skipped, it
stays internal. If sent, the backend updates `participant_status`, creates one
trusted system event, and creates one notification.

Mandatory shared statuses:

- Application: `interviewing`, `hired`, `rejected`, `withdrawn`
- Hiring request: `contacted`, `declined`, `withdrawn`

These affect both people and cannot be secretly applied. The backend publishes
the participant-facing state atomically with the status change and creates the
intended notification/system event once.

## UI Rules

- Inbox and Pipeline call the same backend status endpoints and consume the same
  normalized resource response.
- Both surfaces show only valid next actions for the current authoritative
  backend state.
- Active/current states are treated as no-op actions, not new transitions.
- The conversation hamburger menu and Pipeline status menus share the same
  transition policy from `lib/applicationPipeline.ts`.
- Pipeline counts, selected conversation headers, list rows, timeline messages,
  and notification deep links are refreshed from backend state after success.
- API failure restores the prior authoritative UI state and does not show false
  success.
- Internal stages are never displayed to the counterparty.

## Backend Rules

- `backend/app/services/interaction_status.py` is the transition-policy source.
- The backend validates actor ownership, source record kind, valid target state,
  and whether notification is allowed for the requested transition.
- `participant_status` is returned to sender-facing reads so the other side never
  sees private manager-only stages.
- Trusted status events are generated only by backend transition handlers.
- `hired` applications and `contacted` hiring requests create engagement records
  idempotently.
- Terminal closed states block ordinary messaging where intended; accepted/hired
  relationship states remain messageable.

## Regression Checklist

For future releases, test each workflow in two authenticated contexts:

1. Talent applies to a job; recruiter moves it to `reviewing`; reload both sides.
2. Recruiter shortlists privately; talent receives no notification or internal label.
3. Recruiter shares shortlist; talent receives exactly one notification/event.
4. Recruiter moves to `interviewing`; Pipeline and Inbox agree after reload.
5. Recruiter hires; engagement is created once and messaging stays open.
6. Talent withdraws; recruiter sees the shared withdrawal and messaging closes.
7. Recruiter archives a terminal item; the counterparty receives no new update.
8. Recruiter sends a hiring request; talent reviews privately; recruiter sees no
   internal stage.
9. Talent accepts or declines; recruiter receives exactly one shared event.
10. Repeat any already-active action; confirm there is no duplicate notification,
    trusted message, unread count, or engagement.
11. Try rapid clicks and two tabs; final state is stable and side effects are
    exactly once.

## Relevant Tests

- `backend/tests/test_applicant_management.py`
- `backend/tests/test_messaging.py`
- `backend/tests/test_notifications.py`
- `tests/applicationPipeline.test.mjs`
- `tests/messaging.test.mjs`
- `tests/e2e/applications-pipeline.spec.ts`
- `tests/e2e/you-applications.spec.ts`
- `tests/e2e/qa/qa-personas.spec.ts`
