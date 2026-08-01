# AI Job Import: unified Post Job flow

## Outcome

AI Job Import is an input method, not a second job editor. Pasted text and public URLs now produce a private canonical job draft plus server-owned field metadata. The recruiter is taken directly into the existing Post Job form, where the ordinary chapter navigation, controls, validation, draft save, preview, and publication endpoint remain authoritative.

No import route can publish a job. Import application creates a private draft only; publication always uses the normal job API and its schema-version-3 rules.

## Architecture

### Previous flow

```text
source -> process -> import-specific review workspace -> apply -> Post Job
```

The review workspace duplicated field presentation and asked the recruiter to learn a second editing model. It also treated nearly every extracted field as a review decision.

### Current flow

```text
source -> process -> canonical values + field decisions -> private job draft
                                                      -> normal Post Job form
```

- `JobImportService` validates provider output, resolves server-owned evidence, applies field policy, and records decision metadata.
- High-confidence, policy-approved values become canonical draft values. Suggestions, conflicts, invalid values, and unknowns do not.
- `POST /job-imports/drafts/{id}/apply` creates an ordinary private `Job` through `JobService`.
- A partial import that cannot yet create a job opens the same Post Job form through `importDraftId`. After the normal job API saves it, the owner-only `attach` operation links the retained import context to that job. The attach operation never creates, changes, validates, or publishes the job.
- `GET /job-imports/native-jobs/{job_id}/context` restores owner-private inference metadata when the job is reopened.
- `PostJobPage` remains the sole editor and builds the same canonical create/update payload for manual and imported jobs.

No database migration was necessary. Existing import field JSON metadata stores the decision origin, confidence, risk, rationale code, and review signal; the existing `target_job_id` relationship stores recovery linkage.

## Product-pattern research

