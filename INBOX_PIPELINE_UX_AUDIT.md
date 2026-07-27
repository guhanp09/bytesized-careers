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

---

# Visual redesign and product-wide contrast remediation

The functionality above was accepted; the interface it produced was not. It was
uniformly flat — three panes at one tone separated by hairlines, nothing casting
a shadow, and every row led by backend vocabulary rather than by a person.

## What the screenshots showed

Audited by running the product against backend-backed data and inspecting
captures, not by reading code.

| # | Finding |
|---|---|
| S1 | **One tonal value everywhere.** List, conversation and context rail all near-identical; only a 1px hairline separated them. |
| S2 | **The open row was barely open** — a 1px left border and a ~2% background change. |
| S3 | **Backend vocabulary led the hierarchy.** "Received application" was the topmost line of every row, above the name. |
| S4 | **Labels floated away from values.** A fixed 112px label column put every value a hundred pixels from the word describing it, worse the narrower the rail. |
| S5 | **Chips for ordinary metadata** — "2 items", "₹3000 per video", "2-day turnaround". |
| S6 | **Chrome stack** — up to six bars before the first row; ~250px of a 700px phone. |
| S7 | Queue chips clipped with no scroll affordance and no visible way back to "all". |
| S8 | Timestamps competed with controls at the row's top-right. |
| S9 | **630 occurrences of `text-white/30…48` across 104 files**, measuring 2.8–4.16:1. |
| S10 | **No elevation anywhere.** Cards were indistinguishable from their containers. |
| P1 | Pipeline sections were full-width bands holding one narrow portrait card. |
| P2 | Cards shared their section's fill and cast no shadow. |
| P5 | Three chip-ish elements plus a four-line quote per card. |

## The surface model

Before: one background, one border, repeated. After: a tonal ladder, where each
layer is separated by tone *and* elevation, never by border alone.

| Layer | Token | Used for |
|---|---|---|
| Canvas | `canvas` #08080b + `surface-canvas` | the workspace ground; a vertical fall and one corner lift so the viewport has a top |
| Shell | `shell` #0c0c10 | the conversation column, the summary strip |
| Panel | `panel` #101015 | the recessed conversation list |
| Raised | `raised` #16161c + `surface-raised` | cards, the detail header, the composer, the open row |
| Elevated | `elevated` #1d1d24 + `surface-elevated` | decision surface, arrangement card, active queue chip |
| Overlay | `overlay` #23232c | menus, controls sitting on a raised card |

Elevation is four levels, each pairing an ambient shadow with a 1px inner top
highlight. Shadow alone reads as a drop-shadow *effect* on a dark UI; the inner
highlight is what makes a surface look lit from above.

## Gradients, and why each exists

Six, all subtle, none decorative:

| Gradient | Explains |
|---|---|
| `surface-canvas` | where the page begins |
| `surface-raised` / `surface-elevated` | that a surface is lit from above, matching the elevation inset |
| `surface-selected` | which row is open — a lit band under the accent edge rather than a rule |
| `surface-primary` | that the recommended action is a physical key; text stays pure black (~19:1) |
| `surface-inset` | that a field or a rail is recessed and therefore editable/scrollable |
| queue-rail edge fade | that a clipped chip means "more this way", not a broken layout |

Only a **confident** recommendation wears the filled gradient. "Choose next
step" is the neutral fallback the derivation returns when it will not guess, and
dressing it as a primary would assert certainty the product explicitly refused
to claim. Asserted in `workspace-visual-system.spec.ts`.

## Typography and spacing

Six text tokens replace twenty-five ad-hoc opacities. The row scale is now
name 13.5px/600 → opportunity 12px → snippet 12px subtle → timestamp 11px
tabular. Group headings moved off 9–11px tracked-out uppercase, which is the
least readable text in a UI and was being used for *every* group, so nothing
stood out from anything else.

## Awkward labels corrected

| Was | Now |
|---|---|
| "Received application" as the row's first line | a directional mark on the avatar, keeping the full phrase as its accessible name |
| Row snippet repeating the opportunity title shown one line above | the last thing actually said in the conversation |
| Fixed 112px label column with the value far right | a definition list whose label column sizes to its longest label |
| "PORTFOLIO" + a "2 items" chip | "Portfolio  2 items" — a count is metadata, not a status |
| Stage pill competing with the recommended action (and truncating the name to "Priy…") | grouped with the opportunity under the name: *Long-form video editor · ● Responded* |
| Two stacked metadata chips per Pipeline card | one quiet icon·value run with separators |

## Contrast: before and after

| | Before | After |
|---|---|---|
| Failing text sites | 630 across 104 files | 0 |
| Measured range | 2.8 – 4.16:1 | every informational tier ≥ 4.5:1 on every surface |
| axe, Inbox list | serious violations present | 0 |
| axe, conversation | serious violations present | 0 |
| axe, Pipeline | 33 nodes incl. 14 `nested-interactive` | 0 |
| axe, `/jobs` | serious violations present | 0 |

The migration was **banded**, not blanket: failing bands moved onto the scale
while preserving each component's relative hierarchy, and bands already above AA
were left alone. Token values are proved in `tests/contrastTokens.test.mjs`,
which parses them out of `globals.css` so it cannot drift from what ships, and
which caught `line-strong` at 2.52:1 during authoring.

Two edge cases the band function got wrong, corrected by hand: `text-white/0` is
an invisible hover-reveal, not muted text; and a disabled wizard control belongs
in `text-disabled`, the one tier WCAG permits below AA.

`nested-interactive` was structural, not colour: Pipeline cards were
`role="button"` containing a link, a checkbox, a menu and a Message button. The
card is no longer a button; the labelled Message button is the keyboard path,
which is also the honest description of what it does.

axe now runs against the **whole document**. It had been scoped to the surfaces
this workstream owned, because the inherited scale failed product-wide; with
tokens in place that exemption has no justification, and a scoped accessibility
assertion is one that stops finding things.

## Motion

