# Conversational job-import guidance

## Outcome

CreatorJobs now treats ordinary import uncertainty as a short collaboration, not an error report. Pasted text and public URLs still produce the same private canonical job draft introduced by the unified import flow. The change is a presentation and orchestration layer over existing recruiter-review state and native Post Job controls; it is not another editor, validator, transcript store, or AI request.

The journey is:

```text
source input
  -> truthful atomic processing
  -> positive private-draft summary
  -> one essential decision at a time
  -> up to three role-relevant quality suggestions
  -> normal editable Post Job draft
```

## Audit of the previous experience

The accepted unified flow had already removed the separate import-review product and made Post Job authoritative. The remaining notice still made uncertainty resemble failure:

- filled, review, and optional-missing counters competed for attention;
- several state cards and repeated review actions appeared together;
- phrases such as “Review flagged fields”, “Optional details not found”, “Review field”, and “Why was this filled?” emphasized system state instead of recruiter decisions;
- missing, conflicting, inferred, and optional values received similar visual weight;
- individual prompts stated what needed attention but did not consistently explain the job-specific candidate consequence;
- the form could open on the earliest field in registry order even when a higher-impact conflict should lead;
- the loading state did not reserve a candidate-preview rail, so the transition into Post Job felt less continuous;
- normal guidance reused the amber invalid-field animation when focusing a field;
- the development fixture exercised only an editor-shaped job and could not prove clean, role-varied, or genuine failure behavior.

The underlying review APIs, evidence, conversion, native form, preview, refresh behavior, publication validation, privacy rules, and idempotency were sound and remain authoritative.

## Research and product patterns

The design uses current primary guidance without copying another product’s visual language:

