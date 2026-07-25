# Interaction Inventory — Inbox, Pipeline, and status management

Every visible control in the application-management workspace, what it is meant
to do, what it was observed doing, and where that behaviour is pinned down by a
test.

**Acceptance rule.** A control is acceptable only when it produces one of: an
authoritative update, a visible prompt, a visible pending state, an intentional
disabled explanation, or an actionable error. *An unexplained no-op is a
defect.* Two controls failed that rule during this audit and are marked
**FIXED** below.

Scope: `components/you/ApplicationsWorkspace.tsx`, `components/you/PipelineBoard.tsx`,
`components/you/CompactChatDock.tsx`. Design intent for the status model lives in
[APPLICATION_STATUS_MANAGEMENT.md](APPLICATION_STATUS_MANAGEMENT.md); this file
records observed behaviour per control.

---

## Status vocabulary this table assumes

| Term | Meaning |
|---|---|
| **Private stage** | Manager-only. Updates `status`, never `participant_status`. No message, no notification, does not close messaging. |
| **Auto-shared outcome** | Shared by the backend at the moment of transition: `hired`, `interviewing` (applications); `accepted`, `declined` (hiring requests). |
| **Optional-shared outcome** | Recorded privately, shared only on an explicit later step: `shortlisted`, `rejected` (applications only). |
| **Archive** | Per-viewer organisation only (`participant_a/b_archived_at`). Never alters lifecycle state or notifies anyone. |

---

## Phase A additions — recommendation, decision surface, work state

Added by the *Effortless Status* Phase A slice (see
[INBOX_PIPELINE_UX_AUDIT.md](INBOX_PIPELINE_UX_AUDIT.md)). All three are gated by
independent flags and change presentation only — none of them writes state that
the backend did not already own.

| Control | Intended | Observed | Backend | Persistence | Counterparty | Coverage | Status |
|---|---|---|---|---|---|---|---|
| `next-action-primary` (header) | The one recommended action, out of the overflow menu | Renders the ladder's result; low confidence shows "Choose next step" and opens the decision surface instead of committing | whichever transition the chosen action maps to | none of its own | only via the action taken | `workspace-next-action` (reachable without overflow, keyboard-operable, low-confidence fallback) | **NEW** |
| `row-next-action` (list row) | Act without opening the record | Rendered only for a high-confidence action on a row that is not open; in flow, never overlapping the timestamp; desktop only | same as above | none | via the action | `workspace-next-action` (mobile calm) | **NEW** |
| `decision-strip` | One place to choose what happens next | Opens on first deliberate open of a new/reviewing record, and on demand from "Choose next step"; sits above the composer and can never cover it; never takes focus | none until a choice is made | dismissal only, user-scoped + versioned | none until a choice is made | `workspace-next-action` (never covers composer, never steals focus, dismissible, commits authoritatively) | **NEW** |
| `decision-strip-option-<stage>` | Commit a real stage change | Dispatches the same `HeaderAction` the overflow menu would, then closes | transition endpoints | authoritative, survives reload | per the stage's notify policy | `workspace-next-action` (commit test) | **NEW** |
| `decision-strip-ask` | Message instead of deciding | Closes the surface and focuses the composer; no state change | none | none | none | `workspace-next-action` | **NEW** |
| `decision-strip-dismiss` | Leave it alone | Closes with zero side effects; stays dismissed for that record across navigation and reload; stage unchanged | none | user-scoped, versioned | none | `workspace-next-action` (dismissal persistence) | **NEW** |
| `work-state-chip` / `pipeline-work-state` | Say what the record needs | One restrained label; never asserts "Needs your reply" without explicit evidence; replaces the status pill so rows carry exactly one indicator | none — derived | none | never visible to the counterparty | `workspace-next-action` (never overstates), `workspaceNextAction` unit tests | **NEW** |
| `pipeline-next-action` | Same recommendation on the board | Only for actions the board owns (reply, share, confirm start); decision-type recommendations defer to the card's stage menu so two surfaces never compete | via the workspace dispatcher | none | via the action | `workspace-next-action` (Inbox/Pipeline parity) | **NEW** |

