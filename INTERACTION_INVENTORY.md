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
