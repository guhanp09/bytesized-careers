# Import Hiring Post — Guide & Testing

The **Import Hiring Post** feature lets a hiring user paste a job announcement they
already wrote elsewhere (LinkedIn, WhatsApp, Instagram, email, …). CreatorJobs
analyzes the text with a **fully deterministic, zero-marginal-cost parser** — no
LLM, no paid inference, no third-party API, no backend call — prepares a structured
draft, shows a review screen with verbatim evidence for every extracted value, and
hands the draft into the **existing** Post Job wizard, where the normal save-draft
and publish paths remain authoritative.

## How it works

1. **Entry** — `/post` shows an "Already wrote a hiring post?" card (flag-gated)
   linking to `/post-job/import`.
2. **Paste** — one large textarea. Pastes longer than 20,000 characters keep the
   first 20,000 with a persistent notice (truncate-and-retain); PREPARE DRAFT stays
   enabled. `Cmd/Ctrl+Enter` also triggers analysis. The paste survives refresh via
   an owner-stamped, tab-scoped sessionStorage key.
3. **Analyze** — `lib/importJob/parseJobPost.ts` runs synchronously in the browser:
   normalize → segment (long paragraphs split into sentence-bounded ≤280-char
   units) → sections → per-field extractors → claim-based prose composition →
   classification. Non-job text gets a "doesn't look like a hiring post" card with
   a **Parse anyway** override.
4. **Review** — fields grouped as **Imported / Please review / Missing /
   Application instructions from your post / Couldn't be carried over**, each with
   a quoted evidence snippet. Two pickers resolve ambiguity before the editor:
   a title picker on multi-role conflicts, and the always-visible **CategoryPicker**
   (uncertain mappings show an outlined "Suggested" chip and CONTINUE stays
   disabled until an explicit pick). The real `PreviewCard` renders on the right.
5. **Handoff** — CONTINUE TO EDITOR writes a versioned, owner-stamped payload to
   sessionStorage and navigates to `/post-job?import=1`. The wizard consumes it
   once (after the session resolves), hydrates every field through its existing
   setters, opens at the first field that needs attention (or the final publish
   step when nothing does), shows a dismissible banner with jump pills, and cleans
   the URL with a state-preserving `history.replaceState`.
6. **Publish** — unchanged: identity gating, validation, `PublishReadyDialog`, and
   the backend `POST /api/v1/jobs` remain the authorities. **Parsing alone never
   creates or modifies any server-side record.**

## Product rules (deliberate)

- **No fabrication** — every prefilled value traces to quoted source text
  (test-enforced property). Missing stays missing.
- **INR only** — foreign-currency amounts are surfaced as *Couldn't be carried
  over*, never converted.
- **Annual salaries (LPA/CTC) are never auto-converted** — amounts stay empty; the
  ÷12 arithmetic appears only as a hint inside the note.
- **External contacts are never auto-published** — emails, phones, forms, handles,
  and "DM me" phrases become review-only evidence plus native first-message
  requirement suggestions (portfolio / expected rate / availability). Publishing a
  contact detail requires typing it in the editor yourself.
- **Employment type is preserved, not discarded** — it's shown in review, kept as a
  tag, and supplies a budget-unit hint **only when the post states no explicit
  billing period** (an explicit "per project" always wins over "full-time").
- **Regions never auto-pick a city** — "Delhi NCR" or multiple cities become a
  conflict the employer resolves.
- **Category is never silently "Editing"** — a deterministic role→category map
  pre-selects confident cases; producer/unknown roles require explicit
  confirmation. The wizard's `jobCategory` state is durable: an imported Writing
  draft reopened via `?draftId=` stays Writing.

## Feature flag & deployment

- Flag: **`ENABLE_JOB_IMPORT`** — server-only (never `NEXT_PUBLIC_`; it gates two
  server components and ships in no client bundle).
- Semantics: explicit `true`/`false` wins; otherwise **on** in
  development/test/staging and **off** in production.
