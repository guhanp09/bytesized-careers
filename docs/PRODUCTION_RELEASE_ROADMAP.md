# CreatorJobs — Production Completion and Product Expansion Roadmap

Approved implementation program, 2026-09-23. Starting HEAD:
`f6b54af159460ea12bb6c1273bfb878c64934401` on
`integration/import-and-messaging-2026-07-30`. Release assessment: **NO-GO**.

## Authority and preservation

This continues the audit; it does not replace it or restart accepted work.
`PRODUCTION_READINESS_EXECUTION.md` is the sole item-status source of truth;
`PRODUCTION_READINESS_HANDOFF.md` records exact checkpoint evidence and resume commands.
R phases below are completion waves mapped to original audit IDs, not renumbered history.
Each wave must be split into independently testable, committed, clean atomic slices.
Do not claim a whole wave complete when only a slice passes.

Product decisions: free India-first invite-only beta; 18+ eligibility attestation subject
to counsel approval (not verified age); initial public capacity target 100 active concurrent
users; AI Import retained, draft-only and human-reviewed. Recruiter and talent tracks are
both included. Optional features never substitute for release blockers.

Preserve canonical Post Job/unified AI Import, the single-profile BOTH model, screening,
Pipeline, Messaging/Application Management, scenarios, Backend/Mock parity, bounded
rendering, profile completeness, existing interviews/reviews/private notes/saved items.
No unsolicited redesign, automatic publishing/applying/messaging, or paid access.

Before each slice verify branch, HEAD, clean/understood worktree and no overlapping writer.
Never modify the five frozen recovery references recorded in the handoff. No broad staging,
history rewriting, destructive cleanup, push, deployment, hosted Neon/Vercel/Render change,
real customer data, paid provider call, or credential rotation. Use disposable local services.
Commit explicit paths after tests, full diff review and `git diff --check`; update ledger and
handoff and recheck cleanliness/recovery refs. Stop scope expansion before a slice cannot be
finished safely. A recovery checkpoint must contain no half-switched contract or migration.

## Evidence model

Each ledger item has an ID, severity, phase/subsystem, dependencies, status, required tests,
migration/infra needs, beta/public blockers and resolving commit. Completion-wave rows also
identify rollback/recovery and who owns the next action. Distinguish missing **implementation**,
missing **local proof**, missing **hosted proof**, and missing **policy approval**. Only the
last two inherently require an external operator/counsel; adapters can be built locally.

Use only NOT_STARTED, IN_PROGRESS, IMPLEMENTED, VALIDATED, BLOCKED_EXTERNAL,
DEFERRED_WITH_RATIONALE. Existing code, source assertions, SQLite proof, offline SQL,
container recipes and old passing aggregates are not interchangeable with end-to-end,
PostgreSQL contention, applied migration, built-image or hosted proof.

## Required completion waves

### R0 — Reconcile evidence and reproducible environment

Mapping: BASE-001/002/003/004, ROAD-001/002. Reconcile unfinished rows, preserve historical
proof, identify newly reproduced gaps, index reachable pages/APIs/workers/scheduled tasks
and role workflows, and inspect local branch differences read-only. Record exact baseline
failures and their isolated reproduction. Supply reproducible disposable PostgreSQL, Redis,
email test-provider and object-storage fixtures. Verify one Alembic lineage and current
revision on an explicitly local disposable database. Do not relabel unavailable services as
passing. Gate: a fresh engineer can repeat documented checks without hosted credentials.

### R1 — Newly demonstrated blockers

R1A / VIS-001: unify public account/listing eligibility across deep search, browse, details,
related results, profiles, metadata and sitemap. Cover suspension, deletion hiding, listing
deletion/publication and applicable expiry. Invalidate controlled caches; preserve authorized
private history. Split query enforcement and lifecycle/cache certification if necessary.

R1B / EMAIL-006: production must never substitute mock delivery. Disabled delivery pauses
claims without recording sent; resumption checks message freshness/expiry. Supply read-only
diagnostics for mock-success records, never automatic bulk resend. Gate: new regressions fail
on baseline, then pass through actual public/worker paths, including restoration/resumption.

### R2 — Complete browser authentication boundary

