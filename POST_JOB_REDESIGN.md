# Post Job flow — cognitive-load redesign (implemented) & field inventory

**Repository:** `creator-jobs-phase1` **Branch:** `qa-persona-system`
**Scope:** recruiter Post Job wizard (`/post-job`). No version-3 field removed. Canonical
data path (`lib/jobPostingForm.ts`) preserved.

## STATUS: implemented — 7 dense steps → 13 focused screens + a functional-minimalism pass

The flow was re-architected from **7 dense steps into focused single-question screens across 6
chapters**, then given a **functional-minimalism** pass (flat sections, tooltips, one clean
header). The seven original steps remain the **domain/routing groups** (`RecruiterJobStep`)
that own backend fields; the recruiter *navigates* the finer **`RecruiterJobScreen`** sequence
(`lib/jobPostingForm.ts`). Collaboration + timing were **merged** into one "Working together"
screen, giving **13 screens**.

| Chapter | Screens (one question each) |
|---|---|
| The opportunity | **The role** (title · role · specialization · public context · platform) · **The content** (niches · genres · formats) |
| The work | **The brief** (about · responsibilities · expectations) · **Deliverables** · **Workflow** (revisions · source inputs · sensitive access · creative freedom) |
| The person | **Skills** (must-have vs nice-to-have) · **Tools & languages** |
| The arrangement | **Working together** — engagement → work mode/location → weekly hours → turnaround → start/duration/timezone (merged) · **Pay** (compensation · experience) |
| Hiring | **Trial** · **Evaluation** (hiring stages · screening) · **Applications** (mode · URL · deadline · what to include) |
| Review | **Review** (candidate preview + reference videos + publish) |

Hard separations preserved: **role ≠ compensation**, **identity ≠ trial rights**,
**deliverables ≠ application questions**, **skills ≠ logistics**; dedicated moments for
**compensation**, **trial**, **applications**. `screenForField` routes every
backend/publication error to the owning screen; `groupForScreen(screen)` always equals the
field's domain group (enforced by `tests/jobFieldCompleteness.test.mjs`).

### Functional-minimalism pass

- **Header**: only `POST A JOB` + one **continuous, weighted** progress bar. Removed step
  count, "Part X of Y", chapter name, step label, subtitle, and the segmented markers; the
  raw screen count is never exposed (even to assistive tech). Weighting lives in
  `weightedJobProgress` (`lib/jobPostingForm.ts`): front-loaded so the pivotal opening
  decisions advance the bar quickly, monotonic, and Review sits just under 100% (publish
  completes it).
- **Flat hierarchy**: `DomainCard` is now a flat titled `<section>` (no nested border/bg/
  eyebrow); this cascades across every screen that uses the domain components. The "Role
  context" nested panel and the "Scope" eyebrow are gone.
- **Tooltips**: a single reusable `components/ui/QuestionTooltip.tsx` (hover · focus · touch ·
  Escape · portalled/viewport-clamped) carries non-critical helper text. Critical
  information (validation, unpaid-trial confirmation, usage/attribution/portfolio rights,
  sensitive-access warnings, publication blockers) stays visibly rendered.
- **No "Optional" badges** (asterisks still mark required); **`cursor-pointer`** on every
  selectable surface; **deselect-on-re-click** for the employer-type choice (empty allowed);
  **"Other" reveals a custom input** everywhere it applies (deliverable type/frequency,
  source inputs, hiring stage, compensation unit — already in the v3 contract).

---

## 0. Starting-state assessment (what the inspection actually found)

The brief assumes a raw "database-schema" form. The inspection found the opposite: the
flow has **already** had substantial UX investment. Before writing any code it already had:

- A **seven-step guided sequence** with a single source of truth
  (`RECRUITER_JOB_STEPS` in [lib/jobPostingForm.ts](lib/jobPostingForm.ts)) consumed by both
  the page and the form.
- **Conversational per-step subtitles** (`STEP_SUBTITLES`), an accessible `progressbar`,
  and a "Step N of 7" label.
