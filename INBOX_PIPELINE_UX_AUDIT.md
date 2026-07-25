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

## Deferred

**B** — `interaction_user_preferences` (Star, snooze, prompt dismissal); auto-Reviewing
behind its own flag with instrumented dwell threshold and `review_started_at`;
decision-aware composer intents (optional accelerators, freeform always fastest);
trustworthy work queues; Shortlisted → Star migration with "Under consideration"
compatibility.

**C** — interview coordination, consolidated reminders, per-job summaries,
optional confirmed suggestions, analytics-driven refinement.