## Phase B additions — Star, snooze, Auto-Reviewing

| Control | Intended | Observed | Backend | Persistence | Counterparty | Coverage | Status |
|---|---|---|---|---|---|---|---|
| `star-toggle` (header) | Save privately | Optimistic toggle; rolls back on failure; never changes stage | `PUT /me/conversations/{id}/preferences/star` | `interaction_user_preferences`, per user | **never visible** | `workspace-next-action` (durable, independent, rollback) | **NEW (B1)** |
| `row-starred` | Quiet saved marker | One small icon; no badge cluster | — | as above | none | same | **NEW (B1)** |
| `queue-selector` / `queue-chip-*` | Show only what needs attention | Rendered only for queues with live work; counts and rows share one derivation; toggling off restores the list; never narrows selection | — derived | in-memory | none | e2e (advertises only real work) | **NEW** |
| `all-caught-up` | Say when nothing is outstanding | Replaces the selector when every queue is empty | — | — | none | e2e | **NEW** |
| Menu → *Snooze … / Unsnooze* | Quieten a recommendation | Coarse durations; thread stays visible and messageable; no status change; reversible; survives reload | `PUT .../preferences/snooze` | `interaction_user_preferences` | **none** | e2e + 9 backend | **NEW (B1 UI)** |
| Menu → *No reply needed / Put back in my queue* | Correct a reply recommendation | Offered **only** when something recommends a reply; reversible; no lifecycle change; no unread rewriting | `PUT .../preferences/queue-dismissal` | as above | **none** | e2e | **NEW (B1 UI)** |
| decision-strip dismissal | Remember a dismissal durably | Versioned per trigger | `.../preferences/decision-prompt` | as above | none | backend | **NEW (B1)** |
| *(automatic)* deliberate open | Reading marks Reviewing privately | Dwell-gated, owner-only, idempotent, silent on failure | `POST /applications/{id}/review-started` | `review_started_at` + stage | **none — no message or notification** | 4 backend tests | **NEW (B2)** |
| Shortlist stage | *(retired)* | Not offered anywhere; legacy records still move forward and read as "Under consideration" | migration 0047 | preserved history | honest legacy label | backend + e2e | **RETIRED (B4)** |

## Workspace shell

| Control | Intended | Observed | Backend | Persistence | Counterparty | Coverage | Status |
|---|---|---|---|---|---|---|---|
| `applications-view-inbox` / `-pipeline` | Switch view | Switches, URL rewritten via `replaceState` | — | localStorage + URL | none | `workspace-exploratory`, `qa-personas` | OK |
| Mode switch (Talent / Recruiter) | Swap record set | Swaps; empty mode keeps controls visible | — | localStorage + URL | none | `qa-personas` | OK |
| `applications-filter-*` (All/Received/Sent/Archived) | Filter list | Filters; archived is its own tab | — | in-memory | none | `qa-personas` archive test | OK |
| `interaction-row` | Open thread | Opens detail; marks read when visible | `POST /me/conversations/{id}/read` | read state monotonic | read receipt | `qa-personas` | OK |
| `inbox-other-mode-switch` | Jump to the mode holding the record | Switches mode and opens the thread | — | URL | none | `qa-personas` notification test | OK |
| `pipeline-search`, `pipeline-context-filter` | Narrow board | Client-side narrowing | — | in-memory | none | `applications-pipeline` | OK |
| `pipeline-row-checkbox`, `bulk-action-bar`, `bulk-clear` | Multi-select | Selects; legacy-flagged rows excluded from bulk | — | in-memory | none | `applications-pipeline`, `legacyArchiveResolution` | OK |

## Status actions