- **Progressive disclosure** already wired: role specialization only for *Other Creator
  Role*; city only for Hybrid/On-site; turnaround only for project/output/ongoing work;
  weekly hours for time-based work; range max only in range mode; custom unit only when
  custom; every trial sub-field gated on trial status; start date only for specific-date
  start; duration value/unit only for fixed period; end date only for until-date; custom
  deliverable/frequency only for *Other*; sensitive-access confirmation only when
  account/analytics access is requested; language proficiency/purpose inside each row.
- **Five split domain components** ([JobDomainFields.tsx](components/post-job/JobDomainFields.tsx)):
  `EmployerContextFields`, `WorkDeliverablesFields`, `ArrangementDomainFields`,
  `SkillsQualificationsFields`, `TrialApplicationFields` — each owns one step's V3 fields.
- **Draft-first** save-per-section, **candidate preview** (rail / full / review),
  **mobile fixed action bar**, **reduced-motion** step transitions, **backend-error → step**
  routing (`backendJobFieldStep`), a **recommended-details checklist**, and **role-aware
  suggestions** (`getJobRoleRules`).

So the genuine, unmet gaps against the brief were narrower and sharper than "redesign the
whole thing":

1. **No field-completeness safeguard.** Nothing prevented a future edit from silently
   dropping a V3 field from the flow. The brief calls this *"a mandatory acceptance
   condition."* → **built this slice.**