Mapping AUTH-007 and existing auth/session/admin regressions. Add same-origin server adapters
by consumer group with explicit method/path allowlists, origin/CSRF checks, no-store private
responses and server-only backend credentials. Keep legitimate server API clients compatible;
remove Session/type bearer fields only after consumers migrate. WebSockets receive 60-second
single-use tickets bound to user, durable session and origin, atomically consumed; Redis failure
fails closed. Retain ongoing revocation checks. Gate: login/OAuth linkage/MFA/refresh/logout/
reset/multitab/reconnect/expiry and all-role negative authorization matrix; no reusable browser
bearer. Use applicable OWASP ASVS requirements, without claiming external certification.

### R3 — Deterministic marketplace correctness

Mapping CORRECT-002/003/004/005/006/008, SEARCH-001, EDIT-001. Finish Pipeline/chat and
two-party delivery; canonical internal versus external application semantics, expiry/closure
and idempotency; duplicate Apply, step headings/reopen, stale onsite geography, presentation
strings in role data, narrow overflow and typing layout. External navigation is not submitted.
Replace silent newest-1,000 candidate search with complete database-filtered stable results;
test old matches, honest totals, status/filter/URL/empty/error states and deterministic ties.
Add revision conflicts where concurrent job/profile edits lose changes, retaining unsaved draft
on conflict. Gate: deterministic failures resolved; serial/parallel agree without weakened tests.

### R4 — Reliable email and usable invite-only onboarding

R4A / EMAIL-007: commit fenced claims before provider I/O; bounded off-loop SMTP; fence
finalization by lease/attempt; crash-before-send/after-acceptance/before-ack tests; retry/backoff,
expiry, suppression and operator recovery. SMTP is at-least-once with ambiguous outcomes,
not exactly-once; accepted is not delivered/read.

R4B / PRIV-006: Settings preferences, real unsubscribe links/headers, signed webhook replay
protection, suppression, explicit essential-event classification, reject unknown event classes,
and explicit opt-in for new digests. Provider DNS/actual mailbox checks remain EMAIL-005.

R4C / INVITE-003 with INVITE-001/002: authorized administrator issue/resend/revoke/history;
atomic invite plus outbox; secret-safe landing/OAuth state and password forwarding; verified
email binding, expiry/one use/revocation and existing-user compatibility. No token analytics,
referrer/log leakage. Beta manifest explicitly requires invite-only mode.

R4D / PRIV-001, ELIG-001, LEGAL-002: wire existing versioned acceptance into onboarding and
reacceptance; adult attestation, no full DOB by default; preserve logout/support/privacy-rights
access. Add versions, never edit immutable legal archives. Gate: both signup paths work end to
end through test email; invalid invitations/acceptance fail safely; counsel approves live policy.

### R5 — Durable, budget-controlled AI beta

Mapping AI-001/003/004/010, RATE-005 and contention subitems. Extend existing draft/attempt
state into an owned worker with stable operation ID, progress/poll/cancel/retry; survive browser
closure, crash, duplicate enqueue and stale leases. Move long brand enrichment off request-bound
background work. Sweepers must not independently spend: only admitted user-authorized attempts
may execute, with bounded authorized retries.
Enforce user burst/daily/concurrent/input/output limits, model allowlist, provider deadline,
worst-case atomic budget reservations, durable spending history, conservative uncertain costs
and admission/worker runtime kill checks (document already-running cost bound). Retain shared
SSRF boundary, source-only provider payloads, canonical validation and human review. Never auto
publish. Cover literal/inferred/ambiguous/conflicting/missing/malformed/long/injected sources,
provider/model/queue outages, real PostgreSQL contention and crash recovery. `store:false` is not
a zero-retention claim; configure and document provider data controls and prices honestly.

### R6 — Durable media

Mapping MEDIA-001..005. Implement S3-compatible adapter locally with emulator/stub; owner-bound
upload grants, quarantine/finalize, actual decode/re-encode through a maintained library, byte/
pixel/dimension/animation limits, orientation preservation and metadata stripping. Promote
immutable owned objects, not caller URL ownership. Preserve old upload consumers during migration;
add orphan/replacement/deletion/export/backup lifecycle and dry-run checksum backfill. Presigned
URLs are reusable bearer grants: enforce finalization replay/overwrite safety independently.
Gate: real adapter contract tests, hostile bytes, cross-user/expired/repeated/interrupted uploads,
orphan cleanup; production refuses ephemeral fallback. Hosted restore remains external.

### R7 — Shared realtime and socket bounds