| Control | Intended | Observed | Backend | Persistence | Counterparty | Coverage | Status |
|---|---|---|---|---|---|---|---|
| Menu → *Move to Reviewing / Shortlist privately* | Private stage | Commits after backend confirms; feedback reads "Saved privately · Not yet shared" | `POST /applications/{id}/transition` (version + idempotency key) | `status`, `status_version`, history row `audience=manager_only` | **none** | `qa-personas` private-stage test | OK |
| Menu → *Hire* | Auto-shared + engagement | Confirm dialog → one hire, one engagement, one notification, messaging stays open | same | `status` + `participant_status` + engagement | sees Hired | `qa-personas` Hired ×2, `workspace-exploratory` triple-click | OK |
| Menu → *Not selected* | Private until shared | Confirm dialog (no note field) → saved privately; share prompt offered | same | `status` only | **none until shared** | `qa-personas` private→share | OK |
| Menu → *Accept request* / *Decline request* | Auto-shared | Confirm dialog; **decline offers an optional note** committed with the decision | `POST /talent-interests/{id}/transition` with `note` | status + participant_status + note message, one transaction | sees outcome **and** note | `qa-personas` decline-with-note; backend atomicity + idempotency | **FIXED (D1)** |
| Menu → *Share decision with …* | Share an optional-shared outcome later | Opens the share prompt **in the Inbox as well as the Pipeline** | `POST /applications/{id}/status-communication` | `participant_status`, history `audience=participants` | sees outcome + note | `qa-personas` private→later-share | **FIXED (D9)** — was inert in the Inbox |
| Menu → *Withdraw* (sender) | Sender-initiated exit | Confirm → withdrawn; thread closes per policy | `POST .../withdraw` | status + participant_status | sees Withdrawn | `qa-personas` withdrawal | OK |
| Menu → *Archive* / *Unarchive* | Personal organisation | Commits immediately, no confirmation (reversible, private) | `POST .../archive` | per-viewer timestamp only | **none** | `qa-personas` archive round trip | OK |
| Menu → *Choose current stage* (legacy) | One deliberate resolution | Offers resolution targets; excluded from bulk | transition + `legacy_archive_resolved` event | clears flag + actor's archive | per target | `qa-personas` legacy test | OK |
| `pipeline-stage-menu` → any stage | Same decisions from the board | **Now confirms `rejected` too**, matching the Inbox; count-aware copy for bulk | same endpoints | same | same | `statusDecisionNotes`, `applications-pipeline` bulk | **FIXED (D2)** — reject used to commit instantly |
| Card drag → stage column | Drag to move | Same path as the menu, so the same confirmations apply | same | same | same | `applications-pipeline` | OK |

## Share prompt (`stage-notify-prompt`)

| Control | Intended | Observed | Backend | Persistence | Counterparty | Coverage | Status |
|---|---|---|---|---|---|---|---|
| `stage-notify-preview` | Show the exact line they'll see | Renders the real notice | — | — | — | `applications-pipeline` | OK |
| `stage-notify-note` | Optional explanation | Live mode only; sent inside the share request | `note` on `/status-communication` | one message, deterministic id | sees the note | `qa-personas` private→later-share | **NEW (D1)** |
| `stage-notify-send` | Share once | Exactly one message, event, notification, outbox intent; repeat adds nothing | as above | idempotent | one update | backend + Postgres concurrency | OK |
| `stage-notify-skip` / `-close` / Escape | Leave it private | Zero side effects | none | none | none | `applications-pipeline` | OK |
| `stage-notify-error` | Explain a failure | Generic retry copy, or a specific reason when the action is unsupported | — | — | — | `statusDecisionNotes` | **FIXED (D3)** — used to claim success |
| `stage-notify-followup` | Add a personal message | Opens the thread | — | — | — | `qa-personas` | OK |

## Messaging