- [Microsoft Guidelines for Human-AI Interaction](https://www.microsoft.com/en-us/research/project/guidelines-for-human-ai-interaction/) informed contextual scoping, disambiguation before consequential action, local explanations, efficient correction and dismissal, and continuity across recent interaction.
- [Google People + AI Guidebook: Mental Models](https://pair.withgoogle.com/guidebook/chapter/mental-models/) informed competence-first expectation setting without overstating capability.
- [Google People + AI Guidebook: Explainability + Trust](https://pair.withgoogle.com/guidebook/chapter/explainability-trust/) informed concise evidence disclosure at the decision point rather than pervasive AI badges.
- [Google People + AI Guidebook: Feedback + Control](https://pair.withgoogle.com/guidebook/chapter/feedback-controls/) informed reversible answers, a manual-editor escape route, and optional dismissal.
- [Google People + AI Guidebook: Errors + Graceful Failure](https://pair.withgoogle.com/guidebook/chapter/errors-failing/) informed the strict separation between absent source information and actual processing failure.
- [Material 3 progress indicators](https://m3.material.io/components/progress-indicators/guidelines) informed determinate claims only when application state really advanced, stable layout, and reduced-motion support.
- [Wix AI Website Builder](https://www.wix.com/ai-website-builder) provided a useful product pattern: a focused conversation can lead into a normal editable artifact. CreatorJobs adapts the transition pattern, not Wix’s appearance or open-ended chat behavior.

Selected principles:

1. Start with what was successfully prepared.
2. Show uncertainty, but scope it to one actionable decision.
3. Explain what the source established, why it matters for this job, and what the recruiter must choose.
4. Never make a consequential assumption on the recruiter’s behalf.
5. Keep answers reversible and optional help dismissible.
6. Report only observable processing state; never use fake percentages or simulated completed stages.
7. Keep the real editable job draft and candidate preview present throughout completion.
8. Reserve warning/error semantics for real invalid input or system failure.

## Truthful processing design

The browser observes three operations, so the loading surface shows three stages:

| Browser state | Pasted text | Public URL | Completion claim |
|---|---|---|---|
| source creation/initialization | Reading supplied job information | Opening the public job post | Only complete after source and draft initialization return |
| atomic provider processing | Matching details to CreatorJobs | Matching details to CreatorJobs | No hidden sub-stage is claimed complete |
| native application | Preparing the private draft | Preparing the private draft | Active only after structured review data exists |

During the atomic processing call, copy describes categories being checked but does not pretend the backend exposes token-by-token or field-by-field progress. After eight seconds, the same surface calmly notes that detailed posts can take longer and that CreatorJobs is checking carefully instead of guessing. It makes no timing promise. The source label and preview skeleton stay in place, completed marks appear only for prior browser states, the live region is polite, and skeleton animation obeys reduced motion.

Actual retrieval/provider/save failures render in a separate failure surface with retry, manual completion, and URL-to-paste fallback where relevant. A partial but valid import proceeds to Post Job; it is not mislabeled as a system failure.

## Deterministic guidance architecture

`lib/jobImportConversation.ts` is a pure presentation layer. It consumes:

- private `JobImportDraft` fields and review states;
- server-owned bounded evidence and conflict alternatives;
- current canonical Post Job values;
- manual-change markers;
- `JOB_FIELD_REGISTRY` labels and requirement metadata;
- `importConditionalFieldIsActive`, which centralizes the existing dependency interpretation used by import guidance.

It returns deterministic turns containing kind, phase, grouped field paths, native screen, friendly heading, explanation, question, candidate impact, bounded evidence, alternatives, resolution label, skip rules, and presentation priority. It neither fetches nor persists prose. It does not decide publication validity.

The queue order is:

1. unresolved consequential conflict;
2. missing publication blocker;
3. active conditional requirement;
4. consequential value needing confirmation;
5. other policy-relevant ambiguity;
6. role-ranked quality suggestion.

Related fields share turns: role, work arrangement/location, compensation, weekly hours, turnaround, duration, trial terms, application routing, revisions, source inputs, creative autonomy, references, and hiring process. Conditional fields disappear when their controlling canonical answer makes them irrelevant. Changing the controller rebuilds the queue instead of mutating a parallel workflow.

Quality suggestions are scored by job title and creator role, limited to three unresolved turns, and never count as essential. Production roles may receive revision, source-input, turnaround, or reference help. Strategy/growth roles may receive autonomy, source-input, or hiring-process help. A clean import with the meaningful field already supplied does not create a question for an empty companion note.

## Interaction model

The desktop surface retains the current Post Job two-column layout: guided message and real native control on the left, sticky live candidate preview on the right. Mobile keeps the conversation primary and exposes the existing expandable preview above it.

For each active turn:

- the assistant identity is explicitly “CreatorJobs Assistant”;
- progress reports remaining essential decisions, not missing optional fields;
- the message contains source finding, job-specific consequence, and decision prompt;
- “What I found” reveals only bounded server-owned evidence;
- conflict alternatives are neutral buttons with an escape to the real field;
- a safe proposed value may be accepted through the existing review API;
- missing or free-form answers use the exact Post Job control below;
- the normal form save step records edits through the existing review mutation and native job update;
- answer history can reopen an earlier decision;
- essential work can be saved for later under existing draft rules;
- quality suggestions expose “Not now” and “Skip remaining suggestions”;
- “Use the full editor” leaves all imported state intact and a compact bar resumes guidance.

Normal guidance scrolls/focuses the native control without the product’s amber invalid-field shake. A user-authored change updates the existing preview immediately and gives the preview rail a subtle, reduced-motion-aware outline pulse. Focus moves to a stable question heading only after a recruiter-triggered transition.

The final state says “Your draft is ready to edit”, reports useful imported details, links to the source when retained, and explicitly states that the job remains a private draft until normal Post Job review and publication. It does not claim native publication readiness and cannot auto-publish.

## State, privacy, and compatibility

- Existing review mutations remain the only way to confirm, edit, reject, or resolve imported values.
- The canonical job remains the editing source of truth after native conversion.
- Refresh reconstructs the queue from persisted decisions; no transcript table or browser copy of private source text is added.
- A later canonical save is authoritative for formerly missing values. Conversion-time database defaults are not mistaken for recruiter answers.
- Skipped quality fields use the existing rejected review state, so they do not reappear on refresh.
- Accepted, edited, and resolved values update the native private draft immediately.
- Existing locks, owner checks, evidence privacy, source retention, idempotent apply/attach operations, and publication validation are unchanged.
- No migration, AI provider call, model/prompt change, evidence change, search change, application change, messaging change, or screening-policy change is part of this release.

## Development scenarios

The development-only fixture endpoint accepts four allowlisted scenarios:

- `strong-decisions`: a mostly complete finance Video Editor job with remote/hybrid and compensation conflicts, absent weekly hours/application route, a creator-role suggestion, and useful optional production details;
- `thumbnail-designer`: a different creative role with a role suggestion plus revision and visual-reference improvements;
- `clean-import`: a Content Strategist job with essential and relevant quality fields present, proving that the queue does not manufacture work;
- `processing-failure`: a deliberate safe 503 response for the actual failure/retry surface.

Fixtures use the existing private source/draft/review pipeline, remain behind the development-only router guard, and never invoke a provider.

## Accessibility and responsive behavior

- current questions are headings and programmatically labelled surfaces;
- progress and saved answers use restrained polite announcements;
- source evidence uses a native accessible disclosure;
- alternative, skip, history, source, and full-editor actions meet the product’s 44px minimum target;
- keyboard users can answer via native controls and advance with ordinary form actions;
- transitions and skeletons opt out under reduced motion;
- focus is moved only following the recruiter’s action and never while typing;
- the stable minimum-height conversation and preview rail reduce layout movement;
- 320px/390px/mobile-landscape layouts retain the existing single-column form and expandable preview without horizontal overflow.

## Rejected designs

- restoring the deleted import-review workspace;
- an open-ended chatbot composer;
- generated conversation prose or another provider request;
- persisting a parallel conversation transcript;
- mandatory review of all extracted fields;
- showing all unknowns at once;
- optional-missing counters;
- AI confidence percentages or raw provider reasoning;
- fake provider sub-stages, percentages, or deliberate animation delay;
- warning colors for normal uncertainty;
- automatically publishing or claiming the draft is publishable;
- copying native controls into a second import form.

## Remaining boundaries

The backend provider call is atomic, so field-level processing progress cannot be truthfully displayed. Guidance templates cover all active fields through contextual fallbacks, while the richest bespoke copy focuses on grouped consequential and role-relevant decisions. Candidate preview placeholders retain the existing preview contract rather than exposing review metadata. These boundaries are deliberate until backend progress or native preview semantics change independently.

## The draft assistant (Bea)

The preparation surface is no longer a loading screen followed by a review
queue. It is one guided canvas: the assistant and the current decision on the
left, the real candidate preview on the right, a milestone bar across the top.

**Bea** is an original mark — a rounded head with one visor, two pill eyes, and
an antenna whose tip is the beacon she is named for. Nine states, each derived
from observed application state rather than a timer, so the character cannot
depict work that is not happening. The SVG is decorative and hidden from
assistive technology; `DRAFT_ASSISTANT_STATE_LABELS` in
`lib/draftAssistantStates.ts` is what a screen reader receives, and it lives in
a data module so its exhaustiveness over the state union is testable. Motion
follows the existing workspace doctrine: nothing loops except a slow blink, and
everything stops under `prefers-reduced-motion` rather than being shortened.

### Truthful progress

`lib/jobImportProgress.ts` takes observed state and returns stages. It reads no
clock and holds no state — a test rejects `Date.now`, `setTimeout` and
`Math.random` in its source. The provider call is atomic, so the stage covering
it is marked indeterminate and animates in place; contributing a fraction of
unmeasurable work would be the fake percentage this design refuses. Stages carry
a past-tense label for the completed list and a present-tense one for the running
heading, because a completion-sounding heading reports work that has not happened.

### Questions during processing

A small, server-certified set of recruiter-authority fields can be answered while
extraction runs. Eligibility is decided by
`EARLY_RECRUITER_QUESTION_FIELDS` on the server and published on the draft; the
client never widens it. Answers persist to `recruiter_prefill` on the draft, so
they survive refresh with no browser storage and no dependency on one tab. When
extraction lands, the recruiter's answer wins and the machine proposal is kept
only as private audit.

### Role-aware guidance

`lib/jobImportRoleGuidance.ts` supplies copy for Video Editor, Thumbnail
Designer, Scriptwriter, Podcast Editor and Creator Strategist, plus an informed
fallback for unprofiled creative roles. Editors are asked about footage and
re-cuts, strategists about analytics access and ownership, writers about who does
the research. Profiles match most-specific-first so "Podcast Editor" does not
resolve to Video Editor. Groups that mean the same thing for every role —
compensation, application routing — stay generic deliberately. The module is
pure and makes no provider call.

### Preview authority

`lib/jobImportPreview.ts` decides which value each field currently shows:
recruiter edit, then recruiter confirmation, then an unconfirmed proposal marked
provisional, then blank. Rejected values disappear, values that failed validation
are never shown, and an unresolved conflict resolves to blank rather than picking
a side. The structured half runs through `hydrateJobPostingDomain`, the same
function the Post Job editor uses on a saved draft, and a test asserts equality
with a direct call so parity is structural.

### Removed

The `?import=1` sessionStorage handoff, its review banner, and the deterministic
V1 parser stack were deleted once the backend draft became the only way in.
Nothing wrote the handoff payload any more, so the branch was reachable only by
hand-crafting browser storage. `tests/importJobFlowStructure.test.mjs` now guards
against a second import journey returning.
