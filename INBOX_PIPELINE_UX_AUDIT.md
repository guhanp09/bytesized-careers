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