Three rules: motion may only explain a change, nothing loops, nothing delays an
interaction. `ui-rise` for surfaces the user asked for, `ui-ack` for a private
reversible act, `ui-crossfade` for content swapping in place. Under
`prefers-reduced-motion` all animations *and the transitions* are disabled —
the previous block covered only animations, and shortening is not reducing.

**No sound. No haptics.**

## Patterns considered and rejected

- **Kanban columns for the Pipeline.** Would have restructured a working view
  rather than refining it, and the stage count makes horizontal scrolling worse
  than vertical grouping.
- **A new brand accent.** The accent stays white. The five state hues were
  already in the pipeline taxonomy as stage dots and were promoted to a system;
  inventing a brand colour is a decision that needs sign-off, not a refactor.
- **Screenshot-diff tests.** They fail on every deliberate change and explain
  nothing. The visual-system suite asserts *properties* instead: that layers
  differ, that the open row differs by more than a border, that depth exists
  where the design claims it, that no text sits unreadable under a gradient.
- **Repainting the whole product's already-compliant muted text.** Real churn
  across areas this task has no business changing.

## Known limitation

A Pipeline stage holding one card still leaves horizontal space in its band.
That is a property of the vertical stage-section layout, not a styling defect;
closing it would mean changing the view's architecture.

---

# Phase 2 — workspace navigation extraction and IA collapse

## The problem

Reaching a conversation meant descending five stacked control layers, four of
which were permanent chrome:

| # | Control | Concept | Where it lived |
|---|---|---|---|
| 0 | Global header + left rail | application navigation | `Header.tsx`, `Sidebar.tsx` |
| 1 | `Talent | Recruiter` segmented | workspace identity | `WorkspaceControls` |
| 2 | `Inbox | Pipeline` segmented | workspace view | `WorkspaceControls`, same bar |
| 3 | `All / Applicants / Outreach / Archived` | ownership scope | `FilterBar` |
| 4 | work reminder | route into a queue | inline |
| 5 | queue chip rail | attention scope | inline |
| — | caught-up line, unread total | readouts, not choices | inline |

Two more sat on the Pipeline: an `Applicants | Outreach` bar, and a per-job
workload strip, above the board's own scope row.

Measured on the running product at 1440×900, recruiter Inbox: **94px of chrome
across up to seven stacked rows** before the first conversation, and on mobile
Pipeline at 390px, **252px across five rows**.

Two separate problems compounded it.

**Layers 1 and 2 were styled identically to the global search scope.** The
header's `Jobs | Talent` control and the workspace's `Talent | Recruiter`
control were both two-option segmented groups with the same inverted
`bg-white text-black` active pill, sitting on screen at the same time. One
narrows a search; the other changes which side of the marketplace you are
operating as. Controls that look and behave the same teach the user they mean
the same kind of thing.

**Readouts were occupying navigation levels.** The caught-up line and the
unread total were full-width bars the user cannot act on.

## The final model

Three layers, two bars.

| Layer | Question | Control |
|---|---|---|
| 1 — identity | who am I acting as | `WorkspacePersonaControl` — a menu |
| 2 — view | how am I looking at this | `WorkspaceViewSwitcher` — segmented |
| 3 — scope | which subset is on screen | `InteractionScopeControl` |

Layers 1 and 2 share the first bar. They are different questions, but both are
answered once and rarely revisited, so a bar each spent permanent vertical
space on decisions nobody makes twice in a session.

Measured after: recruiter Inbox **94px across 2 bars**; mobile Pipeline
**172px across 2 bars** (from 252px across 5).

## Persona switching, made structurally different

The persona control is now a **disclosure**, not a toggle:

- reads `Working as Recruiter` with a chevron, so the current identity is
  stated rather than inferred from which half is highlighted;
- `aria-haspopup="menu"`, no `aria-pressed` — a disclosure has no pressed
  state, which is what makes it not a filter;