Mapping REALTIME-001/003, RATE-006. Implement Redis bus behind existing seam; preserve recipient
authorization and wire behavior; no private content in telemetry or broadcast-to-all channels.
Database/HTTP reconciliation remains truth because Pub/Sub is at-most-once. Reconcile reconnect,
focus, instance switch and recovery; bus failure must not fail committed messages. Bound frame
bytes before JSON, schemas, user connections/subscriptions/rates, output buffers and slow clients,
including shared multi-instance quotas and session/origin checks. Gate: two-instance delivery,
duplicates, block/revoke, outage/recovery and slow-consumer tests.

### R8 — Privacy, moderation and compliance

Mapping PRIV-001..006, MOD-001/002, LEGAL-001/002. Inventory all subject-linked records; explicit
export scope and shared-data policy, reauthenticated async request/status/download (24-hour
artifact, 10-minute download grant defaults). Complete deletion/status/cancel/erasure/media flows,
immediate hiding/revocation and restricted cancellation proof that cannot remove admin suspension.
Versioned retention config, holds, dry runs, resumable jobs, compliance queues, evidence/appeals
and audit DB permissions. Production purging requires approved durations, never invented law.
Gate: cross-user/shared/held records, retry/partial failure/cancel/completion and audit denial;
counsel approval is separate from engineering validation.

### R9 — Reproducible release and recovery

Mapping CI/PLATFORM/OPS/DEP/BASE-004/RELEASE-001. Finish existing matrix, immutable non-root
production-only artifacts, actual image scan, SBOM/provenance/secret checks/private source maps,
authorized protected checks and combined database/Redis/storage/email/origin/cookie/proxy/host/
secret/flag validation. No demo/mock fallback. Drill readiness/liveness, graceful workers, queue
age/failure/saturation/media/realtime/auth/AI alerts, bounded privacy-safe telemetry, additive-schema
rollback, database/media restore and credential/provider/compromise incidents with named operators.
Proposed RPO <=15 minutes/RTO <=4 hours require operator approval and measured evidence, not a
current capability claim. Never put migrations back into every web instance's startup.

### R10 — Accessibility, metadata and measured capacity

Mapping A11Y/SEO/PERF/CERT-001. Preserve existing certified pieces; fill gaps using Chromium,
Firefox and WebKit plus keyboard/screen-reader/zoom/focus/error/touch/contrast/motion review.
WCAG 2.2 AA target, not axe-only certification. Canonical/noindex/sitemap/profile/job-expiry
and actual-flow-based directApply; measure bundles, images, query counts and long histories.
100 distinct active users, >=10,000 jobs and >=10,000 talent, mixed journeys plus workers for
60 minutes; brief 200-user overload/recovery. Proposed p95 reads <=500ms/writes <=1s, unexpected
server failures <0.5%, zero security/correctness failures; measure realtime separately. Browser
field targets p75 LCP <=2.5s, INP <=200ms, CLS <=0.1; lab is not field proof. Record exact build,
hardware, dataset, workload, limits and measured failures. Session correctness is not load proof.

### R11 — Certification and admission

Mapping CERT-001..004, OPS-008. Freeze build/locks/schema/config/flags, full acceptance matrix,
live provider/storage/Redis/restore/alerts/config checks, legal approval and support ownership.
72-hour staging soak then approved ten-account/seven-day pilot after security/privacy/provider
gates. Review incidents before expansion; material repair invalidates affected proof. Optional
features do not block the declared existing-product release.

## Additive feature waves (both audiences)

All F rows require independent server/cohort flags, additive compatible storage, no implicit
actions, privacy/authorization checks, existing scenario/mock parity and flag-on/off real-backend
regressions. Complete core readiness first. Apply the same certification to every later release.