- Enabling in production later: set `ENABLE_JOB_IMPORT=true` in the hosting env and
  **redeploy** (env changes take effect on the next deployment; no code change).
  Rollback: unset it and redeploy — the card disappears and the route 404s;
  nothing persisted needs cleanup. *(No hosted environment variables were changed
  as part of this implementation.)*

## Measured performance (Stage-1 gate)

Parsing is synchronous on the main thread. Measured on dev hardware (Node 24,
best/median/worst of 10 runs):

| Input | Best | Median | Worst |
|---|---|---|---|
| Typical post (~1.2k chars) | 2.8ms | 4.2ms | 5.6ms |
| Single 1.5k-char paragraph | 3.7ms | 4.2ms | 5.2ms |
| Pathological 20k adversarial input | 60.2ms | 62.1ms | 65.8ms |

The plan's gate was: worst-case < 80ms or implement a >10k-char Web Worker path.
**60–66ms < 80ms ⇒ the Web Worker fallback was not required.** The parser is
DOM-free and pure, so a worker path remains a drop-in option if the corpus ever
grows heavier. A `node --test` perf assertion keeps the 80ms bound honest.

## Running the tests

```bash
# Unit (parser, mapping, handoff, reducer, flag, structural guards)
node --test tests/importJob*.test.mjs

# Everything (must stay green, incl. tests/postJobFlowStructure.test.mjs unchanged)
npx tsc --noEmit && npm run lint && npm run build
node --test tests/*.test.mjs

# E2E — mock config (no backend, port 3100; kill a stale server first)
lsof -ti:3100 | xargs kill 2>/dev/null; npx playwright test tests/e2e/import-job.spec.ts

# E2E — QA config (real stack, personas, ports 3200/8100)
npx playwright test -c playwright.qa.config.ts tests/e2e/qa/import-job-publish.spec.ts
```

## Manual test script

1. `npm run dev` (plus the backend if you want live drafts/publish).
2. Open `/post` → the import card → paste
   `tests/fixtures/import-posts/scriptwriter-email.txt`.
3. **PREPARE DRAFT** — review appears immediately (no artificial delay). Verify:
   CategoryPicker pre-selected **Writing**; the annual-salary row sits under
   *Please review* with empty amounts and the ÷12 hint in the note; the deadline
   row under *Couldn't be carried over*; "Apply by 15 August…" inside How to apply.
4. **CONTINUE TO EDITOR** — the wizard opens on Basics (budget needs input), title
   prefilled, banner pills jump between steps, the identity modal did **not**
   auto-open, and the URL is `/post-job` (no `?import=1`).
5. Browser Back/Forward — edits survive; no re-hydration; no expired notice.
6. **SAVE DRAFT** (signed in) → `/drafts` → reopen the draft → save/publish →
   category is still **Writing**.
7. Negative paths: paste lyrics (override card); paste `<script>alert(1)</script>`
   (inert text); paste >20k chars (truncation notice, still analyzable); refresh
   mid-review (paste restored); open `/post-job?import=1` cold (expired notice);
   switch QA personas mid-flow (no paste/handoff leaks — owner-stamped keys purge).
8. Flag off (`ENABLE_JOB_IMPORT=false` in `.env.local`, restart): card gone,
   `/post-job/import` 404s, `/post-job` behaves exactly as a fresh native visit.

## Known limitations (v1, by design)

Plain-text paste only (no URLs/screenshots/OCR). INR budgets only. Supported-India-
cities list; regions require picking a city. Platforms attach to YouTube/Instagram
(others become tags). No deadline field (kept as How-to-apply text). No part-time/
internship engagement type (kept as tags). One role per job (import again for the
other). English/Hinglish-leaning vocabulary — other languages degrade to partial
extraction, never a crash. An anonymous paste does not survive signing in mid-flow
(owner-stamped storage purges on owner change — deliberate).

## Candidate analytics (documented, NOT implemented)

The repo has no analytics stack; v1 ships without one. If a first-party event
route is ever added, these are the useful events (never include pasted text):
`import_opened`, `import_parsed` (field-status counts only), `import_continued`,
`import_draft_saved`, `import_published`. Success metrics: import→review
completion, review→publish rate, median fields corrected, most-missing fields,
not-a-job rate, category-correction rate.
