# Inbox · Pipeline UX audit — Phase A

Implementation-oriented record of the Phase A slice of the *Effortless Status*
redesign. Phase A is the **first milestone**, not the finished redesign; Phase B
and C are listed at the end.

## The problem Phase A addresses

The status system worked but nothing made anyone use it:

- **every status action lived in a three-dot overflow menu** — `headerActionsFor`
  fed `OverflowMenu` and there was no primary action button anywhere;
- **the composer was the only primary surface**, so the entire hiring
  conversation could happen with status frozen at New;
- **reading created nothing** — `handleSelect` only cleared the unread flag;
- **rows led with a passive status badge** rather than the next move.

Guiding principle: *users should create accurate status and workflow data as a
by-product of actions they already intended to take*, rewarded with less work —
not with points, streaks, or nagging.

## Research applied (and rejected)

| Source | Adopted | Rejected, and why |
|---|---|---|
| [NN/g progressive disclosure](https://www.nngroup.com/videos/progressive-disclosure/) | One primary action, 2–3 quiet secondaries, rest under *More* | — |
| [Linear](https://gunpowderlabs.com/2024/12/22/linear-delightful-patterns) / [Superhuman](https://blog.superhuman.com/how-to-manage-your-email-inbox/) keyboard triage | Keyboard-operable primary action | **⌘K palette and single-letter global shortcuts.** Wrong for occasional users — a solo creator triages five applications a week, not five hundred emails a day |
| [ATS Kanban](https://www.jobaffinity.com/en/blog/vue-kanban-ats/), [ATS design](https://www.eleken.co/blog-posts/applicant-tracking-system-design-how-to-make-recruitment-better-for-everyone) | Board as a survey lens over real stages | **RAG (red/amber/green) candidate health.** Punitive colour on a person, and colour-only status fails accessibility |
| [WCAG 4.1.3](https://dockaccess.org/documentation/wcag-success-criteria/wcag413/), [ARIA live regions](https://www.uxpin.com/studio/blog/aria-live-regions-for-dynamic-content/) | `aria-live="polite"`, focus never stolen | `assertive` for ordinary updates — disruptive |

Evidence grading: *established principle* — progressive disclosure, one primary
action, live-region/focus rules. *Competitor convention* — keyboard triage,
Kanban. *Hypothesis needing validation* — that a skippable decision surface
raises status adoption without depressing reply rate; hence flags + guardrails.

## Before → after

| | Before | After |
|---|---|---|
| Status actions | overflow menu only | one primary action in the header; overflow keeps the rest |
| A new applicant | passive "New" badge | "Choose next step" → decision surface listing real stage choices |
| Rows | badge + timestamp | identity · role · **one** work-state label · message · age |
| What a record needs | not expressed | derived work state, shared by Inbox and Pipeline |
| Messaging | the only primary surface | still immediately available, never blocked or covered |

## Final action hierarchy

Deterministic first-match ladder (`nextBestActionFor`), identical in both views:

1. legacy archive → **Choose current stage**
2. unconfirmed engagement → **Confirm start**
3. decision saved privately, never shared → **Tell {name}**
4. closed conversation (rejected/declined/withdrawn) → *nothing*
5. agreed outcome (hired/accepted) → **Reply** if unread, else *nothing*
6. interviewing → **Record decision**
7. unread → **Reply to {name}**
8. new/reviewing → **Choose next step** *(low confidence — opens the surface, never guesses)*

The product never assumes a new applicant should be interviewed, rejected, or
messaged. Low confidence produces a neutral choice, not a guess.

## Work-state precision

`deriveWorkState` refuses to overstate certainty. **"Needs your reply" is never
emitted in Phase A** — it requires an explicit `responseExpected` signal that
only Phase B's composer intents will provide. Ambiguous inbound traffic produces
the descriptive **"Review latest message"** instead. Archived records, closed
conversations, and situations where the other participant owes the move are
excluded entirely. The indicator is presentation only and never mutates lifecycle.

## Visual hierarchy rules

- Rows show **exactly one** state indicator: the work-state chip when present,
  otherwise the lifecycle pill. Two pills side by side read as a badge cluster.
- Colour is never the only signal — every state carries a word.
- A row earns an action button only when it has a **high-confidence** action *and*
  is not the open row (the detail header already carries that one). Low-confidence
  suggestions never take row space.
- Row actions render in flow, never overlapping the timestamp, and are
  desktop-only; mobile acts from the opened conversation.

## Motion and feedback

Reuses the existing `.ui-crossfade` utility and the global
`prefers-reduced-motion` blocks in `app/globals.css`. Motion only explains a
change (surface entry, row state). No decorative movement, no focus stealing, no
delayed interactions. Optimistic only where private and reversible; shared
outcomes remain authoritative-only.

**Sound: rejected.** A hiring workspace sits beside other audio work; sound would
need a preference surface, mute state, and cross-tab coordination for negligible
gain over visual + live-region feedback. **Haptics: deferred** to a mobile pass —
if adopted, restricted to consequential confirmed outcomes, never the sole
feedback.

## Accessibility

Primary action is keyboard-focusable and Enter-operable (covered by e2e). The
decision surface never receives focus on mount, so typing is never interrupted.
State changes announce through the existing `aria-live="polite"` regions. Every
state carries text, not just colour.

## Analytics

Provider-neutral (`lib/workspaceAnalytics.ts`) — a no-op sink by default, so
nothing is transmitted until a sink is deliberately installed, and no vendor is
introduced. **Privacy by construction:** `WorkspaceEventPayload` has no free-text
field, so message bodies, private notes, and names cannot be logged.

Events: next-action impression/activation, choose-next-step activation, decision
strip impression/dismiss/action/bypass, overflow use, time-to-action, abandonment,
message sent — each carrying surface, viewport, kind, direction, stage, and flag
cohort.

## Feature flags

`NEXT_PUBLIC_ENABLE_NEXT_ACTION`, `NEXT_PUBLIC_ENABLE_DECISION_STRIP`,
`NEXT_PUBLIC_ENABLE_WORK_STATE` (`lib/workspaceFlags.ts`). Each gates one
mechanism, disables cleanly with no data loss (all three gate presentation only),
has no dependency on the others, and defaults on locally/in QA and off in
staging/production.

## Known limitations

- **Flag independence is proven at unit level, not e2e.** Flags are inlined at
  build time, so an e2e matrix would need one build per combination. The unit
  tests assert independence directly and each flag gates its own render path.
- **"Needs your reply" is defined but never emitted** until Phase B supplies
  explicit response expectations. This is deliberate honesty, not dead code.
- **Engagement evidence is only available for the open record**, so
  "Confirm start" surfaces on the selected interaction rather than across the list.
- The decision surface offers stage choices; richer per-intent composer flows
  are Phase B.

## Defects found outside Phase A scope (not fixed here)

- `components/job-details/JobActionsPanel.tsx` declares `data-testid="job-apply-button"`
  **twice** (lines 312 and 324). Committed at HEAD and owned by the job workstream;
  it causes strict-mode violations in `qa-personas.spec.ts:474` and
  `smoke.spec.ts:453`. Reported rather than fixed, to avoid colliding with active
  job-domain work.

## Phase B implemented (B1, B2, B3, B4)

**B1 — durable per-user preferences** (`interaction_user_preferences`, migration
0045). Keyed on the *conversation*, because that is the one identifier surviving
every mode: the record is the thread on both sides, so switching between talent
and recruiter modes — or acting through a hiring identity — still resolves to one
row. Bounded to named columns rather than a JSON blob, and timestamps rather than
booleans so "how long has this sat starred?" is answerable. Privacy is
structural: every endpoint resolves the row from the authenticated user, so no
parameter exists through which one participant could read the other's
organisation, and there is no admin bypass. Concurrency is arbitrated by the
unique constraint, not by checking. Star is optimistic with rollback.

**B2 — deliberate-open Auto-Reviewing** (`review_started_at`, migration 0046).
Reading an application *is* reviewing it. Record-level rather than per-user,
because each interaction has one managing side and that is the question the New
queue asks; a future per-member fact belongs in B1's table, which is already
keyed per user. The timestamp is written once and never moved, so a short Undo
can restore the visible stage without fabricating a "never opened" history.
Failure is silent and releases its guard so a later attempt can succeed.

**B4 — Shortlisted retired** (migration 0047). It conflated a private "keep in
mind" with a real update some applicants were actually told. Never-communicated
records become Reviewing plus a private Star; communicated ones keep every
trusted event, message, notification and timeline entry and read as **"Under
consideration"** until a later shared outcome supersedes them. Nothing
transitions into it any more, but records already in it can still move forward
and the schema still accepts the value, so older clients keep working.

## Phase B user-facing completion

Queues, snooze and "No reply needed" are now reachable. Three judgements shaped
the surface:

- **Queues appear only when they hold work.** A permanent row of ten tabs, most
  reading zero, would be clutter pretending to be information. Counts and rows
  come from one derivation so a chip can never promise a number the list cannot
  show.
- **Filtering never changes what you are reading.** The queue narrows the
  rendered list but is deliberately excluded from selection normalisation.
- **Personal organisation stays in the overflow.** Snooze and "No reply needed"
  quieten a recommendation, not the relationship: the thread stays visible and
  messageable, no status moves, the counterparty learns nothing, and both are
  reversible. The dismissal is offered only when something actually recommends a
  reply.

## Phase C implemented

### Interview coordination (migration 0048)

The gap: arranging an interview was a stage change and a hope. The applicant was
told they had been "invited to interview" and had to work out *when* from the
conversation.

**Deliberately not a calendar.** No third-party invitations, availability grids,
recurrence, external sync, or reminder scheduler. Those are the features that
turn scheduling into administration. The scope is the four facts two people need
in order to meet.

Three judgements shaped it:

- **One row per conversation**, for the same reason `interaction_user_preferences`
  is keyed that way: the conversation is the one identifier surviving every mode,
  so a recruiter acting through a hiring identity and the applicant replying from
  their own account resolve to a single arrangement. Rescheduling updates the row;
  the history of what was proposed lives in the thread, where both people can
  already read it, so the table never becomes a second, divergent narrative.
- **One authoritative status path.** An invitation on an application moves the
  record through `transition_application`, which already owns the version check,
  the trusted event, the exactly-once notification and the delivery intent. That
  service gained optional `detail_line` and `note` parameters so an invitation
  arrives as one complete statement rather than a headline chased by a second
  message. Both default to the previous behaviour exactly.
- **Nothing is inferred.** No message text is parsed. Marking an interview
  complete is private bookkeeping — no message, no notification, no
  participant-visible change — and it decides nothing. Cancelling always tells
  the other participant, who may have blocked out the time, but never touches the
  stage: calling off a call is not a decision about the person.

**Talent-side parity without inventing vocabulary.** A hiring request has no
Interviewing stage, because a call before accepting is not an acceptance. The
arrangement is recorded and announced; the request stays where it was.

### Workload assistance

**Reminders are a reading of state, not a delivery.** One line, derived from the
queues, present while the work is and gone when it is not — so there is nothing
to repeat, nothing to dismiss, and no scheduler to build. An email or push for
"you have three decisions waiting" would need a cadence, an unsubscribe, and a
quiet-hours policy: that is the separate reminder framework the brief ruled out.
Snoozes and dismissals are honoured structurally rather than by a second set of
checks, and nothing is ever mentioned while the other participant owes the move.

**Per-job summaries live in the Pipeline.** They began above the Inbox list and
the visual pass killed that placement: reminder, summaries, queue chips and
unread count stacked four bars above the conversations people came to read. The
Pipeline is the surveying lens in this product and a per-job breakdown is a
survey. No percentages — that would imply a fixed denominator and a linear
funnel, and hiring has neither.

**Empty states distinguish an empty system from an empty filter.** Telling
someone "no applications" when they have forty and a chip selected is how a
product loses trust.

### Defects found by using the product

| Defect | Why it mattered | Fix |
|---|---|---|
| **Stored instants came back naive.** SQLite has no time-zone type, so `isoformat` emitted no offset and the browser parsed it as *its* local time — the card read 10:30 AM beside a message saying 4:00 PM. | A confident, wrong interview time is the single worst thing this feature could do. | Every read goes through `_as_utc`; regression-tested with a half-hour-offset zone so a dropped conversion cannot coincidentally look right. |
| **Locale-dependent text rendered on the server.** Same defect by another route: a hydration mismatch leaves the server's zone on screen. | ditto | `useHydrated` (a `useSyncExternalStore` gate); the organiser's pre-rendered label holds the space until the client can do better. |
| **The talent list said "Nothing needs you right now" while the open conversation asked them to confirm an interview.** | Four surfaces disagreeing is how a queue stops being trusted. | `interviewAwaitingMyConfirmation` feeds the shared derivation, so the chip, the row label, the header action and the card now come from one source. Only the invited side is told — the organiser is waiting, not owing. |
| **The start-confirmation queue could never populate.** Phase A could only see the engagement of the record already opened. | The highest-priority queue was structurally empty. | `GET /me/engagements` — one list-wide read, scoped by participation. |
| **The mobile Inbox dropped you into a conversation.** Restoring the last selection also opened it, and on a phone the list and conversation are separate screens — so tapping "Inbox" landed in whichever thread you last read, with Back as the only way out. | Also the true cause of a long-standing "load-sensitive flake": the race was the product's, not the test's. | The selection is restored; the automatic descent is withheld below `lg`. `?thread=` still opens. |
| **The sticky arrangement card was translucent.** Messages scrolling under it were unreadable. | A scheduling detail is exactly the wrong text to render ambiguously. | Opaque, with a shadow rather than transparency saying "this floats". |
| **Touch targets on the arrangement were 32px.** | These are tapped while walking to a meeting. | 44px on mobile, compact from a pointer device up. |

### Accessibility: what was fixed, and what was not

Every piece of text this work introduced clears 4.5:1. **The muted scale it
inherited does not.** `text-white/32` … `text-white/45` at 10–13px on a
near-black background measures **2.8–4.16 across 33 nodes**, in components this
task does not own: the global DEV badge, the portfolio card, the job facts rail,
the status pills, the row meta lines.

That is a design-system decision with product-wide visual consequences — raising
the whole muted scale changes how every surface reads — so it is measured and
recorded here rather than quietly half-fixed inside one feature. The axe
assertion in `workspace-accessibility.spec.ts` is scoped to the surfaces this
work is responsible for, which keeps it true instead of permanently red or muted
behind an allowlist that would grow.

One false positive was removed at the source: axe sampled surfaces mid-fade —
`.ui-crossfade` animates opacity on a *container*, so every descendant read
dimmer than it renders. The sweep now waits for finite animations to settle.

### Performance

Budgets, not benchmarks: deliberately loose, so the suite catches "this feels
broken" rather than defending a millisecond, and every measurement is printed so
the trend stays visible. Measured locally on the QA stack:

| | |
|---|---|
| Initial load → first conversation row | 357 ms |
| Conversation switch | 72 ms |
| Inbox ↔ Pipeline | 43–59 ms |
| Queue filter | 31 ms |
| Send → message on screen | 40 ms |
| Offline → recovered | 39 ms |

The three list-wide reads Phase B and C added (`/me/interaction-preferences`,
`/me/interviews`, `/me/engagements`) are asserted to stay **one request each**,
so a queue count can never silently become N round-trips; conversation details
are asserted to load on demand. No virtualization was added — nothing in the
measurements justified it.

## Known limitations

- **Flag independence is proven at unit level, not e2e.** Flags are inlined at
  build time, so a matrix would need one build per combination. The workflow
  audit asserts the property the flags exist to protect instead: nothing
  assistive is load-bearing.
- **Interview coordination has no email or push reminder.** Deliberate — see
  "reminders are a reading of state" above.
- **The muted-text contrast scale is a recorded finding, not a fix.** Numbers
  above.
- **`restoreScenario` does not clear `interaction_interviews`,** so an
  arrangement made by one QA test is visible to the next in the same worker.
  Tests are written to tolerate it; the scenario reset could usefully be widened.