2. **Progress read as one long "7 steps" list** with no chapter grouping, which the brief
   explicitly flags (*"grouped chapters with smaller steps inside them… the user should
   know where they are without being reminded constantly of the total amount of work"*).
   → **built this slice.**
3. **Subtitles were competent but declarative**, not the *"guided conversation"* voice the
   brief asks for. → **refined this slice.**
4. **No consolidated inventory/plan** mapping every writable field to its representation.
   → **this document + the registry.**

The remaining brief items (finer step-splitting, collapse-completed-subsection summaries,
preset library) are **real future work** and are specified in §7 as a sequenced next phase,
deliberately *not* forced into this slice because the step-id contract is depended on by
backend-error routing, import jump targets, the quality checklist, and four Playwright
specs whose navigation counts steps — and Playwright is unreliable in this sandbox
(offline images, stale server reuse). Changing step **count** is the single least-verifiable
change here, so it is staged rather than rushed.

---

## 1. Complete field inventory

The authoritative, machine-checked inventory now lives in
[lib/jobFieldRegistry.ts](lib/jobFieldRegistry.ts) — every writable field on
`BackendCreateJobPayload` classified by **owning step**, **representation**,
**requirement**, **prefill**, and **error-target**. `tsc` fails if a payload field is not
classified; [tests/jobFieldCompleteness.test.mjs](tests/jobFieldCompleteness.test.mjs) fails
if the registry drifts from the contract or mis-routes a publication blocker.

**Representation vocabulary** (every field is at least one of these — satisfying the brief's
completeness rule):

| Representation | Meaning |
|---|---|
| `control` | Always-visible recruiter input in its step |
| `conditional-control` | Revealed only when a prior choice makes it relevant |
| `derived` | Deterministically derived from other confirmed inputs |
| `confirmation` | Consequential value that always needs explicit confirmation |
| `legacy-preserved` | Only surfaced/editable for legacy listings; untouched values kept verbatim |
| `system-owned` | Set by CreatorJobs from verified data; recruiters never type it |

### Field distribution by step (summary — full detail in the registry)

- **Step 1 · Role, context & pay** (`basics`): `title`, `primary_role_id`,
  `role_specialization`*, `employer_context_type`, `hiring_identity_id` (confirmation),
  `platforms` (prefill), `work_mode`, `location`*, `compensation_mode`, `budget_amount`,
  `budget_max`*, `budget_currency`, `budget_unit`, `budget_unit_custom`*, `budget_note`,
  `experience_level` (derived).
- **Step 2 · Work & deliverables** (`about`): `about_channel`, `responsibilities`,
  `requirements` (legacy), `deliverables`, `revision_policy`, `revision_rounds`*,
  `revision_notes`, `source_inputs`, `source_inputs_notes`*, `creative_autonomy`,
  `creative_autonomy_notes`.
- **Step 3 · Creator context** (`creatorContext`): `content_niches`, `content_genres`,
  `formats_hired_for`.
- **Step 4 · Skills & workflow** (`toolsTags`): `required_skill_keys`,
  `preferred_skill_keys`, `other_required_skills`, `other_preferred_skills`,
  `required_skills_note`, `preferred_skills_note`, `required_tool_keys`,
  `other_required_tools`, `tools` (legacy), `language_requirements`, `languages` (legacy),
  `tags`.
- **Step 5 · Working arrangement** (`details`): `engagement_type`,
  `expected_weekly_hours_min/max`*, `turnaround_value/unit/basis`*, `timezone_overlap`,
  `start_timing`, `start_date`*, `duration_type`, `duration_value/unit`*,
  `engagement_end_date`*, plus legacy `start_timeframe`, `weekly_hours`, `contract_type`.
- **Step 6 · Trial & application** (`applicationRequirements`): `trial_status`,
  `trial_scope`*, `trial_effort_value/unit`*, `trial_compensation_amount/currency/basis`*,
  `trial_work_usage`*, `trial_portfolio_permission`*, `trial_attribution`*,
  `unpaid_trial_confirmed` (confirmation), `trial_notes`*, `hiring_process`,
  `hiring_process_notes`, `screening_questions`, `application_mode`, `external_apply_url`*,
  `deadline_at`, `application_requirements`, `how_to_apply`*.
- **Step 7 · References & review** (`referenceVideos`): `reference_videos`, plus the
  candidate-facing review summary.
- **System-owned / derived from the verified hiring identity** (never typed):
  `youtube_channel_id`, `channel_name`, `channel_logo_url`, `channel_subscribers`,
  `channel_profile_slug`, `hiring_external_url_snapshot`, `posted_by_agency`,
  `agency_profile_slug`, `posted_platform`, `posted_youtube_channel_id`; plus lifecycle
  `status` and legacy `category`.

`*` = conditionally disclosed. **No field is removed, hidden permanently, or made
inaccessible.**

---

## 2. Cognitive-load analysis (what still caused friction)

- **Progress felt long.** "Step N of 7" with a single linear bar signals a long form even
  though several steps are short. → chapters (§4).
- **Density is concentrated in Step 1.** `basics` carries role + identity + platform +
  work mode + the full compensation cluster — the brief's canonical "don't combine role
  selection and detailed compensation." → flagged for the future split (§7); today the
  compensation cluster already progressively discloses (max/custom-unit), and the chapter
  header now frames Step 1 as the opening beat of "The opportunity."
- **Subtitles described the schema, not the conversation** ("Set the role, public hiring
  context, and compensation basis"). → rewritten as questions (§4).
- **No guarantee of completeness.** A refactor could silently drop a field with no test to
  catch it. → registry + safeguard (§3).

---

## 3. Field-completeness safeguard (mandatory acceptance condition — built)

[lib/jobFieldRegistry.ts](lib/jobFieldRegistry.ts) + [tests/jobFieldCompleteness.test.mjs](tests/jobFieldCompleteness.test.mjs):

- **Two-level "no field dropped" guarantee.** The registry is
  `Record<keyof BackendCreateJobPayload, JobFieldEntry>`, so `tsc` fails if a writable field
  is added without classification. The runtime test independently extracts the payload
  contract from `lib/backendClient.ts` and asserts a 1:1 match with the registry.
- **Every publication-validation field maps to a step + an actionable input.** The test
  cross-checks the `getBasicsErrors` + `validateJobPostingDomainForPublication` fields
  against the registry, and asserts each registry step equals `backendJobFieldStep(field)`
  so a publish failure always lands on the field-owning step.
- **The whole backend-error routing table agrees with the registry** (parsed from
  `backendJobFieldStep` source).
- **Consequential fields stay explicit.** `unpaid_trial_confirmed` and `hiring_identity_id`
  are asserted to be `confirmation` representation, never derived/system.

---

## 4. Chapter-grouped progress + conversational framing (built)

- `RECRUITER_JOB_CHAPTERS` in [lib/jobPostingForm.ts](lib/jobPostingForm.ts) groups the seven
  steps into three coherent arcs — **The opportunity** (basics · about · creatorContext),
  **Fit & arrangement** (toolsTags · details), **Applications & review**
  (applicationRequirements · referenceVideos). `chapterForStep` resolves the active chapter.
- The wizard header now shows **"Part 1 of 3 · The opportunity"** plus a **segmented
  progress bar** (one segment per chapter, each filling by steps completed inside it) — the
  brief's *"section progress rather than one long linear percentage."* The accessible
  `progressbar` role and all `aria-value*` semantics are preserved.
- **Subtitles rewritten as a guided conversation** — e.g. *"Who are you hiring, and what
  will you pay them?"*, *"Show the work — what they'll make, and what you'll hand over."*,
  *"Set the rhythm — timing, hours, and how you'll collaborate."*

---

## 5. Progressive disclosure (in place + verified by the registry)

Every `conditional-control` in the registry is a disclosure rule that is already honored in
`JobDomainFields.tsx` / `PostJobForm.tsx` (role specialization, city, range max, custom unit,
weekly hours, turnaround, all trial sub-fields, start date, duration value/unit, end date,
custom deliverable/frequency, sensitive-access confirmation, external URL). The registry now
makes these rules **auditable**: a field marked `conditional-control` that stops being
disclosed would break the semantic contract documented here.

---

## 6. Reduce-manual-entry & consequential-field rules (documented)

- **Prefill:** `platforms` and `hiring_identity_id` are prefillable from the selected
  verified hiring identity (`prefillable: true`).
- **Derivation:** `experience_level` is derived from the experience range; `budget_note`
  can derive from a "Flexible / Contact for pricing" intent; canonical role snapshot and
  compatibility category are derived server-side. Marked `derived`.
- **Role-aware suggestions:** `getJobRoleRules` already offers suggested deliverables,
  skills, and source-input helpers per role family — suggestions, never silent facts.
- **Consequential fields that always require explicit confirmation** (`confirmation`, or
  `conditional-control` flagged "never inferred" in the registry): `hiring_identity_id`,
  `unpaid_trial_confirmed`, `budget_amount`, `budget_max`, `trial_compensation_*`,
  `trial_work_usage`, `trial_portfolio_permission`, `trial_attribution`, sensitive
  `source_inputs`, `external_apply_url`, `deadline_at`. These are **never** prefilled from
  anything but an explicit existing value.

---

## 7. Implemented vs. recommended follow-ups

**Implemented in this work:** the full 14-screen split (§0); registry-driven screen routing
(`screenForField`, `firstScreenForGroup`, `screenForFieldError`); per-screen validation
gating (`SCREEN_BASICS_GATE`, `screenForBasicsError`); compensation moved to its own **Pay**
screen; work mode/city moved to **Working together**; trial/evaluation/applications split
into three dedicated screens; chapter-segmented progress; conversational per-screen questions;
`sections` props on the domain components; deep-link targets for every screen; the
field-completeness + reachability + screen-consistency safeguards; and updated structure,
completeness, and Playwright coverage.

**Recommended follow-ups** (each independently verifiable against the completeness net, which
already fails loudly on any dropped or mis-routed field):

1. **Collapse-completed-subsection summaries** in the repeatable domain sections
   (deliverables, languages, hiring stages, screening questions) — a one-line summary with an
   Edit affordance instead of leaving every row expanded. Partially served today by the
   compact completed-row rendering in `JobDomainFields.tsx`.
2. **Role preset library** ("Long-form video editing", "Short-form", "Thumbnail design", …)
   that preconfigures suggestions and UI structure only — never workload, pay, trial, or
   sensitive access. Role-aware *suggestions* already exist via `getJobRoleRules`
   (suggested deliverables, skills, tools, source-input helpers per role family); a preset
   picker would package them.
3. **Per-screen "required now vs. later" banner** driven by the registry's `requirement`
   field, so optional groups stop competing visually with mandatory decisions.
4. **Resume-to-most-relevant-screen** heuristic using the registry's required-field set.