| Control | Intended | Observed | Backend | Persistence | Counterparty | Coverage | Status |
|---|---|---|---|---|---|---|---|
| Reply composer / Send | Send a message | Optimistic send, retry reuses `client_message_id` | `POST /me/conversations/{id}/messages` | unique per conversation | live delivery | `qa-personas` live messaging | OK |
| `chat-dock-*` (launcher, composer, send, minimise) | Message without leaving the board | Mirrors the inbox send path | same | same | live | `qa-personas` two-persona test | OK |
| `conversation-typing` / `chat-dock-typing` | Typing indicator | WS only; never carries a write | WS `typing` | ephemeral | sees indicator | `qa-personas` typing/read test | OK |
| Block / unblock | Restrict a pair | Closes the thread both ways, preserves history | `POST/DELETE /me/blocks/{id}` | `user_blocks` | both sides blocked | `qa-personas` blocking | OK |
| Private note panel | Manager-only notes | Owner-only; never serialised to the sender | notes endpoints | `manager_note` blanked in sender reads | **never visible** | backend router tests | OK |

---

## Defects found, and what was done

| # | Defect | Root cause | Resolution |
|---|---|---|---|
| **D1** | A rejection or decline could not carry an explanation in live mode, and the note the UI *did* collect was appended to local React state only — never sent. | `allowNote: !live && destructive` hid the field in live mode; `commitStatusLocally` only mutated local state. | The note is now part of the authoritative request (`note` on `InteractionTransitionRequest`), written in the same transaction as the decision, event, notification and outbox intent, with a deterministic `status-note:{event.id}` client id so retries can't duplicate it. Offered only where the action actually shares. |
| **D2** | Rejecting from the Pipeline committed instantly while the Inbox asked for confirmation. | `requestStageMove` confirmed only `hired/accepted/declined`. | `CONFIRMED_STAGE_MOVES` now includes `rejected`, with count-aware copy so a bulk rejection says how many people it covers. |
| **D3** | `sendStatusUpdates` skipped non-application targets but still flashed "Shared with …". | A silent `continue` followed by an unconditional success toast. | Unsupported kinds now produce an explicit, non-transient explanation and no success state. No parallel endpoint was invented — hiring-request outcomes genuinely share at transition time. |
| **D4** | Five zero-call-site functions. | Superseded by the canonical transition service. | Removed `_assert_application_transition_allowed`, `_assert_interest_transition_allowed`, `sendConversationStatusUpdate`, `updateApplicationManagerNote`, `updateTalentInterestManagerNote`. |
| **D9** | **The Inbox's "Share decision with …" was completely inert** — click it, the menu closes, nothing happens — and a private rejection made from the Inbox offered no way to share it. | `StageNotifyPrompt` was rendered inside the `view === "pipeline"` branch, while both surfaces could set its state. | Hoisted out of the view switch so it renders for whichever surface started the share. |

## Accepted trade-offs (documented, deliberately unchanged)

- **D5 — Bulk endpoints take no client `expected_version`.** They read the version server-side under a row lock at processing time, so they are safe against concurrent writers but do not detect a stale client view. Per-item optimistic concurrency would require the bulk UI to track a version per row; the row lock plus all-or-nothing semantics is the better trade for a bulk action.
- **D6 — Two notification paths by design.** Every *transition* and *share* uses `dispatch_notification(..., strict_outbox=True)`, so a delivery failure rolls the decision back. *Creation* events (new application, new hiring request) use the best-effort wrapper, so a notification hiccup can never fail a successful submission. This split is intentional.
- **D7 — `"archived"` still appears in the transition tables.** Vestigial, retained so the legacy-archive-resolution flow keeps the same shape as every other transition. It is not a reachable target of an ordinary move.
- **D8 — `status_version` is visible to the sender and increments on private-only changes.** A low-severity "something changed" timing signal. Hiding it would change the sender read shape for little gain; sender-initiated withdrawal derives its version server-side and never needs it.

## Known gaps

