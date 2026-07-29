# Messaging UX decisions

The reasoning behind the conversation list, the message thread, and the Pipeline
card. Written before the implementation it describes, and kept as the reference
for what each surface is allowed to say.

It exists because the workspace is two products wearing one skin. It is a
**messenger** — two people talking, one after the other, and the last thing said
is the thing you came back for. It is also an **applicant tracker** — a lifecycle
with authoritative stages, structured answers, portfolios and commercial terms.
Every defect fixed here comes from one of the two borrowing the other's
vocabulary at the wrong moment: a chat list that led with a job title, a thread
that stamped a name and a time on every bubble as though the sender might have
changed, a board card whose height was decided by how much someone happened to
write.

Companion documents: [INBOX_PIPELINE_UX_AUDIT.md](INBOX_PIPELINE_UX_AUDIT.md)
(the Phase A *Effortless Status* slice, the queue model, bounded rendering) and
[MESSAGING_ARCHITECTURE.md](MESSAGING_ARCHITECTURE.md) (transport, conversation
records, delivery). This document is only about what a person sees.

---

## 1. References examined

| Product | Read for | Verdict |
|---|---|---|
| WhatsApp / Messenger | Conversation-row anatomy: avatar → name → last message → time, in that order and nothing else | **Adopt the anatomy**, reject the assumption that context is unnecessary |
| Slack / Discord | Consecutive-sender grouping; avatar once per group; hover-revealed timestamps | **Adopt wholesale.** This is the single largest legibility win available |
| Telegram | Bubble geometry communicating group position; quiet in-bubble metadata | Adopt the corner treatment, not the metadata density |
| Modern ATS inboxes (Greenhouse, Zoho RecruiterInbox, Breezy) | Candidate identity as the record; every channel collapsing onto one person | **Adopt identity-as-record**; reject stage-per-column sprawl |
| [MUI X chat message list](https://mui.com/x/react-chat/material/message-list/) | A concrete, specified grouping model: same author, bounded time window, avatar on the group boundary only | Adopted, with the window and the boundary chosen for this product |
| [Chat UI pattern surveys](https://www.uxpin.com/studio/blog/chat-user-interface-design/), [avatar sizing guidance](https://www.setproduct.com/blog/avatar-ui-design) | Avatar scale by surface: 24–32px in dense lists, 40–48px in cards, 64px+ in headers | Adopted at the small end of "card" — see §3 |

Evidence grading, so later readers know what is settled and what is a bet:

- **Established** — grouping reduces scanning cost; identity leads in
  person-to-person surfaces; colour must never be the only signal.
- **Convention** — 5-minute grouping windows, hover timestamps, right-aligned
  outgoing messages. Widely shared, not proven; cheap to change.
- **Ours** — that job context can be demoted to a second line without recruiters
  losing the thread. This is the one real bet in the redesign, and §2 states
  exactly how it is hedged.

---

## 2. Adopted principles

1. **People and the latest communication are the primary scan anchors.** The row
   answers *who, and what did they last say* before it answers anything else.
2. **Job context is important but secondary to identity.** Present on every row,
   never the first thing read. This is the hedge on the bet above: demoted, not
   removed, and it stays on the row rather than retreating into the detail panel.
3. **Direction communicates ownership.** Incoming left, outgoing right, plus a
   tonal difference, plus an accessible label. Any one of the three may fail —
   alignment for a screen reader, colour for a colour-blind user — and ownership
   must survive the failure of any one.
4. **Consecutive messages group.** Same sender, no interruption, no meaningful
   gap: one visual unit.
5. **Sender identity does not repeat unnecessarily.** A two-person conversation
   that names the sender above every bubble is telling the reader something they
   already know, ten times per screen.
6. **System activity stays separate from human messages.** A status change is not
   a message from a person; rendering it as one makes the lifecycle look like
   somebody's opinion.
7. **A list row opens the conversation.** That is the row's job. Anything else on
   the row must justify its existence against "the row already does this".
8. **Secondary shortcuts stay contextual** — revealed on hover, focus, or a state
   that genuinely warrants them; never a permanent band of buttons.
9. **Personal organisation is obvious but quiet.** The Star must be findable and
   unmistakably private, and must never look like a shared lifecycle control.
10. **Detail stays available without crowding the list.** Truncation is
    acceptable *only* where the full value is reachable — that is the entire
    justification for the fixed-height card in §6.

## 3. Patterns deliberately rejected

| Rejected | Why |
|---|---|
| **Hiding job context entirely**, as social messengers do | A recruiter with 200 applicants across 6 roles cannot use a list that says only "Ishaan Reddy". Messenger's users know why they are talking to someone. Ours do not. |
| **Reactions, calls, stories, presence-everywhere, community tabs** | Social-graph features on a hiring record. They add surface without adding a decision. |
| **Name + one line, nothing else** | Would delete the work-state and unread hierarchy that the queue model depends on. |
| **Replacing lifecycle truth with chat metaphors** | "Seen" is not a hiring outcome. The authoritative status stays authoritative; the messenger layer never becomes the record. |
| **Copying Messenger's palette or geometry** | The product has its own dark surface tokens. Borrow the *anatomy*, not the skin. |
| **Removing structured cards** — interview, portfolio, payment, job, first-message answers | These are the reason this is not just a chat app. They stay, as distinct blocks in the flow. |
| **A 56–64px conversation avatar** | Genuinely more prominent, and it costs roughly two rows per screen at list density. Rejected in favour of 44px — see below. |
| **Per-message tab stops** | Keyboard-navigable in principle, unusable in practice: a 44-message thread becomes 44 stops between the list and the composer. |

---

## 4. Final hierarchy

### Conversation row

```
┌────────────────────────────────────────────────────────┐
│ ⬤44   Ishaan Reddy                              15h  ★ │   1 identity + time
│       Channel manager · Finance channel                │   2 context, quiet
│       Yes — the second link is exactly that…      ●2   │   3 last message + state
└────────────────────────────────────────────────────────┘
```

1. **Counterparty identity** — strongest text on the row. A person's name when
   there is a person; the hiring identity when the counterparty *is* an
   organisation.
2. **Context** — role · channel, or the job title. One line, muted, clamped to
   one line, never repeating what line 1 already said.
3. **Latest human communication** — the actual last thing said. A system event
   may fill this slot only when no human message exists.
4. **Timestamp** — fixed position, top right, never displaced by an action.
5. **Unread / attention** — weight first, indicator second.
6. **Personal organisation and contextual action** — revealed, not resident.

**Avatar: 44px** (`h-11 w-11`). Chosen against measurement, not taste. WhatsApp
and Messenger sit at 48–56px with two text lines; this row carries three. At 48px
the avatar is taller than the text column it labels, which reads as a contact
list that happens to show messages. At 36px — where it was — it stops being the
first thing the eye lands on, which is the defect being fixed. 44px is the
largest size that still leaves the text column taller than the avatar, and it
also happens to be the long-standing 44×44 touch-target guidance, so the
avatar-and-name region is a comfortable tap target on mobile without extra
padding. (The *conformance* floor is WCAG 2.5.8's 24×24 CSS px, which is what
the automated check asserts; 44px is the more generous convention, not the
requirement.)

### Message group

```
      Ishaan Reddy                                    ← name once, group start
      ┌─────────────────────────┐
      │ Yes — the second link…  │                     ← first bubble
      └─────────────────────────┘
      ┌─────────────────────────┐
 ⬤28  │ …and I can start Monday │  9:14 AM            ← avatar + time at the foot
      └─────────────────────────┘
```

A group is one sender's uninterrupted run. Name at the top of it, avatar at the
bottom of it, timestamp at the bottom of it. Own messages get no name and no
avatar — right alignment already says whose they are.

### Structured event

Full-width, centred, visually distinct from both bubble columns, collapsible when
several occur together. Never inside a bubble; never attributed to a sender.

### Pipeline card

Five fixed rows, identical height for every card at a breakpoint:
identity → evidence → fit metadata → message summary → footer. The card is a
**summary surface**; the detail panel is the source of truth. §6.

### Compact chat dock

The same conceptual model at higher density — same grouping rules, same
separation of system events, smaller avatar, tighter spacing. Not a second
design.

---

## 5. Rules

### Grouping

A new group begins when **any** of these is true:

- the sender changes;
- more than **10 minutes** separate the messages;
- a system event, structured card, or date divider falls between them.

Ten minutes rather than the conventional five: hiring conversations are
asynchronous. Two messages six minutes apart are one thought being finished, not
two sessions. Five minutes would split them and produce a stray one-bubble group.

### Sender names

- **Never** above the current user's own messages.
- Above the **first** bubble of an incoming group, and only when it adds
  something — suppressed when the group directly follows another group from the
  same person after an interruption that already re-identified them.
- Always available to assistive technology regardless of what is drawn, via the
  group's accessible label.

### Timestamps

- One per group, at the group's foot, quiet.
- An absolute time on hover and on keyboard focus, through the existing
  `AbsoluteTimeOnFocus` mechanism, so the precise value never requires a pointer.
- Never on every bubble.

### Reply shortcut — decision

**Kept, and only just.** It survives one test: it does something the row does
not. Clicking the row opens the conversation; the shortcut opens it *with the
composer focused*, which is one deliberate action instead of two. Conditions:
hidden until hover, focus-within, or selection; icon only, never a text row; at
the row's right edge, below the timestamp's line so it can never displace it; a
real `aria-label` and title. If it ever needs a label to be understood, it has
failed its test and should be deleted.

### System events

Grouped, shared by the thread and the dock through one implementation
(`groupThreadEntries` + `SystemEventGroup`). Consecutive events collapse into a
single summary that expands. Human messages always break an event group.

### Star

Private, per-viewer, never a lifecycle event, never visible to the counterparty.
Every affordance says so in its `title` and `aria-label`. It appears in the row,
the Pipeline card header, and the detail header — the three places a decision to
come back to someone is actually made.

---

## 6. The exact-height Pipeline card

The previous attempt used a height *floor* (`min-h-[304px]`) and produced cards
ranging 304–384px, on the reasoning that clamping content would hide what an
applicant wrote. That reasoning was wrong, and naming the error is the point of
this section.

**A Pipeline card is a summary, not the record.** Clamping is not hiding when the
full value is one click away in the detail panel — which is where a recruiter
reads an application anyway. The apparent conflict between "equal dimensions" and
"do not hide essential information" only exists if the card is treated as the
last place the information appears. It is not.

So: **exact equal height** within a breakpoint, via a five-row CSS grid with
fixed track sizes. Every zone has a defined height whether or not it has content.

| Zone | Track | Contains |
|---|---|---|
| Identity | auto, clamped to 2 lines | checkbox · avatar · name · role · Star |
| Evidence | **fixed** | portfolio strip, or first-message answer, or a restrained no-portfolio state |
| Fit | fixed, 1 line | format · niche · experience |
| Summary | fixed, 3 lines | latest message or fit note |
| Footer | auto | stage control · actions |

The evidence zone is one fixed height for all three of its states, so a record
with no portfolio does not produce a shorter card *or* a blank slab.

Clamps: name 1 line, role 1 line, portfolio title 1 line, fit line 1 line,
message 3 lines. Every clamped value remains reachable through the detail panel,
and clamped text carries a `title` — as a pointer convenience, not as the
accessible path. The accessible path is the card's link into the detail, which
keyboard users reach the same way they reach everything else.

Uniform height is **per breakpoint**, not global. A single-column mobile board
has its own uniform height; forcing the desktop figure onto a 320px column would
waste half of it.

---

## 7. Accessibility decisions

- Ownership never rests on colour alone: alignment, tonal contrast, and an
  accessible per-group label all carry it.
- A message group is one `role="group"` with a label naming the sender and the
  time, so grouping does not cost a screen-reader user the attribution it removes
  visually.
- Focus is never stolen by an incoming message or a status change; updates
  announce through `aria-live="polite"`, and `assertive` is reserved for
  destructive-action errors.
- Interactive targets clear WCAG 2.5.8's 24×24 CSS px — asserted, not assumed —
  and the row's identity region is the more generous 44px. The Star and the
  reply shortcut are 24px squares in a reserved gutter; they are desktop-only,
  and their equivalents on touch live in the opened conversation at full size.
- Truncated content is reachable without a pointer.
- Every reveal-on-hover control is equally revealed by `focus-visible`.
- Reduced motion removes transitions rather than shortening them.

## 8. Mobile decisions

- Identity and message preview survive at 320px; context clamps.
- Reveal-on-hover controls do not exist on touch — the equivalent actions live in
  the opened conversation, not crammed into the row.
- Bubbles cap at **80% of the thread width, minus the avatar rail**. A flat
  percentage measured the column *after* the rail, so in a 380px canvas an
  incoming bubble sat 36px from the left and 32px from the right and alignment
  stopped carrying anything.
- **Structured cards are exempt from the bubble cap.** The cap exists so a
  sentence never looks centred; a first-message summary is a labelled block whose
  ownership the rail and its own framing already carry.
- The Pipeline card uses its own uniform height, and its footer stays inside the
  card at 320px.
- No horizontal scrolling at any supported width, in either view, in any of the
  five scenarios.

---

## 9. What was measured

### Pipeline card height

| Breakpoint | Height | Cards measured |
|---|---|---|
| ≥ `sm` (desktop, laptop, 200% zoom) | **332px**, every card | 231 across five scenarios |
| < `sm` (390px, 320px) | **356px**, every card | 231 across five scenarios |

Before: 304–384px within a single column. Footers now start at the same offset
in every card at a breakpoint, because the footer's second line below `sm` is a
layout decision applied to every card rather than a consequence of how long a
particular label happens to be.

### Conversation row

One height for every row (±1px of rounding), whether or not a human message
exists — the preview falls back to a marked system line rather than collapsing.
Rows that additionally carry a labelled recommended action gain a band beneath
them; that is a deliberate hierarchy, not a second row size.

### Defects found by looking, and fixed

1. **Answers rendered one letter per line** on a phone. The first-message card's
   `auto` label column took the full width of a ~180px card and the value column
   collapsed. Now stacks below 256px of *its own* width — a container query, not
   a media query, because the same card appears in narrow desktop rails.
2. **The reply shortcut did nothing.** The list auto-selects a record, so
   `composerRef` was almost never null; the shortcut focused the open
   conversation's composer and the panel then remounted for the newly selected
   record and discarded it. Deferred and keyed to the requesting record.
3. **Ownership was nearly centred** for long incoming messages in a narrow
   canvas — see §8.
4. **The job context was printed twice** on a card with no portfolio: "For
   Colorist for food channel" beneath a header reading "Colorist for food
   channel". The zone now shows what else is known about the person, tools first.
5. **The rate and turnaround appeared twice** on a card — once as structured
   answers, once as the facts row four lines below, because both read the same
   `firstMessageAnswers`.
6. **The detail header's avatar was smaller than the row that led to it**, so
   identity appeared to shrink as you opened a conversation.

### Defects found by running the suites, and fixed

7. **The header's primary action appeared and then vanished.** Opening a thread
   with unread messages recommends replying, and then marks the thread read —
   removing the evidence the recommendation rested on. The button left about a
   second later, under a pointer already moving toward it. It was invisible
   before only because the low-confidence case used to render "Choose next step"
   in the same place, so the control changed its label instead of leaving. The
   last confident recommendation for the *open* record now survives a derivation
   that has gone quiet, is dropped when the selection changes, and is rendered
   only while the record still offers that action — so it can never become a
   button that does nothing. Held in a ref written during render rather than in
   state, because the value is read in the same render and must not cost a
   commit every time the list's live signals move.

### Known limitations

- **Star does not survive a navigation in demo mode.** There is no server to hold
  a per-user preference, and a star that refused to move would be one more
  control that looks live and is not. Backend mode persists it; the QA suite
  covers that path.
- **Canonical scenario threads alternate strictly**, so the 44-message
  conversation produces 44 runs of one. Grouping is proven in the browser by
  composing consecutive messages, and exhaustively in `tests/senderGrouping.test.mjs`.
- Uniform card height is enforced at the two breakpoints the product supports.
  A third intermediate width would need its own measured figure.
- **The sticky recommendation is per-session, not per-record-history.** It holds
  the last confident action for the conversation currently open; leaving and
  returning re-derives from scratch. That is deliberate — anything durable would
  be a second opinion competing with the derivation — but it does mean a record
  can show a primary action on one visit and none on the next, if the evidence
  that justified it is gone.
- **`workspace-performance › the list-wide reads happen once per load` is
  load-sensitive.** It bounds each list-wide read at two requests, and a second
  realtime-refresh burst occasionally makes it three. Reproduced on the
  unmodified baseline (1 in 8 runs) as well as with this work, including with an
  8-second settle window, so it is timing rather than an extra fetch. The
  invariant the test exists for — that these reads do not grow with the number
  of records — holds either way.