- each option carries a sentence naming what it contains ("People who applied
  to your jobs, and talent you contacted"), which two bare words could not;
- `role="menuitemradio"` with `aria-checked`, Escape closes and returns focus
  to the trigger, Enter and Space both open it;
- collapses to a plain label when the account has only one persona, rather than
  rendering a disclosure that opens onto a single already-active option.

The difference from search scope is structural, not chromatic — it survives a
restyle. The view switcher also dropped the inverted white pill for a raised
surface, so nothing in the workspace now mimics the search control.

Search scope was left exactly where it was: inside the search field, as a
search-domain choice. Persona and search scope remain independent state.

## Scope: two axes, one row

Ownership (All / Applicants / Outreach / Archived) and attention (work queues)
**compose** — a queue narrows whichever ownership scope is selected. Collapsing
them into a single list of options would have deleted a real capability, so
they share a row instead: tabs on the left, queues as a trailing disclosure.

The queue control is idle by default and shows only its icon and count; naming
the offer cost 90px of a 390px rail and pushed `Archived` off the end of the
tabs. Once a queue is on it names itself and grows a paired clear button, so
returning to everything is one click and needs no menu — the rail it replaces
made you find `All` among chips that scrolled.

The Pipeline's direction and workload controls moved *into* the board's own
scope row through a typed `scopeLeading` slot: the board decides where they
sit, the workspace decides what they do.

## What moved rather than went

Nothing was deleted. Every capability is still reachable:

| Was | Now |
|---|---|
| queue chip rail | trailing disclosure on the scope row, `queue-chip-*` ids intact |
| work reminder bar | first item in the list, scrolling with the work it points at |
| caught-up line | trailing readout on the scope row |
| unread total bar | trailing readout on the scope row |
| pipeline direction bar | leading control in the board's scope row |
| per-job workload strip | `Workload by job` disclosure, counts still route to queues and stages |

The reminder moved into the list on purpose: a conditional nudge that shifted
three navigation rows down whenever it appeared cost more than one that scrolls.

## Extracted components

`components/you/WorkspaceNavigation.tsx` (622 lines) now owns the surface:
`WorkspacePersonaControl`, `WorkspaceViewSwitcher`,
`ApplicationsWorkspaceNavigation`, `WorkQueueSelector`,
`InteractionScopeControl`, `SampleDataChip`, `filterOptionsFor`, and the four
workspace types. `ApplicationsWorkspace.tsx` went **5,495 → 5,301 lines** and
remains the coordinator: all state stays there, everything extracted is
presentational.

The extraction landed as its own commit with markup, class strings, test ids
and ARIA identical, verified by diffing each moved block against its source.

## Context preservation

Verified in the browser and held by tests:

- selecting a different ownership scope keeps the open conversation open;
- switching queues keeps it open, across every queue in turn;
- Inbox ↔ Pipeline round-trips and survives a reload;
- `?view=`, `?mode=`, `?direction=`, `?stage=` and `?thread=` all still steer
  the workspace, and a focused stage stays shareable in the URL;
- persona switching still remounts the workspace deliberately — the two sides
  carry different status vocabularies, so leaking a stage focus across them
  would hide records.

## Mobile

The list stays the landing screen and the conversation opens as a deliberate
detail with its own back control. Persona and view stay visible in the first
bar; chrome is under 140px, tested.

Below `md` the Pipeline's own three scope controls become one horizontally
scrollable strip rather than wrapping into a stack — four independent controls
cannot share a 297px row. The workspace-supplied controls stay outside that
strip: they are what a mobile user reaches for first, and the workload
disclosure opens a panel a scroll container would clip.

## Known limitations

- **Talent-mode scope tabs still truncate in the 390px list rail.**
  "All / Hiring requests / Applications / Archived" needs ~410px; the rail
  offers ~330px. The strip scrolls and now carries a fade so a clipped tab
  reads as "more this way", and every tab remains clickable and keyboard
  reachable — but `Archived` can start clipped. This is pre-existing (the old
  `FilterBar` had the same `overflow-x-auto` with *larger* gaps and no fade)
  and is improved rather than introduced here. Moving `Archived` out of the
  tabs was rejected: it would change what `applications-filter-archived` is,
  and archived is an ownership scope, not an attention refinement.
- The persona menu has no roving arrow-key navigation between items; it relies
  on Tab, which is correct but not the richest menu behaviour.

## Defects the QA pass found and fixed

Three, all caught in the browser or by tests rather than by reading the diff:

1. **`Archived` was pushed off the end of the scope tabs.** The idle queue
   control was spending 90px naming an offer. It now shows icon and count only
   until a queue is on.
2. **The view switcher teleported 763px when used.** Right-aligning it looked
   tidier, but it pinned to its container's right edge — the 390px list rail in
   the Inbox, the full workspace in the Pipeline — so the control moved the
   moment you pressed it. Both controls are now left-aligned. An existing test
   (`workspace controls stay fixed in place across Inbox and Pipeline`) caught
   this, which is exactly what it was written for.
3. **Mobile Pipeline stacked its scope controls three deep.** 252px of a 780px
   viewport. Below `md` the board's own controls became one scrollable strip:
   172px, two bars.

## Test churn, and why

Thirteen call sites drove the persona through
`getByRole("button", { name: "Recruiter", exact: true })` — the old segmented
control. That accessible name no longer exists, because the control is no
longer a segmented button. Rather than patch each site, specs now go through
`tests/e2e/workspacePersona.ts`, so the next change to this control costs one
edit. `qa-personas.spec.ts` imports it aliased: that file already owns a
`switchPersona` for QA *accounts*, which is a different concept from the
workspace's Talent/Recruiter identity — a collision worth noticing, since the
word is overloaded across this codebase.

A fourth spec, `a confident recommendation is visually filled where a neutral
one is not`, started failing when its file ran in order while passing alone.
Phase 2 did not change the button it measures — the classes it renders with are
`surface-primary text-black elev-2`, exactly right — but it changed render
timing enough to expose two latent faults in the test:

- it took whichever unread row came first, and the fixture's first unread row is
  a **Hired** record. A terminal record has nothing left to recommend, so it
  renders no primary action at all — the test was passing on ordering luck. It
  now excludes terminal records explicitly, which is what its own comment always
  claimed it was doing.
- it captured a locator, then measured `getComputedStyle` a moment later. React
  replaces that button whenever the recommendation is recomputed, and
  `getComputedStyle` on a discarded node returns an empty declaration — which
  reads as "the gradient is missing" when the gradient is on a newer element.
  It now resolves and measures in a single `page.evaluate`.

Worth recording because the failure mode is deceptive: an empty string from
`getComputedStyle` looks like a styling regression and is actually a stale
handle.

The queue specs moved from asserting a chip rail to asserting a disclosure, and
`the queue rail keeps a visible way back to everything` became
`the queue control keeps a one-click way back to everything` — the same
requirement against the control that now serves it.

## Rejected alternatives

- **One combined scope control.** Ownership and attention compose; a single
  select would have made them mutually exclusive and removed a capability.
- **Ownership scope as a `<select>` to free the row for queue chips.** Would
  have added a click to the most frequent action in the workspace.
- **Moving persona into the account menu.** Correct in principle, but this is a
  dual-mode product where switching is frequent; burying it behind the avatar
  would have made the common case slower. Naming it in place solves the
  confusion without the cost.
- **Colour-only differentiation of persona vs search scope.** Would not survive
  a restyle and would fail anyone not perceiving the hue difference.

---

# Phase 3 — making the workspace creator-specific

## What was already there

The inventory came first, and it changed the shape of the phase. CreatorJobs
*already* stores nearly everything a creator-specific inbox needs:

| Attribute | Canonical source | Reached the inbox? |
|---|---|---|
| platform | `jobs.platforms`, `portfolio.platforms` | no |
| format | `jobs.formats_hired_for`, `portfolio.formats` | no |
| niche | `jobs.content_niches` | no |
| turnaround | `jobs.turnaround_value/unit/basis` | no |
| compensation | `budget_amount/max/currency/unit`, `compensation_mode` | flattened to `budget: string` |
| paid trial | full `trial_*` model | no |
| revenue share | `budget_unit = "commission"` | no |
| audience | `jobs.channel_subscribers` | no |
| portfolio media | `thumbnail_url`, `duration`, `source_type`, `role` | link label only |
| upload cadence | — | absent everywhere |
| payment state | — | absent everywhere |

So almost nothing needed new backend schema. The gap was the *projection*:
`InteractionJobSnapshot` reduced a structured commercial model to a display
string and dropped the rest, which is why the workspace could only ever render
a generic job. Two things genuinely did not exist — upload cadence, which is
carried as an optional free-text field and shown only where a record has one
rather than being invented, and payment state, which is the only new schema.

`lib/creatorProjection.ts` is therefore a projection, not a second source of
truth. Compensation and turnaround are formatted by the same
`lib/jobPresentation.ts` functions the public job pages use.

## Portfolio-first

Cards lead with evidence: one item large enough to judge, up to two supporting
tiles, then a fit line **derived from the items themselves** — three finance
explainers is evidence of a finance editor, where a niche list is an assertion.
Identity and the primary action stay ahead of it.

Posters are generated locally from each item's id. The alternative to a grey
rectangle is not fetching the real thumbnail: oEmbed means a network request per
card, third-party calls from a hiring inbox, and a layout that breaks when the
request fails — for a decorative image. Posters vary along colour, pattern and
rotation (six palettes × four patterns × rotation), every palette stop clears
4.5:1 against white overlay text, and the pattern is an inline data URI. A real
thumbnail is preferred; a broken one falls back to the poster rather than
leaving the browser's broken-image glyph.

**There is no play button.** The media cue is a neutral film glyph, not
`circle-play`: the tile opens the work in a new tab and does not play anything
in place, so a play triangle would promise playback that never arrives.

## The two distinctions the model refuses to blur

**An amount never appears without its unit.** ₹3,000 per video is ordinary;
₹3,000 as a monthly retainer is close to unpaid. The unit is what makes the
number mean anything, so the headline always carries it.

**Undisclosed is not unpaid.** Silence is reported as undisclosed. "Unpaid
collaboration" is asserted only where a record says so, is rendered in words
with no currency glyph or tabular figures, and is never styled like a rate. A
trial sits *beside* the ongoing rate and never replaces it — an audition fee
and an ongoing rate are different commitments.

Currency is preserved and never converted.

## Turnaround carries both forms

A recruiter wants to filter to "within a week" *and* read "3 business days to
first draft". One normalised value cannot do both, so `CreatorTurnaround`
carries the formatter's wording, a comparable magnitude, and a bucket.
Unspecified sorts last: an unknown turnaround is not a fast one.

## Audience is banded

`250K–500K subscribers`, never `487,213`. A precise figure moves daily, implies
a verification the platform does not perform, and tells a reader nothing more.

## Filters

Options are derived from the records on screen, so the control can only offer a
value some record actually has — a vocabulary-driven menu would offer Twitch on
a board with no Twitch work and return nothing. A record that does not carry
the attribute is excluded rather than waved through, or the filter is
decorative. Kept structurally apart from the work queues: queues are
recommendations about what needs you, these are facts about what the work is.

## Payment state — a separate plane

Recorded on the **engagement**, not the application, because it is a property of
the work rather than of the hiring decision. That placement *is* the separation:
the application lifecycle has no field to read.

Migration `0049` adds `payment_state`, `payment_state_updated_at` and
`payment_note` — all nullable, no default, so every existing engagement keeps
meaning what it meant before. NULL passes the vocabulary constraint, so nothing
needed backfilling. Verified on local PostgreSQL: upgrade to head, downgrade
back through `0049` to `0038`, reload fixtures, upgrade again.

Sixteen tests pin the separation rather than the feature — most importantly
that a **disputed** payment does not block start or completion, which is the
case a naive implementation gets wrong.

There is no payment processing behind this: no checkout, wallet, escrow, payout
or invoice. The copy is written so a reader cannot conclude otherwise —
"Funded" says the payer reported funding and deliberately does not say funds
are held, secured or protected. The card renders nothing when no state is set,
sits in the rail beside the arrangement rather than in the status column, and
says plainly that payments are arranged outside CreatorJobs. It is not a status
pill: a payment badge beside a stage badge is how a reader concludes one drives
the other.

## Defects found in the browser and fixed

1. **Portfolio rendered twice.** A rail review section was built, then removed —
   it put the same evidence on screen twice. The honest fix was to give the
   application's existing portfolio list the artwork rather than add a
   competing surface.
2. **`circle-play` on every video tile** read as an inert play button.
3. **Titles truncated to "Retention reb…"** — a 132px poster on a 280px card
   left ~120px for the title. Card artwork is now sized so titles are legible.
4. **A hydration mismatch (React #418)** from Phase 1's `AbsoluteTimeOnFocus`,
   which renders a timezone-formatted date without `suppressHydrationWarning`.
   Pre-existing; fixed because it fires on the surface this phase changes.

## Known limitations

- **Upload cadence has no canonical backend field.** It is carried as optional
  free text on the snapshot and populated in the fixture; a real listing shows
  it only if something supplies it. Fabricating a cadence from posting history
  was rejected — it would be a guess presented as a fact about someone's channel.
- **One pipeline card overflows its column by ~10px at 390px.** It carries no
  portfolio, so this is the Phase 1 card template rather than anything added
  here; the board scrolls horizontally by design at that width.
- **Payment state is read-only and has no writer.** No endpoint sets it; the
  tests write it directly. That is deliberate for this phase.
- Niche and platform values are normalised for display but not reconciled
  against a controlled vocabulary, so two spellings of one niche would show as
  two filter options.

## Rejected

- **oEmbed / thumbnail scraping** — a network request per card and a broken
  layout on failure, for decoration.
- **A dense filter builder** — a hiring inbox is not an ATS query surface.
- **Payment state in the application status enum** — it would make a payment
  provider's report part of the hiring lifecycle, and every transition rule
  would eventually consult it.
- **Exact subscriber counts** — precision the platform cannot stand behind.

# Phase 4 — one canonical, deterministic scenario corpus

## The problem

Two datasets described the same product. `lib/seed/ownerInteractionFixtures.ts`
held nine hand-written interactions for Mock mode; the backend QA scenarios held
their own rows. Neither knew about the other, so every state added to one was a
state the other silently lacked, and a defect visible in Mock mode could be
invisible in Backend mode — or the reverse. The nine records also could not
cover what the product had become: a handful of stages, no payment plane, no
volume, no identity edge cases.

The requirement was not "a bigger fixture". It was **one generator**, producing
**language-neutral manifests**, consumed by **two thin consumers**.

## The architecture

```
backend/app/db/creator_scenarios/     ← the only generator
  schema.py      dataclasses, canonical vocabularies, scenario_id()
  pools.py       names, channels, roles, rates, turnarounds, copy, answer sets
  heroes.py      17 hand-authored journeys
  generator.py   builders for the six scenarios
  validation.py  what a manifest must satisfy to be one
  restore.py     the backend consumer
        │
        ▼
fixtures/creator_scenarios/generated/*.json    ← six manifests, committed
        │
        ├──► backend: restore_manifest()  → the real tables, via the existing
        │                                    confirmation-gated QA registry
        └──► frontend: toOwnerInteractions() → the workspace, in Mock mode
```

**Determinism is structural rather than careful.** Identifiers are UUID5 keyed
by *meaning* — `scenario_id("relationship", scenario, "hero:disputed-payment")`
— not by position, so adding a record does not renumber the ones already there.
That is what makes an id safe to write into documentation. Collections are
emitted sorted, and `random.Random(seed)` is drawn from in a fixed order.
`python -m app.db.creator_scenarios --check` proves regeneration is
byte-identical.

**Time is offsets, not timestamps.** A manifest stores `created_offset: -7776000`,
never a date and never a preformatted label. Each consumer materialises
`anchor + offset`: a fixed anchor for deterministic comparison, `now` for
browsing, so a developer sees "4h ago" rather than a date from whenever the file
was generated. This is also the only reason the files can stay byte-identical in
git.

**The manifests carry no display strings.** No "₹15,000 per month", no "2 days
ago", no "Under consideration". Every one of those is produced by the same
product function both paths already call — `formatTalentRate`,
`formatInteractionTime`, `interactionStatusFromBackend`. A second formatter in
the adapter is precisely the drift this phase exists to remove, and the one
place a rate *unit* was tempting, the adapter went without it because
`TalentListing` has no column for one.

## Consumer responsibilities

| | Backend consumer | Frontend consumer |
| --- | --- | --- |
| Entry point | `restore_manifest()` | `toOwnerInteractions()` |
| Gate | Existing QA registry, `RESTORE <NAME>` confirmation | Dev-only server route, `isProductionRuntime()` |
| Writes | Real tables, repeat-safe | Nothing — pure adaptation |
| Time | `anchor + offset` as aware UTC | `anchor + offset` as ISO |
| Exceptions | `DIRECT_INSERTIONS`, each documented | none |

The backend consumer inserts some state directly rather than through services —
a historical status, a message with its own timestamp — because services stamp
"now" and refuse transitions that really happened. Each exception is listed in
`DIRECT_INSERTIONS` with the reason, and a test fails if one is added without one.

## Production-bundle exclusion

Hiding the Mock toggle would not have achieved this: the JSON would still be in
the download. The boundary is that manifests are read from disk by a server-only
route handler using `node:fs`, so no component import can bundle them.
`tests/scenarioBundleExclusion.test.mjs` asserts that property against the
**actual build output** — seed sentinels absent from every client chunk, no chunk
large enough to be an inlined manifest, nothing under `public/`, and the loader
still using `node:fs` rather than importing JSON.

## Scenario selection

`?seed=` names a scenario. In Mock mode it selects the dataset immediately. In
Backend mode it deliberately restores **nothing** — a URL that rewrote the
database would make every shared link destructive; the parameter only preselects
which scenario the confirmation-gated restore should point at. An unknown name
is a stated error naming the known list, never a silent fall back to `default`,
because an afternoon spent testing the wrong dataset is worse than being told
you mistyped.

## Volume and performance

`busy` carries 329 records with a 214-applicant job. Measured: 117 ms to first
card, ~22k DOM nodes, ~32 MB heap, 468 ms for a search across the board. Usable,
and honest about its limit: **the board has no virtualisation.** Every card
renders. At 214 applicants that is acceptable; at several thousand it would not
be, and the fix is windowing rather than a smaller fixture.

# Phase 5 — parity, retirement, and what parity found

## Parity design

The suite compares **the two code paths**, not two readings of one file:

```
manifest ──► restore_manifest() ──► real tables ──► /me/activity/summary
                                                          │
                                                    toFrontendJob()
                                                          │
                                          mapActivityToOwnerInteractions()
                                                          │
                                                          ▼
                                                   OwnerInteraction
                                                          ▲
manifest ──────────────────────────────────────► toOwnerInteractions()
```

Records are keyed by **id *and* direction**, because one relationship is a
different interaction to each side — comparing a recruiter's received view
against the applicant's sent view of the same row proves nothing.

The comparison is an **explicit semantic projection**, not a snapshot with keys
deleted until it passes. It covers identity, display name and pseudonymous
fallback, direction, kind, job context and listing status, canonical stage,
participant-visible stage, private manager note, portfolio, platform, format,
niche, turnaround, commercial terms, the talent and recruiter context cards, the
structured first-message answers, and both timestamps.

The backend payload is **scratch output**, gitignored. A committed copy would be
exactly the second dataset this phase exists to remove, and it would go stale in
silence.

### Permitted exclusions

Only two kinds, each documented individually in `tests/scenarioParity.test.mjs`:

- **No user-facing meaning** — row insertion timestamps, `status_version`
  optimistic-concurrency bookkeeping, environment-specific avatar and logo URLs,
  the legacy preformatted `budget` string (the structured model is compared
  field by field instead).
- **Not carried by this endpoint** — conversation messages, and engagement and
  payment state, both of which reach the workspace through the per-conversation
  thread endpoint rather than the activity summary. Star and Snooze are
  client-only in this phase and exist on neither path.

## The harness was wrong before the product was

Parity first reported 5/6, with edge records missing portfolios. The portfolios
were there. **The suite was not looking where the product looks**, in two ways:

1. It read `item.portfolio` instead of `portfolioForInteraction()`, which every
   call site uses and which reads the `relevant_portfolio` answer.
2. It fed raw snake_case jobs to the mapper, skipping the `toFrontendJob`
   normalisation `getActivitySummary` always applies — so the client's own
   camelCase conversion looked like missing backend fields.

Two of the three "backend path gaps" recorded in the previous phase therefore
**did not exist**. `formats_hired_for` and `content_niches` are in the payload;
`first_message_answers` is exposed on sent applications. Both entries are kept
in `BACKEND_PATH_GAPS`, labelled `NOT A GAP` with the real reason, rather than
deleted — a parity suite that silently rewrites its own history is worth nothing.

A third harness defect hid everything else: the dump walked accounts in table
order, and for `default` the first forty with any activity were all applicants,
so the suite compared **zero received applications** and called it parity. It
now selects both sides from the relationships themselves, covers all five
scenarios that have records, and asserts the coverage in the dump *and* in Node.

## Defects parity found, once it was measuring the real path

| # | Defect | Consequence |
| --- | --- | --- |
| 1 | Mock adapter read `stage` for the sent view | An applicant saw the recruiter's **private** "not proceeding" as their own status |
| 2 | Sent applications fell back to the literal `"Recruiter"` | Every recruiter in an applicant's list shared one name — the Phase 1 "Applicant" defect, alive on the sent side |
| 3 | `under_consideration` missing from the status union | A legacy shortlisted record reached the workspace with **`status: undefined`** — a row showing no state — and blanked the job-detail CTA |
| 4 | `jobSnapshotFromJob` hardcoded `listingStatus: null` | Backend mode could not tell a closed listing from an open one |
| 5 | Restore wrote no `relevant_portfolio`, no archive state, no hiring identity, no experience level, and a name-only applicant snapshot | Backend mode showed empty portfolios, unarchived archives, nameless recruiters and half-empty context cards |
| 6 | Generator emitted a `0` base rate for revenue share | `JobRead` correctly refused it |
| 7 | `talent` scenario gave one recruiter six standing offers to one person | The product's unique constraint refuses it; the restore failed at the INSERT |

(1) is the most serious: a privacy leak, caught on the rejected-after-hired
conflict fixture. (3) is the most quietly damaging: it had two separate
symptoms in two files and the type union was wrong in a way that made the
missing `switch` branch invisible.

(7) is now impossible to reintroduce silently — `validation.py` rejects the
shape at generation time, so a manifest that cannot be restored fails with a
sentence instead of a stack trace.

The sent-side counterparty identity fix is the only one of the three original
"gaps" that was real. It is fixed in **two layers**: the mapper now uses
`displayPersonName` at all four sites where a generic name could appear, so the
fallback is a stable per-person handle (`@channel_4f2a`) rather than a shared
word; and the restore populates each job's hiring identity from its owner, so
the fallback is reached only when a name genuinely does not exist. Emails and
raw identifiers are never exposed.

## Retiring the hand-written fixture

Retiring it honestly meant first noticing what it was still carrying that the
generated corpus was not. Three surfaces would have quietly emptied:

- **The talent and recruiter context cards.** The adapter emitted no snapshot at
  all, so every hiring request would have rendered a card with a name and
  nothing under it. Actors now carry rate, exact experience years and
  availability; the restore writes them onto the listing; and the adapter builds
  the card by calling the product's own `talentSnapshotFromListing`. A received
  application deliberately gets the **thinner** snapshot the backend actually
  stores — a Mock card richer than the real one sends people hunting for a bug
  that is a generous fixture.
- **Structured first-message answers.** The corpus answered only
  `relevant_portfolio`. `Relationship.answers` existed in the schema but was
  never populated and never read — dead. It is now generated, restored and
  adapted end to end, so every key both contexts offer is exercised.
- **The applicant snapshot**, which held a display name and nothing else.

The three tests that policed the fixture's *source text* now assert the same
properties about the canonical corpus. A test reading a file no code path loads
proves nothing.

Precedence is tested rather than described: explicit `?seed=` beats a stored
preference beats `default`; an unknown name errors with the known list; a
retired stored name degrades cleanly; and no query parameter can reach a
restore.

## The scenario index, and SCENARIOS.md

Every manifest carries an index: the records worth looking at, with the route,
persona, expected stage, condition and the action to test. Fifteen tests make it
trustworthy — every entry resolves, every route names a real view and seed, and
**the stage an entry claims is the stage the record is in**. An index that
misdescribes a record is worse than none: it sends someone to check a state that
is not there and they file a bug against it.

Validating it exposed indexing gaps: sixteen snoozed records and a starred
record were findable only by scrolling, and the three transient client-only
conditions — unsent draft, failed send, broken thumbnail — were generated and
then never indexed. A transient state nobody can find is a state nobody tests.

`SCENARIOS.md` is **generated** by `scripts/generate-scenarios-doc.mjs`, not
written. A hand-maintained record map over several hundred generated records is
stale the first time anyone regenerates. `--check` fails on drift, and a test
runs it.

Two of these checks failed first on their own reason for existing: they flagged
QA instructions reading "confirm the card does not claim funds are held" as
payment-custody claims. Both now assert on claims rather than on keywords.

## Accepted disagreement — Pipeline defect 11

Recorded rather than silently dropped: the recommendation to collapse the
Pipeline's stage vocabulary into the Inbox's display vocabulary was **not**
adopted. They are different questions. The Inbox asks "whose turn is it", which
is direction-dependent; the Pipeline asks "where is this in the process", which
is not. Merging them would make the board's columns change meaning depending on
which side you were viewing from.

## The import-parser benchmark

Classified as an external failure with a design flaw, not a regression: it
measures wall-clock parse time on a shared machine with no warm-up and no
statistical treatment, so it fails under parallel load and passes in isolation.
It is a timing assertion pretending to be a correctness assertion.

## Limitations and deferred work

- **The Pipeline board does not virtualise.** Measured and accepted at `busy`
  volume; windowing is the fix if volume grows.
- **Star, Snooze and "No reply needed" are client-only** in this phase, so they
  are neither restored nor compared. The durable per-user model is Phase B.
- **Engagement and payment parity is asserted against the database** by the
  restore tests, not through the activity summary, which does not carry them.
- **SQLite drops timezone offsets.** The columns are `DateTime(timezone=True)`
  and the restore writes aware UTC instants, but the disposable test database
  returns naive strings; the parity harness reads them as UTC, which is what
  they are. Worth confirming against PostgreSQL before relying on it in a
  dev environment that renders times.
- **No real payment processing** anywhere: no checkout, wallet, escrow, payout
  or invoice, and no scenario claims funds are held.
- **The workspace e2e specs are not yet ported to the canonical corpus.** They
  were written against the retired nine-record fixture and assert its counts and
  names; Mock mode now serves 189 records. See the closure notes below.

# Phase 5 closure — the E2E migration and the browser sweep

## What the retired fixture had left behind

Three workspace specs still described the hand-written nine-record fixture: its
row counts (`toHaveCount(9)`), its people (`"Aarav Mehta"`), its ordering, and
its particular jobs. Those assertions had stopped meaning anything the moment
Mock mode began serving the canonical corpus — and worse, a failure reported that
a name had moved rather than which behaviour had regressed.

**The anchor strategy.** Records are addressed through the generated index:

```ts
const SUBJECT = anchor("recruiter", "stage new", { persona: "recruiter" });
await card(page, SUBJECT).getByTestId("pipeline-stage-menu").click();
```

`tests/e2e/scenarioAnchors.ts` resolves a semantic condition to a deterministic
UUID5 plus everything a spec needs — counterparty name and handle, job id and
title, stage, portfolio and message counts — and throws with the scenario's
actual indexed conditions when a condition is missing, so a coverage gap reads as
a coverage gap rather than as a timeout. A new `data-record-id` on the list row
and the pipeline card is what makes an id clickable.

**Counts.** Only where a count is part of a scenario's contract — the
214-applicant job, the 47, the one, the zero — or derived from the manifest at
test time. Asserting a workspace's *total* row count against a generated corpus
tests the generator's arithmetic, not the product.

**Scenario choice is explicit per test**, so none inherits what ran before it:
`recruiter` for the board and the IA tests (every stage populated, 42 records
rather than `default`'s 189 for the same coverage), `talent` where an empty
application stage is the point, `edge` for identity and failure cases, `empty`
for the empty state, `busy` only for volume.

## Defects the migration found

| Defect | Consequence |
| --- | --- |
| The adapter emitted a `thread` array; `OwnerInteraction` has no such field and `buildConversation` reads `message`/`response`/`replies` | **Every generated conversation rendered as a single bubble.** The 44-message thread showed one |
| `message` carried the *last* message rather than the opening | The end of a conversation appeared at the top of it |
| The selection normaliser ran against an empty list and wrote the cleared value to storage | **Returning to /applications destroyed the remembered conversation** rather than restoring it |
| Every applicant in `recruiter` attached a portfolio | The card anatomy *without* one — the layout the narrow-column overflow defect was found on — was rendered by no scenario |
| No record anywhere answered the structured requirements without also writing a note | The "First message" affordance and the generated-opening-message rule were both untested |

The first is invisible to parity by construction: the activity summary carries no
messages, so message content is a documented parity exclusion. The third only
appeared under parallel load — the same test passed three times in isolation —
which is how a race presents, and it is reachable by any user whose rows arrive
after mount.

## Scenario isolation

Three findings, all fixed at the right layer rather than with waits:

- **The remembered view.** A route naming no `view` gets whichever the workspace
  remembers. Correct behaviour; the sweep now accepts either shape rather than
  assuming the inbox.
- **The remount on data arrival.** Mock mode fetches its manifest after mount, so
  a measurement split across two `evaluate` calls could see cards in the first
  and an empty board in the second — reporting "no overflow" having looked at
  nothing. The narrow-card measurement is now one atomic pass.
- **SSR beside hydration.** A navigation or reload can briefly leave the
  server-rendered markup next to the hydrated tree, so an unscoped `getByTestId`
  resolves twice and fails strict mode on a page behaving correctly. Helpers and
  assertions scope to `main`.

## Six-scenario browser sweep

All six scenarios, both personas, at 1440 / 1280 / 390 / 320px, plus 200% zoom,
keyboard-only and reduced motion. **No product defects found.** Verified: no
horizontal overflow anywhere; genuine empty-state copy that offers a next action
rather than a blank pane; no raw enum on any screen; no payment-custody wording;
no shared generic counterparty name; every indexed edge case present, openable
and non-blank; no scenario leakage on switch; refresh preserves the scenario; an
unknown seed errors by name and loads nothing.

Two sweep findings turned out to be correct behaviour on inspection:

- **Uncapped counts.** `329` and `112` are filter and queue *totals*, where
  capping would hide how much work there is. The unread badge uses
  `formatBadgeCount(count, cap = 9)` and does cap.
- **217 elements with long transitions under `prefers-reduced-motion`.** Zero
  animations — every one is disabled. The transitions are `color`,
  `background-color`, `border-color`; colour is not motion.

## `busy` volume and performance

| Measurement | Result |
| --- | --- |
| Inbox rows rendered | 329 of 329 — all of them |
| First content | 446 ms |
| Inbox DOM nodes / heap | 7,064 / 22 MB |
| Board visible | 1,428 ms, 329 cards, 23,123 nodes |
| Board search | 466 ms → 12 cards |
| 44-message thread | all 44 bubbles rendered |
| Named jobs | 214, 47, 1 and one zero-applicant job all present |

**There is no pagination and no virtualisation**: the board renders every card.
Measured and acceptable at this volume; windowing is the fix if volume grows.
This is a limitation, stated rather than discovered.

## Final external-failure ledger

Counts from the closing run. The *set* of failures shifts between runs — a spec
that fails once and passes in isolation is load-sensitive, not broken — so what
is stable here is the classification, not the arithmetic.

| Suite | Result | Classification |
| --- | --- | --- |
| `npx tsc --noEmit` | clean | — |
| `npm run lint` | 0 errors, 31 warnings | Pre-existing `<img>` and unused-var warnings |
| `node --test tests/*.test.mjs` | 875 passed | The import-parser wall-clock benchmark passes or fails with machine load; its design flaw is recorded above |
| `npm run build` | clean | — |
| `npm run test:e2e` | **302 passed, 18 failed** | **None in any spec touched by this work**, and none in a spec importing anything changed. `settings`, `candidate-job-experience`, `visual-theme`, `dev-data-source`, `talent-browse`, `admin-panel`, `drafts` pass in isolation → parallel-load flakes. `adaptive-profile-overview`, `beta-review-safety`, `smoke`, `import-job`, `mobile-overflow`, `phase3a-polish` fail in isolation too → pre-existing, other workstreams |
| `npm run test:e2e:qa` | **88 passed, 3 failed** | Two settled: the import-job-publish QA failure and the duplicate `job-apply-button` test id. The third (`a fresh hiring request appears for both sides`) passes in isolation → order-sensitive; the QA suite shares one database across tests |
| `pytest` (backend) | **455 passed, 10 skipped** | — |
| `alembic heads` | `0049_engagement_payment_state` | — |
| `test_interaction_status_postgres.sh` | pass | Migration round-trip through 0049 on real PostgreSQL |
| Manifest regeneration | byte-identical | `--check` on all six |
| `SCENARIOS.md` regeneration | current | `--check` |
| Backend/Mock parity | 15 tests, green | Five scenarios, both directions |
| Scenario index / doc / Mock-source guards | 51 tests, green | — |
| Production-bundle exclusion | 4 tests, green | Asserted against real build output |

`dev-data-source` deserves a note: it asserts the marketplace job title
`"Video editor for YouTube"`, which is the same string the already-classified
`smoke loads /jobs/1` failure looks for. They share one root cause in the
marketplace mock data, which belongs to the job-import workstream, not to this
one.

# Scalability closure — bounded rendering for large scenarios

One acceptance requirement from Phase 4 was still open: the 200+ applicant case
had to exercise pagination or incremental loading rather than rendering every
record at once. It did not. Both surfaces rendered everything they held.

## What was already there, and what was not

`/jobs` and `/talent-listings` paginate with `limit`/`offset` and answer
`{ items, total, limit, offset }`. **`/me/activity/summary` does not.** It
returns every application and every interest, to Backend and Mock mode alike, and
the Pipeline receives the same complete collection the Inbox does. There was no
server contract to reuse for this surface and no existing load-more component in
the repository.

So the model is the second of the three the brief ranks: **incremental client
rendering over the complete result set, in the shape of the existing pagination
contract.** The client holds everything and renders a page; the seam is shaped so
a server-side page can replace it without the components changing. That is stated
in `lib/workspacePaging.ts` and in SCENARIOS.md rather than left to be inferred.

**Not virtualisation.** Windowing a scroll container buys smoother scrolling and
costs find-in-page, anchor links, printing and most screen-reader list semantics
— a bad trade for a hiring inbox read a page at a time. **Not an invisible scroll
sentinel** either: auto-loading has no keyboard equivalent, no way to say how much
is left, no way to stop, and "the list grew while I was reading" is wrong on a
list being triaged.

## The rule that makes it honest

**Only rendering is bounded.** Counts, filters, queues, search, per-job summaries
and selection all keep reading the complete set. A stage heading says 92 while
showing 12; the scope chip says 329 while the list shows 40. Those are two
different numbers and the UI says both — `Showing 40 of 329 conversations`, and
`All 329 conversations shown` at the end.

| Surface | Renders | Control |
| --- | --- | --- |
| Inbox | 40 conversations | **Load N more conversations** |
| Pipeline stage | 12 cards | **Load N more cards**, per stage |
| Focused stage | 40 cards | the same control |

Selection survives the bound. A deep link or a remembered conversation can point
anywhere, so the window grows to the page boundary containing it rather than
pinning the row out of order — ordering is what makes a list scannable. The same
rule keeps a bulk selection and any just-moved card rendered, so a card moved
into a busy stage never appears to vanish. Narrowing restarts the window, keyed
on what changes the set rather than wired into each setter, so a filter can never
leave a stale offset pointing past the end of a shorter list.

Accessibility: a real button, reachable and operable from the keyboard, naming
what pressing it will add; a polite live region outside the list announcing
`40 more conversations loaded. Showing 80 of 329.`; and focus staying on the
button, because a list that grows must not steal it.

## Before and after — `busy`

| Measurement | Before | After |
| --- | --- | --- |
| Initial Inbox rows | 329 | **40** |
| Initial Inbox DOM nodes | 7,064 | **1,241** |
| Initial Pipeline cards | 329 | **60** |
| Initial Pipeline DOM nodes | 23,123 | **4,489** |
| First Inbox content | 446 ms | 400 ms |
| Pipeline visible | 1,428 ms | **445 ms** |
| Pipeline search settled | 466 ms | 488 ms |
| Heap | 22 MB | **13 MB** |

Also measured: load-more latency 129 ms; all 329 conversations reachable in 8
presses over 1,157 ms; filter switch 193 ms. The 214 / 47 / 1 / 0-applicant jobs
and the 44-message thread are unchanged — the scenario's volume was not reduced
to meet the requirement.

Search is unaffected because it never operated on the rendered page: the board
searches the full set and then the bound applies to the result.

## What the change cost the existing tests

Two assertions in `you-applications.spec.ts` counted rendered rows as a proxy for
"the filter shows exactly what qualifies". That proxy stopped holding. They now
assert the total on the scope chip *and* that rendering stays bounded — two
guarantees where there was one. One had to be loosened from an exact page size,
because the open conversation legitimately expands the window across a filter
change; that is the selection guarantee, not a leak in the bound.

`revealRecord` loads pages until a record appears, the same way a person would,
so a spec that reaches a record is a spec whose record a user could reach.

## Limitations

- **This is not server-side pagination.** The client still receives every record;
  only rendering is bounded. Fixing that means paginating
  `/me/activity/summary`, which would change a contract the parity suite and the
  restore both depend on — worth doing, deliberately out of scope here.
- **Loading every page does put every row in the DOM**, by design. The bound is
  on what renders before you ask, not on what you can ask for.