- **No "share this later" step exists for hiring requests.** `accepted`/`declined` are auto-shared at transition, and there is no `share_interest_status` service or endpoint. This is a deliberate domain asymmetry, not an oversight; the UI now states it plainly instead of pretending to send something.

---

# Phase C — interview coordination and workload assistance

Everything below was added after the Phase A/B entries above. The columns are the
same, so a control's whole story stays readable in one place.

## Interview coordination

The organiser is the managing side — participant B in both context types, i.e.
the job owner on an application and the listing owner on a hiring request. The
server checks this on every write; `can_manage` in the payload only tells the
client which controls to draw.

| Control | User intent | Actual behavior | Backend request | Persistence | Counterparty effect | Error behavior | Test coverage | Final status |
|---|---|---|---|---|---|---|---|---|
| Decision surface → *Invite to interview* | Arrange a call | Opens `interview-scheduler`; **nothing is sent yet** — an invitation without a time is not worth sending | none until submit | none | none | — | `workspace-interviews` ("asks for a real time before anything is sent") | OK |
| `interview-date` / `interview-time` | Name a time | Local inputs; combined into one absolute instant in the reader's own zone | — | — | — | Blank or past → `interview-scheduler-error` with the reason, form stays open | `interviewScheduling` unit, `workspace-interviews` | OK |
| `interview-method-*` | Say how you'll meet | Toggle group, `aria-pressed`, Space/Enter operable; changes the detail field's label and placeholder | — | — | — | — | `workspace-accessibility` (pointerless form) | OK |
| `interview-meeting-detail` | Link, number, or address | Free text — every provider formats these differently and validating them would reject working ones | — | `meeting_detail` | Sees it on the arrangement and in the thread | Truncated at 500 chars | `workspace-interviews` | OK |
| `interview-duration-*` | How long | Optional; clicking the selected chip clears it | — | `duration_minutes` | Shown on the arrangement | — | `interviewScheduling` unit | OK |
| `interview-note` | Say something with the invitation | Optional, always editable; posted as an ordinary message attributed to the organiser, in the same transaction as the invitation | part of the same request | a `Message` with a deterministic client id | Reads it beside the invitation | Retry resolves to the same row | `test_interviews`, `workspace-interviews` | OK |
| `interview-submit` (first time) | Send the invitation | Moves the application to **Interviewing** through the ordinary transition service, posts one trusted message carrying the time, notifies once | `PUT /me/conversations/{id}/interview` + `transition_application` | `interaction_interviews` row v1; `status`, `participant_status`, `status_version`; one `InteractionStatusEvent`; one notification + outbox intent | Sees Interviewing, the invitation, the time, the link, and the note | 409 `stale_interview` with `current_version`; 409 on a stale *record* version; 422 on a bad zone or an absurd date | `test_interviews` ×6, `workspace-interviews`, `workspace-workflow-audit` | OK |
| `interview-submit` (reschedule) | Move it | Updates in place, bumps `reschedule_count`, **re-opens confirmation**, posts one clear update naming what moved | same endpoint, `expected_version` = current | v+1, `previous_scheduled_at` | Told it moved; must confirm again | as above | `test_interviews`, `workspace-interviews` | OK |
| `interview-confirm` ("This time works") | Agree to the time | Either participant may confirm; the notification always goes to the other side | `POST .../interview/confirm` | `status=confirmed`, `confirmed_at`, `confirmed_by_user_id`, v+1 | Sees "Interview confirmed" | Repeat is a no-op returning the same row | `test_interviews` ×2, `workspace-interviews`, `workspace-workflow-audit` | OK |
| `interview-reschedule` ("Move it") | Change the time | Reopens the scheduler pre-filled with what is arranged | — | — | — | — | `workspace-interviews` | OK |
| `interview-complete` ("Mark interview done") | Close out the scheduling | **Private bookkeeping.** No message, no notification, no participant-visible change, and it decides nothing — the record moves to Interview follow-up and waits | `POST .../interview/complete` | `status=completed`, `completed_at`, v+1 | **none** | Repeat is a no-op | `test_interviews` (asserts message count and notification count unchanged) | OK |
| `interview-cancel` ("Call it off") | Call it off | Always tells the other participant — they may have blocked out the time — and **never touches the stage**: cancelling a call is not a decision about the person | `POST .../interview/cancel` | `status=cancelled`, `cancelled_at`, `cancel_reason`, v+1 | Sees the cancellation and the reason | Repeat is a no-op | `test_interviews`, `workspace-interviews` | OK |
| `interview-new-round` | Arrange another | Reuses the row, `round_number`+1, resets `reschedule_count` | same as first invitation | v+1 | Sees a fresh invitation | — | `test_interviews` | OK |
| Header primary action (interview) | The one next step | Replaces the generic recommendation while an arrangement exists — "Confirm this time" for the invited side, "Mark interview done" once the time has passed, "Record decision" once closed out | — | — | — | — | `interviewScheduling` unit, `workspace-workflow-audit` | OK |