| Phase / ledger ID | Capability and default | Dependencies | Acceptance / recovery |
|---|---|---|---|
| F1 / FEAT-001 | Recruiter job/screening templates create canonical drafts; private named shortlists; compare up to four factual profiles; preview bounded idempotent batch actions; reviewed closure notices | R3, R4, existing Pipeline/notes/saves | Single actions unchanged, missing data explicit, no opaque scores/auto-rejection, no private-note leakage; partial batch retry without duplicate send; disable new entrypoints without deleting records |
| F2 / FEAT-002 | Cross-device application drafts; private reusable answers linked to question IDs; selected existing portfolio work; exact recruiter-view preview; honest submission/external/status receipts; user-confirmed availability date | R3, R6 | No auto-apply, invented experience, cross-job answer leakage or draft loss; old application UI stays functional when off |
| F3 / FEAT-003 | Persist jobs/talent saved searches using existing versioned filter contract; explicitly opted-in daily/weekly digests, at most one discovery digest/user/day; send-time eligibility/consent checks; factual match reasons; owner freshness reminders | R3, R4 | No duplicates, hidden/expired matches, invented scores/activity or silent subscriptions; pause scheduling and retain settings |
| F4 / FEAT-004 | Existing interview ICS with stable UID/timezone/update/cancel; opted-in reminders; manual quick replies; recoverable message drafts/idempotent sends; private followups; versioned mutually acknowledged collaboration recap | R3, R4, R7 | Old reminders cancelled on reschedule; no private draft leakage; recap is not counsel-approved contract/payment guarantee; disable automation without altering interview/history |
| F5 / FEAT-005 | Per-session inventory/revoke; safe security activity; precise verification scope/date; customer-safe intake/projection over internal support tickets; report receipt/status, appeals and contextual help; locked-out contact route | R2, R8 | Cross-user session/ticket/report/appeal isolation; never expose staff notes; preserve email support when new intake is off |
| F6 / FEAT-006 | Recruiter clarity/missing-info/screening/edit suggestions; talent application/portfolio clarity from selected truthful facts; separate opt-in flags/budgets | R5, F1, F2 | No auto-send/publish/apply/hiring decisions; hallucination/injection/privacy/budget/outage evals and manual fallback; stop admissions without discarding drafts |
| F7 / FEAT-007 | Genuine discovery/save/apply/request/reply/interview/confirmed-collaboration funnel; private owner analytics with defined denominators/dedup/retention | R8, measured R10 baseline | Reconcile authoritative records; no private bodies in analytics; no public claims/rates until separately validated; collection/display independently stoppable |

Excluded pending a separate decision: payments/escrow, multi-seat hiring organizations, ATS
sync, two-way calendar OAuth, native apps and automated candidate ranking.

## Acceptance and external gates

Use current lock-backed commands: `npx tsc --noEmit`, `npm run lint`,
`node --test --experimental-strip-types tests/*.test.mjs`, `npm run build:release`,
`npm run test:e2e`, `npm run test:e2e:qa`, `npm run test:e2e:a11y`,
`npm run audit:production`, `git diff --check`. Build/browser sequential when sharing .next.
Backend: explicit disposable APP_ENV=test/DATABASE_URL; `.venv/bin/python -m pytest`,
`.venv/bin/ruff check app tests`, Alembic heads/current and
`./scripts/test_interaction_status_postgres.sh`. Add affected security/worker/adapter/chaos/
dependency/image/load/recovery gates. Inspect JUnit only after exit0; record skips and collection
deltas, with last full observed distinct from expected collection. Never weaken baseline tests.

Existing PostgreSQL harness uses loopback port55439, test credentials and tmpfs (never hosted).
`backend/scripts/exercise_redis_rate_limit.py` rejects non-loopback targets. Docker/service
availability must be checked before those exercises; ROAD-002 tracks missing reproducible
service orchestration and route/worker/workflow inventory, not a passing infrastructure gate.

External owners must provide authorized remote/protection checks, actual OAuth/key drills,
email DNS/delivery/bounces, storage/Redis security/recovery, database/media restore, AI billing/
availability/data controls, counsel-approved text/eligibility/retention, alerts/synthetics,
manual assistive review, staging soak and pilot. Credentials never excuse missing local code.

Release terms: NO-GO while required local work/blockers remain; LOCALLY READY — EXTERNAL
GATES REMAIN only after all required local implementation/proof; RELEASE CANDIDATE only
after every required local and external gate for the declared release passes.

## Technical references (verify again when the relevant slice changes APIs)

- OWASP ASVS: https://owasp.org/projects/asvs
- Gmail sending: https://support.google.com/mail/answer/81126
- OpenAI budget controller: https://developers.openai.com/cookbook/articles/per_run_spending_controller_responses_api
- OpenAI data controls: https://developers.openai.com/api/docs/guides/your-data
- S3 grants: https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html
- Redis Pub/Sub: https://redis.io/docs/latest/develop/pubsub/
- Accessibility: https://www.w3.org/TR/WCAG22/
- JobPosting: https://developers.google.com/search/docs/appearance/structured-data/job-posting
- Web Vitals: https://web.dev/articles/vitals