| Pattern | User problem solved | Decision | CreatorJobs implementation |
|---|---|---|---|
| [LinkedIn AI-assisted job descriptions](https://www.linkedin.com/help/linkedin/answer/a1579608) place generated content in the normal editable job description | Avoid learning a separate editor | Adapt | Import opens the real Post Job form, not an import review product |
| [LinkedIn can prefill from a saved or past job](https://www.linkedin.com/help/linkedin/answer/a415043) | Reduce repeated data entry | Adopt | Accepted import values are saved into a canonical private draft |
| [LinkedIn source citations](https://www.linkedin.com/help/linkedin/answer/a7437598) expose support for high-confidence answers | Make provenance inspectable | Adapt | “What I found” shows concise server-owned source evidence when it helps a decision |
| [Workable AI writing](https://help.workable.com/hc/en-us/articles/19771256915095-Best-Practices-Explore-Workable-s-AI-capabilities) keeps generated text editable | Preserve recruiter control | Adopt | A recruiter edit is immediately authoritative in normal form state |
| [Greenhouse job-post suggestions](https://support.greenhouse.io/hc/en-us/articles/36960585376283-Job-post-description-suggestions) save into the ordinary editor | Keep one publication workflow | Adopt | Manual and imported jobs share payload construction and publication validation |
| [Notion Autofill](https://www.notion.com/en-gb/help/autofill?nxtPslug=autofill) fills ordinary properties and can leave unsupported values blank | Prevent unsupported guesses | Adapt | Unknown and high-risk absent values stay blank; weak suggestions remain optional |
| A full extraction dashboard before the form | Makes system behavior visible | Reject | It increases review burden and duplicates the product’s canonical controls |
| An “AI-generated” badge on every input | Identifies machine involvement | Reject | Only ambiguity, contextual inference, conflicts, and missing blockers receive quiet guidance |

## Decision model

Each import field records:

- `origin`: `explicit`, `contextual_inference`, `semantic_inference`, `suggestion`, or `unknown`;
- `confidence`: `high`, `medium`, or `low` where applicable;
- `needs_review` and the existing provenance/review/authority states;
- server-owned evidence spans;
- a short technical `rationale_code` and a concise user-facing explanation;
- conflicts and canonical validation errors.

Precedence is strict:

1. valid explicit source value;
2. deterministic contextual resolution;
3. high-confidence semantic inference allowed by field policy;
4. non-authoritative suggestion;
5. blank/unknown.

An explicit value is never silently replaced by context. If context conflicts, the explicit value is retained as the proposal and the conflict is flagged.

## Field inference policy

| Field family | Risk | Allowed behavior | Prefill threshold | Examples |
|---|---:|---|---|---|
| Explicit descriptive fields | Medium | Explicit only | Valid explicit evidence | Title, descriptions, responsibilities, application instructions |
| Safe semantic fields | Low | Explicit, contextual, semantic, suggestion | High confidence with evidence | Creator role, platforms, formats, engagement, work mode, compensation unit, skills, tools, niches, deliverables, source inputs |
| Currency | Medium | Explicit or deterministic contextual | High confidence, one unambiguous role country | USD from a US role location; PLN from Poland |
| Cautious semantic fields | Medium | Explicit, semantic, or suggestion | No semantic auto-prefill in this release | Seniority, turnaround amount/basis, autonomy, start timing, duration, revision expectations, weekly schedule, hiring process |
| Explicit-only fields | High | Explicit only | Valid explicit evidence | Compensation amounts, exact dates, trial terms/payment, screening questions |
| Server-owned or legacy compatibility fields | High | Never provider-written | Never | Ownership, verification, schema version, legacy compatibility state |

Provider instructions are generated from this registry. The server validates every returned field against the same registry; a broad prompt cannot expand provider authority.

### Semantic distinctions

- Cadence is not turnaround. “Three Reels per week” may describe deliverable frequency but cannot produce a two-day turnaround.
- Senior responsibility can support a seniority suggestion but never a fabricated years-of-experience requirement.
- Role-default software is never treated as a required tool. Unmentioned tools remain absent or non-authoritative suggestions.
- “Premiere Pro is required” and “After Effects would be helpful” map to required and preferred concepts only when the source wording supports that distinction.

## Deterministic currency resolution

Currency resolution uses local GeoNames country/city data and Babel’s CLDR-backed current tender currencies. It does not use a small handwritten major-currency map.

Reliability order:

```text
explicit currency
> explicit role location
> structured role-location metadata
> employer location only for a clearly local hybrid/on-site role
> unknown
```

Rules and examples:

| Evidence | Result |
|---|---|
| New York role + amount + no currency | USD, contextual, high confidence |
| India role + amount | INR |
| London role + amount | GBP |
| Germany role + amount | EUR |
| Poland role + amount | PLN |
| Worldwide remote or multiple countries | Unknown |
| Employer in US, role in India | INR; role location wins |
| Explicit INR, role in US | INR retained; conflict warning |
| `.com` URL with no location | Unknown |
| Location but no compensation amount | Currency remains blank |

Browser locale, URL TLD, nationality, market-rate assumptions, and unrelated company knowledge never determine currency.

## Evidence and explanations

Evidence is resolved on the server against retained source content. The client cannot author or repair evidence spans. Context added from structured public-page metadata is bounded and incorporated into the retained server source before evidence resolution.

The UI exposes only contextual explanations and relevant quotations through “What I found”. It never exposes provider prompts, hidden reasoning, chain-of-thought, token data, or raw machine output.

## Loading and failure behavior

The import route uses one stable two-column surface with stages tied to actual client operations:

1. Opening the public post or reading supplied text;
2. Matching supported details to CreatorJobs during the atomic processing request;
3. Preparing the private canonical draft after processing returns.

There are no fake percentages, fake completed stages, or internal pipeline terms. A restrained candidate-preview skeleton establishes continuity. After eight seconds, a delayed-state message says only that detailed posts can take longer and that CreatorJobs is checking carefully instead of guessing. Progress is announced through one polite live region without repeated focus changes. Motion obeys reduced-motion preferences.

Cancel aborts the safe client request and retains pasted text or URL. Retry reuses the retained source/draft where possible. Public-page failures offer paste-text fallback. Partial processing opens the normal form with every valid value retained.

## Guided conversation inside Post Job

The private imported draft opens in one assistant-led surface above the real Post Job control for the current decision. It starts with the useful work completed, then shows one decision at a time. It does not lead with warning counts or show all unknown fields together.

- Consequential conflicts come first, followed by publication blockers, active conditional requirements, consequential confirmations, other ambiguities, and at most three role-relevant quality suggestions.
- Closely related values such as compensation, weekly hours, turnaround, trial terms, and application routing are grouped into coherent turns.
- Every turn explains what the source did or did not establish, why that matters for this job, and what the recruiter needs to decide.
- Valid explicit high-confidence values remain ordinary prefilled form values and do not manufacture questions.
- Conflict alternatives and safe suggestions use the existing private review mutations. Missing or free-form values use the native Post Job field directly below the message.
- Conditionally required questions are recomputed from the current canonical controls; final validity remains owned by canonical Post Job validation.
- Answers form a compact reconstructable history. Optional suggestions can be skipped individually or together, and the full editor remains one secondary action away.
- Completion explicitly says the draft remains private and cannot publish outside normal Post Job review.

Manual changes are authoritative. Partial hydration runs once. Existing native draft values are the editing source of truth; import context does not rehydrate over them. Reopening compares retained import values with the canonical job and suppresses stale import guidance for values the recruiter has changed or previously missing values they have supplied.

## Screening questions

Screening questions are explicit-only. Source wording is retained through the normal `screening_questions` domain model. `required: true` is accepted only when owned evidence contains an explicit mandatory marker; otherwise it becomes optional. No generic questions or automatic rejection criteria are invented. Editing and validation use the normal Evaluation screen and `serializeJobPostingDomain` path.

## Persistence, compatibility, and privacy

- Source, field decisions, conflicts, evidence, and canonical values remain backend-owned and account-private.
- Native drafts remain non-public and use existing owner access controls.
- Applied imports retain their context and allow recruiter decisions while the native job remains authoritative.
- Older import drafts in existing processing/review states resume through the unified entry route. Already-applied imports open their linked canonical job.
- Partial imports retain `importDraftId` through refresh and attach after a normal canonical save.
- No source text is copied to client storage.
- Redaction and retention behavior is unchanged.

## Analytics

`lib/jobImportAnalytics.ts` is a provider-neutral, no-op-by-default adapter. Its bounded events cover start, completion, failure, duration, source kind, decision counts, inferred-field changes or removals, and imported-draft publication. An inferred-field correction is emitted only after the canonical draft write succeeds and includes a boolean `removed` classification. Payload types accept only enums, counts, durations, and booleans.

The interface intentionally excludes source text, URLs, evidence snippets, screening wording/answers, private notes, names, and arbitrary job content. Analytics failure can never block product behavior.

## Accessibility and responsive behavior

- Source choices implement the complete keyboard tab pattern.
- Cancel, Retry, suggestion, review, dismiss, and source actions meet the 44px target used by the current product.
- Progress uses `aria-current="step"`; announcements use one `aria-live="polite"` region.
- Loading skeletons are hidden from assistive technology and disable animation under reduced motion.
- Guidance remains in the normal document flow and does not steal focus.
- Review navigation focuses the existing canonical control.
- QA verifies 320px, 390px, and the 720-CSS-pixel equivalent of a 1440px viewport at 200% zoom without horizontal overflow; the layout retains the existing mobile form stack and desktop preview rail.

## Rejected designs

- A second review workspace or copied Post Job JSX.
- Mandatory confirmation of every extracted value.
- Per-input AI badges.
- Fake progress percentages or rotating engineering messages.
- Client-authored provenance/evidence.
- Currency from browser locale, URL TLD, or employer headquarters for an explicitly different role location.
- Role-default tools treated as requirements.
- Import-only publication validation or a direct publish action.
- Chain-of-thought display or storage.

## Operational notes

- The feature flag remains server-owned.
- The provider adapter remains server-only and provider-neutral at UI/API boundaries.
- No migration is required for this change.
- Monitor structured import failure codes and aggregate correction rates only; do not log source content.
- Rollback can restore the previous UI code without removing additive decision metadata or linked drafts. Existing canonical jobs remain valid ordinary jobs.