**Time zones.** The reader's own clock leads, because that is the one they act
on; the organiser's stated zone follows whenever the two differ. Stored instants
are read back through `_as_utc` — SQLite has no time-zone type, and a naive
value serialised without an offset is parsed by the browser as *its* local time.
Locale-dependent text is deferred to the client (`useHydrated`) so a hydration
mismatch cannot leave a confident, wrong time on screen. Regression-tested with
a half-hour-offset zone, so a dropped conversion cannot coincidentally look right.

## Workload assistance

| Control | User intent | Actual behavior | Backend request | Persistence | Counterparty effect | Error behavior | Test coverage | Final status |
|---|---|---|---|---|---|---|---|---|
| `work-reminder` | Notice what has been sitting | One line, derived from the queues; present while the work is, gone when it is not. Activating it filters to exactly what it counted | none — a reading of state | none | none | cannot fail | `workspaceAssistance` ×10, `workspace-interviews` | OK |
| `job-summary` / `job-summary-count-*` | Scan workload across roles | Pipeline only; shown when there is more than one job. Counts are independent facts — no percentage, no funnel — and each leads to the matching queue or stage | none | none | none | cannot fail | `workspaceAssistance` ×5, `workspace-interviews` | OK |
| `inbox-empty-state` / `inbox-empty-action` | Understand why the list is empty | Distinguishes an empty system from an empty filter, search, or queue; offers at most one way out; never celebrates | none | none | none | — | `workspaceAssistance` ×6, `workspace-interviews` | OK |
| `all-caught-up` | Know nothing needs you | Honest about who is holding things up ("Nothing needs you. 3 conversations are waiting on the other side.") and never shown to an empty system | none | none | none | — | `workspaceAssistance` ×2 | OK |
| `queue-chip-interview_confirmation` | Find a time you owe an answer on | New queue, ranked just below start confirmation — someone is holding a slot open | none | none | none | — | `workQueues`, `interviewScheduling` | OK |
| Engagement row (start) | Confirm or decline a start | Unchanged authoritative flow; now **states its dates** — the confirmation deadline and the agreed start | `GET /me/engagements` for the list-wide read | no new state | unchanged | unchanged | `test_engagement_reviews` | OK |
| `GET /me/engagements` | Populate the start-confirmation queue | One request for the whole inbox; scoped by participation | — | — | — | Degrades to the open record only | `test_engagement_reviews`, `workspace-performance` | **FIXED** — the queue could not populate before |

## Mobile, keyboard, offline

| Behaviour | Observed | Coverage |
|---|---|---|
| Mobile inbox landing | Restores the last selection but **does not open it** — the list is the screen you asked for. `?thread=` still opens, being a deliberate request | `workspace-next-action` mobile, `qa-personas` mobile |
| Touch targets | Interview actions are 44px on mobile, compact from a pointer device up | `workspace-accessibility` |
| Keyboard lifecycle | Reach the recommendation, operate it, open the scheduler (which takes focus into its first field, having been asked for), Escape to close | `workspace-accessibility` ×2 |
| Focus | The decision surface never takes focus on mount, so typing is never interrupted; focus rings verified by tabbing, since `:focus-visible` does not match programmatic focus | `workspace-accessibility` |
| Offline | What was loaded stays readable; reconnect resumes without a reload | `workspace-performance` |
| Retry | Interview mutations are never optimistic — the surface shows pending and only the server's answer renders. A conflict is reported in the words of the thing that changed | `workspace-interviews`, `test_interviews` |
| Reduced motion | Entry animation removed, not shortened | `workspace-accessibility` |

---

# Visual system controls

Added by the visual redesign. Same columns; these are presentation controls, so
"backend request", "persistence" and "counterparty effect" are `none` by
construction — nothing in this layer may write state.

| Control | User intent | Actual behavior | Backend request | Persistence | Counterparty effect | Error behavior | Test coverage | Final status |
|---|---|---|---|---|---|---|---|---|
| `queue-chip-all` | Return to every conversation | Pressed by default and visually raised, so "no filter" is a state you can see rather than the absence of one; always first in the rail | none | none | none | — | `workspace-next-action`, `workspace-visual-system` | **NEW** |
| Avatar direction mark | Know whether this arrived or was sent | A 3.5px arrow on the avatar carrying the full phrase ("Received application") as its accessible name; replaces a line of backend vocabulary above the person's name | none | none | none | — | `workspace-visual-system` | **CHANGED** |
| Row selected state | See which conversation is open | 3px accent edge + leftward tonal wash + raised fill | none | none | none | — | `workspace-visual-system` | **CHANGED** |
| Work-state chip | Tell states apart at a glance | Familiar icon + the state's own hue + its words; colour is never the only signal | none | none | none | — | `workspace-visual-system`, `workspace-accessibility` | **CHANGED** |
| Header stage | Know where this stands | Grouped with the opportunity under the name (*role · ● Responded*) with the dot from the shared taxonomy, instead of a third pill competing with the action | none | none | none | — | `qa-personas`, `workspace-workflow-audit` | **CHANGED** |
| `next-action-primary` | Do the recommended thing | Filled gradient + elevation when confident; bordered raised surface when the recommendation is the neutral "Choose next step" | as before | as before | as before | as before | `workspace-visual-system` ×2 | **CHANGED** |
| `pipeline-row` | Open a candidate's conversation | No longer `role="button"` — it contains a link, a checkbox, a menu and a Message button. Pointer click still opens; the labelled Message button is the keyboard and AT path | as before | none | none | — | `workspace-visual-system`, `workspace-accessibility` | **FIXED** — was 14 axe `nested-interactive` failures |
| Stage section accent | Tell stages apart while scanning | One 2px edge in the stage's own hue; terminal groups stay flat because they are history, not work | none | none | none | — | `workspace-visual-system` | **NEW** |
| `work-reminder` | Notice what has been sitting | A lifted card with an attention-hue clock, not another hairline bar | none | none | none | cannot fail | `workspace-interviews` | **CHANGED** |

## Contrast and motion

| Property | Guarantee | Coverage |
|---|---|---|
| Informational text | ≥ 4.5:1 on every surface in the ladder | `contrastTokens` (7 tests, parsed from `globals.css`) |
| Meaningful borders, focus ring | ≥ 3:1 non-text contrast | `contrastTokens` |
| Disabled text | The one tier below AA; asserted quieter than `subtle` so it reads as inactive | `contrastTokens` |
| Text over gradients | ≥ 4.5:1, sampled from the rendered page | `workspace-visual-system` |
| Whole document | Zero serious/critical axe violations, unscoped | `workspace-accessibility` ×3 |
| Reduced motion | Animations **and transitions** disabled, not shortened | `workspace-accessibility` |
| 200% zoom / 320px | No horizontal overflow | `workspace-accessibility` |
