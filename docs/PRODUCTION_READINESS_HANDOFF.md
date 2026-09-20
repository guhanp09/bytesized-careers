# CreatorJobs Production Readiness Handoff

## Resume summary

```text
LAST COMPLETED PHASE: Phase 12 — locally implementable observability, incident-response and credential-rotation work is complete; OPS-005's local six-journey aggregate is now 6/6 and only hosted ingestion/delivery/scheduling/soak proof remains external
CURRENT PHASE:Phase13 certification — real-backend and cross-engine aggregates passed; remaining local behavioral proof and external gates.
LAST COMPLETED ATOMIC SLICE:13D / SEO-002 — real-backend sitemap pagination/timestamps/draft exclusion/refresh and owned backend-outage proof complete. Commit `test(seo): verify sitemap against real backend`.
NEXT ATOMIC SLICE:13E — bounded inventory of unresolved Phase4 trust/metrics rows against accepted code and tests; repair only demonstrated unverified live claims. AI queue still requires explicit persisted intent plus a PostgreSQL-validated migration; no unattended paid retries. PostgreSQL remains unavailable.
PHASE 11 STATUS: SEO-001/002/003/004, PERF-001, PERF-002, CORRECT-007 and A11Y-001 VALIDATED locally; A11Y-002 BLOCKED_EXTERNAL for a genuine manual keyboard/screen-reader/zoom/touch review.
CURRENT ALEMBIC HEAD: 0070_activity_page_indexes (single head; parent 0069_support_tickets)
CURRENT ALEMBIC CURRENT: disposable SQLite `.local-data/readiness-3o-backend.db` unstamped (2026-09-17); one head 0070_activity_page_indexes; no migration. Historical PostgreSQL migration proof was not rerun.
IMPORTANT NEW ARCHITECTURE (RATE-003B / OF-105): `app.services.google_places_service.GooglePlacesService` is a fixed-destination provider adapter, not an arbitrary-URL fetcher. It owns the backend-only Places key, disables redirects/environment proxies/cookies, streams decoded JSON under 128 KiB, applies four-second operation and six-second whole-attempt deadlines, and returns only bounded normalized dataclasses. `GET /me/location/autocomplete` and `/details` are authenticated and share `LOCATION_LOOKUP_LIMIT` (120/minute/user) through the existing Redis fail-closed boundary. The Next routes perform same-origin/session enforcement, own no provider key or network client, preserve local-catalogue fallback only for an explicit missing-provider code, and proxy bounded numeric retry guidance. `LocationAutocompleteField` attributes only provider-backed results with exact non-translated `Google Maps` text in the same visual container but outside the ARIA listbox. IMPORTANT NEW ARCHITECTURE (RATE-003A): `app.core.rate_limit.enforce_rate_limit` is the only HTTP allow/reject/fail-closed path. `rate_limit` supplies a trusted `ip:<address>` key before authentication; `authenticated_rate_limit` supplies `user:<verified UUID>` after the normal durable-session/strong-auth dependency. The namespace prevents a textual IP/user collision and user buckets follow the account across devices and NAT changes. Each dependency carries a `RateLimitPolicy`, so structural tests inventory the actual FastAPI graph rather than grepping source. One shared outbound category (30/10m/user) prevents endpoint-switch evasion; media is 20/hour/user, public deep search 120/min/IP, marketplace/messaging actions 120/5m/user, admin/support 300/5m/user, refresh 120/5m/IP and verification 60/10m/IP. Admin allowance is consumed only after permission succeeds. Anonymous reports remain IP-scoped. Logout/logout-all are explicit recovery exemptions.
IMPORTANT NEW ARCHITECTURE (RATE-001): `RedisRateLimitBackend.hit` is exactly one Lua `EVAL` over one sorted-set key. Redis `TIME` defines the window, a UUID defines each admission, and removal/count/admit/expiry or retry computation execute at one linearization point. The redis-py 8.1.0 client has one-second connect/command bounds, retry-on-timeout disabled and explicit RESP2 for supported Redis 7.2/7.4. Configured Redis is a mandatory production security dependency: startup pings it, runtime failure returns a generic 503, and neither path falls back to process-local counters. `backend/scripts/exercise_redis_rate_limit.py` accepts only an explicit loopback Redis URL and is shared by local proof and the exact Redis 7.4.11 CI service.
IMPORTANT NEW ARCHITECTURE (13B): `backend/scripts/audit_production_dependencies.py` exports the committed `--no-dev` lock rather than auditing the active developer environment, invokes pinned pip-audit 2.10.1 over fully hashed requirements, and compares every finding to `backend/security/pip-audit-allowlist.json`. The one existing ecdsa Minerva finding is exact by package/version/PYSEC/CVE/GHSA and points to executable HMAC-only evidence; any new/changed finding, version drift, missing evidence, malformed report, audit failure, or stale exception fails the gate. There is no `--ignore-vuln` or severity threshold. Realtime consumers now receive one canonical server handshake and use a ref for adaptive poll cadence, so connection-state paint no longer restarts polling effects. Live Star writes resolve the participant-authorised conversation before optimistic state and await a real PUT. Missing demo identity media remains missing and renders the initials fallback rather than fetching random public images. IMPORTANT NEW ARCHITECTURE (13A): none. This slice removes a certification gate through behavior-preserving import/typing/lint cleanup and current-date-safe test data; it adds no runtime service, dependency, migration or product contract. IMPORTANT NEW ARCHITECTURE (12E): `docs/CREDENTIAL_ROTATION.md` is the complete 18-family application credential registry and exact planned/emergency procedure. `scripts.rotate_strong_auth_secrets` gives the TOTP AES-GCM keyring the same dry-run-first, bounded, resumable rewrap boundary stored OAuth grants already had; both refuse a missing old key and never emit plaintext. Google credential-authority and email-webhook verification now accept one backend-only previous secret during planned producer cutover, while current stays mandatory and retirement is behaviorally proven. Compromise rotation deliberately omits previous. Production frontend boot now requires at least 32-character `NEXTAUTH_SECRET` and `GOOGLE_OAUTH_EXCHANGE_SECRET`; backend production validation rejects short JWT/webhook/unsubscribe values, previous-without-current, and same-value overlap. Rewrap is explicitly not revocation: exposed TOTP seeds must be re-enrolled and exposed Google grants revoked/reconnected. IMPORTANT NEW ARCHITECTURE (12D): `docs/INCIDENT_RESPONSE.md` is the application-specific response contract and `docs/INCIDENT_TABLETOP.md` records the no-provider decision-path review without promoting it to a live drill. Each incident path identifies detection, smallest reversible containment, privacy-safe evidence, recovery, verification and the precise external stop. `tests/incidentRunbooks.test.mjs` requires every named application control to have executable declaration, enforcement and an operator consumer, and forbids destructive/credential-bearing command blocks. Emergency `scripts.grant_admin --revoke` now takes the same user-first lock order as auth security events, demotes the account, revokes every durable session/refresh credential and appends a bounded actor-less audit event in one transaction. Demotion removes privilege immediately; temporary claimless migration access cannot be selectively revoked and therefore requires the documented suspension or coordinated global-secret containment step for ordinary access before its production-capped expiry. The email incident path also resolved a misleading operator contract: authentication and notification mail share one outbox/provider, so `EMAIL_DELIVERY_ENABLED=false` gates every real send after worker restart while durable intents continue queueing.
IMPORTANT NEW ARCHITECTURE (12C): `app.core.operational_alerts` is the only finite decision table over sanitized error/metric/static-message records. It has ten static keys with bounded severity, summary and runbook references; it never copies request IDs, routes, exception/provider text, URLs, identities or arbitrary labels. `python -m scripts.evaluate_operational_alerts` is a real JSONL consumer that emits at most one static alert per key per input batch and exits `2` when action is required. Provider log routing remains external. `npm run test:e2e:synthetics` selects exactly six existing QA tests by `@synthetic:{auth,browse,publish,apply,message,admin}` under the existing serial test-only-controller/disposable-SQLite/canonical-scenario harness; there is no second fixture corpus and the selected publish path arms a deterministic probe rather than calling a paid model. IMPORTANT NEW ARCHITECTURE (12B): `app.core.operational_metrics` is the sole constructor for seven finite metric families: HTTP request, database probe, Redis rate limit, email worker pass/delivery, realtime publish and AI provider call. Narrow producers accept no customer-label map; the JSON formatter independently allowlists name/subsystem/outcome plus bounded count/duration/status and canonical matched route templates. Auth, avatar/banner upload and AI-import HTTP traffic receive finite subsystem classifications. Standalone workers use the same structured-stdout transport as the API, so no in-process scrape registry or provider is required. The metric middleware runs inside RequestID and outside the body limiter, correlating a metric with the response UUID while observing early 413s. Caller `X-Request-ID` values are accepted only as canonical UUIDs; emails, tokens, URLs, prose and oversized values become a server UUID rather than log content. IMPORTANT NEW ARCHITECTURE (12A): `lib/clientErrorReporter.ts` and the React boundary/listener hooks emit no message, page URL, account data, auth context or arbitrary stack text—only a finite failure kind plus canonical `/_next/static/chunks/*.js` coordinates—to anonymous Redis-rate-limited `POST /api/v1/telemetry/client-errors`. `app.core.error_reporting` maps browser and backend failures into the same finite `error_event`; the structured stdout formatter never calls `LogRecord.getMessage()`, so third-party interpolation arguments do not become logs, and exception messages/source lines/host paths are replaced by type plus module-relative coordinates. Error ingestion is best effort and cannot replace the safe response. `npm run build:release` briefly enables maps, archives/checksums all production maps by immutable release, strips every public map and every browser hint, and fails if no maps exist; ordinary local build/boot requires no provider. IMPORTANT NEW ARCHITECTURE (11L): `playwright.a11y.config.ts` owns a sequential three-engine gate, while `tests/e2e/axeAudit.ts` injects the pinned direct axe runtime and fails on every selected whole-document WCAG A/AA violation. The matrix covers public routes, modals, Applications workspace states, 320 px reflow, 200%-equivalent zoom and reduced motion; the existing real-backend QA accessibility file uses the same helper. Standard, QA and accessibility Playwright jobs run sequentially because all share `.next`. Activity summaries now carry an already-authorized optional conversation ID; a scheduling action explicitly resolves and caches a legacy missing conversation before mutating, instead of racing a cancelable background detail read. IMPORTANT NEW ARCHITECTURE (11K): `app.services.activity_pagination` builds one key-only UNION ALL over four viewer-relative activity sources, applies an authenticated-owner scope in every branch, and keyset-pages by `updated_at DESC`, source rank and UUID. The opaque v1 cursor is strict base64url JSON bound to mode and snapshot; it is navigation state, never authorization. The first page may add one owned deep-link record without moving the ordinary cursor; a foreign include is ignored. Exact four-source counts are computed in one round trip. Only page IDs are widened into relationships, users, conversations, histories, engagements and review summaries. Default/all mode keeps a bounded recent owned-context compatibility slice; talent/hiring modes load only referenced context. Frontend rollout is expand/contract: deploy the compatible frontend first (it accepts a legacy response without `page`), then backend/migration; deploying the backend first would truncate an old client at 100 and is not the supported order. UI counts remain exact while queues/search/stage/archive views are explicitly described as loaded-only until older pages are fetched. Page reconciliation is functional, so an in-flight page cannot overwrite a newer local/realtime mutation. IMPORTANT NEW ARCHITECTURE (2B): portfolio HTML preview and YouTube/Vimeo oEmbed now call `SafeOutboundFetcher` instead of their own DNS/redirect logic; oEmbed additionally requires an exact built-in endpoint constant, refuses every redirect, accepts only JSON, and caps decoded bodies at 64 KiB, while HTML previews accept only HTML/plain text within 512 KiB; provider host detection matches a domain or its subdomains rather than any suffix, so `notyoutube.com` is no longer treated as YouTube; each metadata field extracted from an untrusted page is length-clamped; unsafe URLs are refused before any request and network/provider failure still returns the manual-entry response. IMPORTANT ARCHITECTURE (2A): `SafeOutboundFetcher` is the one backend boundary for user-influenced public GETs: strict HTTP(S)/80-or-443 URL normalization; public-only IPv4/IPv6 plus tunnel-address checks; DNS answers are copied into an httpcore network backend that connects only to those IPs while the original host remains the HTTP Host/TLS SNI/certificate identity; the connected peer is checked; every redirect gets fresh validation and a fresh cookie-free one-connection pool; environment proxies are ignored; decoded response bytes, content type, redirects, DNS/connect/read/total time, URL length, and header surface are bounded. PublicJobUrlFetcher and PublicBrandUrlFetcher preserve their product parsing/error/retry contracts on top. The Phase 1 verified identity, durable session, encrypted credential, and administrator TOTP architecture remains unchanged
NEW ENVIRONMENT VARIABLES: `GOOGLE_PLACES_API_KEY` moved from the frontend template to backend-only `SecretStr` configuration. It is feature-conditional: absent is a complete safe state using the owned local catalogue. Production still uses the existing `RATE_LIMIT_BACKEND=redis` and secret `REDIS_URL`; the test-only real-service command requires `RATE_LIMIT_TEST_REDIS_URL` and refuses anything except loopback. Phase 12E's backend-only planned-overlap `GOOGLE_OAUTH_EXCHANGE_PREVIOUS_SECRET` and `EMAIL_WEBHOOK_PREVIOUS_SECRET` remain as documented, along with the earlier auth/media/realtime/AI settings.
NEW DEPENDENCIES:latest3X/3Z lock updates documented below (Next16.3.5, Sharp0.35.4, mapping2.11.24; compatible developer-tooling group). No13C dependency change. Backend redis-py8.1.0 from3J; locked production53packages/55hashed requirement rows.
NEW SERVICES: no service was provisioned. Google Places is an optional fixed external provider behind the backend boundary; keep its key absent until console API restrictions, billing quotas, current provider-policy review and a live lookup/attribution/outage drill are complete. Production still concretely requires managed Redis 7.2+ for shared rate limiting, but none was contacted here. Existing local/CI audit, rotation, incident, metric, error and synthetic services remain as documented.
OUTSTANDING EXTERNAL REQUIREMENTS: Google Places console key/API/service restriction, billing quota, current terms/policy review and live lookup/attribution/outage drill before setting `GOOGLE_PLACES_API_KEY`; a human/operator tabletop; immutable artifact rollback/traffic-shift drill; hosted database/PITR and media restore; other real provider outage/failover/revocation drills; production credential rotation; production log ingestion/retention/access; real alert-destination delivery and acknowledgement; standalone-worker absence/process-death monitoring; scheduled synthetics against isolated staging data; evidence-backed traffic/latency/capacity thresholds; authenticated GitHub fetch/protection inspection; matching production GOOGLE_OAUTH_EXCHANGE_SECRET provisioning; real Google consent-screen scope configuration/verification and live login/incremental-consent/reconnect/refresh/revoke/outage drill; real OAuth/strong-auth keyring provisioning plus rotation drills; hosted credential backfill/encrypted-only verification; a physical authenticator-device drill and lost-all-factors support procedure; email DNS/provider; managed Postgres/Redis/storage; counsel approval; accessibility review; staging soak
KNOWN TEST FAILURES:13C corrected the live-smoke gate (string0 was truthy). FullQA293/293 included unintended live URL submission with blank key/recoverable failure, NOT live-provider certification. Actual fixed0selection now1skipped. Cross-engine87/87; Node1316/1316; type/build0; lint32warnings.3Y seven5worker intermittent failures remain documented despite isolated7/7 and full2worker504/504. Existing stream diagnostics persist. Backend latest7712passed/65skipped,7777cases; external gates remain.
COMMANDS TO RESUME:git status --short; git branch --show-current; git rev-parse HEAD; uptime. Read13D checkpoint and Phase4 trust rows before a bounded live-claims inventory. RUN_LIVE_IMPORT_SMOKE=0 genuinely disables live smoke. Never overlap build/browser owners or pytest processes.
FILES TO READ FIRST:13D checkpoint; docs/PRODUCTION_READINESS_EXECUTION.md Phase4; components/job-details/JobActionsPanel.tsx; tests/e2e/phase3b-detail-post.spec.ts. No application behavior changed in13D.
RELEASE ASSESSMENT: NO-GO
IMPORTANT NEW ARCHITECTURE (Phase 3M): `YouTubeProviderClient` is the only YouTube Data API transport. `fetch_user_youtube_channels` and `fetch_youtube_video_metadata` remain compatible entrypoints. `POST /me/youtube-identity` shares the existing verified-user outbound quota. `YOUTUBE_API_KEY` is preferred; backend-only `YOUTUBE_DATA_API_KEY` is the compatibility alias; both are SecretStr, blank primary falls through. Remove keys from the frontend at eventual operator cutover; no live configuration changed. The QA harness explicitly blanks both keys. No new migration, dependency, service or AI behavior change.
IMPORTANT NEW ARCHITECTURE (Phase 3N): Pure-ASGI HttpAdmissionMiddleware admits synchronously before await, counts until the application unwinds in finally, and rejects excess work without reading/parsing/queuing. Metrics, CORS and request ID wrap its 503. MAX_CONCURRENT_HTTP_REQUESTS is required at production boot and bounded by schema; local/test fallback is 100 for existing local concurrency harness. One additional slot is only for exact GET health liveness. Redis quotas and WebSocket lifecycle are unchanged. No migration, new dependency/service or AI behavior change.
IMPORTANT NEW ARCHITECTURE (Phase 3O): REQUEST_BODY_IDLE_TIMEOUT_SECONDS=10 and REQUEST_BODY_WAIT_BUDGET_SECONDS=60 are finite bounded settings. Pure-ASGI receive wrapping times only incomplete body waits; cumulative wait prevents drip resets; after final body/disconnect no timer is installed. Body exceptions are HTTPExceptions so FastAPI does not translate 408/413 to generic 400. No new dependency/service/migration or AI change.
```

The machine-readable work status is in `docs/PRODUCTION_READINESS_EXECUTION.md`. The older `docs/PRODUCTION_READINESS.md` predates the current product and audit; treat it as historical context, not the active source of truth.

## Phase13D checkpoint — real-backend sitemap behavior (2026-09-20)

```text
Phase:13D / SEO-002
Status:COMPLETE; SEO-002 VALIDATED locally. Overall CERT-001 remains IN_PROGRESS.
Initial HEAD:32cde8ee02aaf381ffd69a6810fab51753982eb8
Final HEAD / Commit:git log -1 --format=%H --grep='test(seo): verify sitemap against real backend'
Files materially changed:backend/scripts/qa_sitemap_fixtures.py;
 tests/e2e/qa/sitemap.spec.ts; ledger/handoff.
Behavior changed:TEST HARNESS ONLY. No application behavior changed.
Contract:clone existing canonical public job/talent templates into105 published+1 draft per
 family, under a random UUID namespace, only inside the explicit APP_ENV=test harness-owned
 SQLite QA database. Reject all other environments/URLs, missing files and symlinks; SQL-bound
 values and atomic transactions. Never reset the corpus; finally remove only the212 owned IDs.
 Browser reads actual Next sitemap and real backend lists, proving >100-record pagination for
 both families, all210 public fixtures, draft exclusion, duplicate absence, true lastmod,
 dynamic timestamp refresh, exact cleanup and preservation of original templates.
 Timestamp comparisons intentionally use list GETs: talent detail GET increments views and
 updated_at. The strengthened test first failed because it mutated its own comparison target;
 corrected to compare the same non-mutating representation used by sitemap, not looser bounds.
Tests / exact results:real-backend sitemap2/2,14.8s,1worker,exit0; fresh QA production build0.
 Full frontend Node1316/1316,0skips/failures,exit0; existing sitemap unit12/12; TSC0;
 changed-file ESLint0 and Python Ruff0; git diff --check clean.
 Owned outage drill:backend8100 confirmed ECONNREFUSED, standalone Next3307 /faq200,
 /sitemap.xml500 and no fabricated successful urlset. Same real QA production artifact.
 Owned3307 server stopped after drill (SIGINT130 expected); no listener remains.
Evidence:/tmp/creatorjobs-13d-sitemap-final-20260920.log;
 /tmp/creatorjobs-13d-{outage,node,unit,tsc-final,lint}-20260920.log.
 Initial strengthened-test failure:1pass/1fail, timestamp expected1789903242000 vs1767292200000
 in /tmp/creatorjobs-13d-sitemap-verified-20260920.log. Test-owned GET side effect, not baseline
 application regression. Final corrected2/2 recorded above.
Security assumptions:fixture helper is test-only, loopback backend, exact disposable database;
 no production credentials/providers or hosted data. Outage is a real stopped backend, not
 route interception. No paid AI calls; RUN_LIVE_IMPORT_SMOKE=0 with blank provider keys.
Migrations / dependency changes / new environment / services:none.
Current Alembic head:0070_activity_page_indexes, single; latest recorded disposable SQLite
 current unstamped (Sept17), not a PostgreSQL proof. No migration changes since that check.
LAST_FULL_SUITE_OBSERVED:Node1316/1316 current; realQA13C293/293 includes292 deterministic
 and one unintended live smoke before its gate repair (see13C correction); a11y87/87.
 Standard3Y504/504 at2workers precedes3Z tool/data update. Backend3W7712passed+65skipped
 =7777JUnit cases, exit0, independent collection7777; backend application unchanged since.
EXPECTED_CURRENT_COLLECTION:Node1316; realQA295 (+2 new sitemap tests); backend7777 unchanged.
Known external failures / remaining risks:all provider/infra/legal/manual gates remain.
 No full aggregate rerun claimed from this focused suite. Static protocol ceiling behavior
 is not a >50,000-record empirical proof. Existing load-related browser intermittency remains.
Next phase:13E bounded inventory of still-open Phase4 trust rows, without reopening resolved
 deterministic workflows. Repair only concrete unsafe/fabricated live behavior.
Important commands:
 RUN_LIVE_IMPORT_SMOKE=0 OPENAI_API_KEY= GOOGLE_PLACES_API_KEY= npm run test:e2e:qa -- tests/e2e/qa/sitemap.spec.ts --workers=1
 node --test tests/sitemapCoverage.test.mjs
 npx tsc --noEmit
 backend/.venv/bin/python -m ruff check backend/scripts/qa_sitemap_fixtures.py
Frozen refs:all five exact hashes unchanged; integration branch preserved.
Working tree:explicit four-file commit; verify clean after commit. No push/deploy/hosted
 Neon/Vercel/Render access. AI retained and unchanged. Release assessment:NO-GO.
```

## Phase13C checkpoint — real-backend/cross-engine evidence and live-test opt-in (2026-09-20)

```text
Phase:13C / CERT-001A
Status:COMPLETE for this validation/harness slice; overall CERT-001 remains IN_PROGRESS.
Initial HEAD:957cc4155639310b3870f37af931431dff457986
Final HEAD / Commit:git log -1 --format=%H --grep='test(certification): enforce explicit live import opt-in'
Files materially changed:tests/e2e/qa/import-live-smoke.spec.ts;
 tests/ciWorkflowContract.test.mjs; ledger/handoff.
Behavior changed:TEST HARNESS ONLY. Live paid-provider smoke now requires RUN_LIVE_IMPORT_SMOKE
 to equal exactly1. Previously !process.env.RUN_LIVE_IMPORT_SMOKE treated string0 as enabled.
 Regression evaluates the actual test.skip AST argument for absent/empty/0/false/true/yes/01/
 whitespace and1. Baseline fails on0; fixed suite16/16. No application behavior changed.
IMPORTANT CORRECTION:the fullQA command explicitly set RUN_LIVE_IMPORT_SMOKE=0, but because of
 that bug the live smoke WAS EXECUTED. Prior commentary claiming that0 disabled it was incorrect.
 It reached recoverable-failure in4467ms. OPENAI_API_KEY and GOOGLE_PLACES_API_KEY were blank;
 no production credentials were supplied. Do NOT treat this as a successful live-provider drill.
 Public URL submission occurred; provider billing was not empirically checked. No success claim.
 Actual fixed Playwright selection with0 now exits0 with1intentionally skipped. This restores the
 documented opt-in contract, not a skip added to conceal a failing product test.
Tests / exact results:full real-backendQA293passed/0failed/0skipped,16.7m,1worker,exit0 (before
 opt-in correction, includes the unintended live smoke). All292 deterministic tests passed.
 Chromium/Firefox/WebKit accessibility87/87,1.8m,1worker,exit0; fresh harness production builds0.
 Full Node1316/1316 (+1); TSC0; lint0errors/32existing warnings; git diff --check clean.
 Latest standard browser504/504 at2workers is3Y, before3Z's compatible tool/data update.
 Evidence:/tmp/creatorjobs-13c-qa-20260919.log;
 /tmp/creatorjobs-13c-{a11y,live-gate-baseline,live-gate,live-disabled,node,tsc,lint}-20260920.log.
 Exact baseline failure:ciWorkflowContract.test.mjs paid live import smoke, must not opt in with0,
 false !== true,exit1. Isolated fixed regression+actualPlaywright prove corrected behavior.
Security assumptions:blank provider credentials are fail-closed; explicit opt-in never grants
 authority to spend money. RUN_LIVE_IMPORT_SMOKE=1 still requires user authorization and setup.
Migrations / dependency changes / new environment / services:none; AI functionality unchanged.
Backend unchanged:LAST_FULL_SUITE_OBSERVED7712passed/65skipped/72warnings;
 EXPECTED_CURRENT_COLLECTION7777; delta0. Alembic0070/current disposableSQLite unstamped unchanged.
Remaining risks:existing Next destination-stream-closed diagnostics persist during navigations;
 seven5worker intermittent browser failures from3Y remain recorded. No live hosting/provider/legal,
 PostgreSQL migration/concurrency, Docker image, Gitleaks/Trivy/SBOM external proof newly established.
Next phase:13D SEO-002 real-backend sitemap pagination/lastmod/failure behavioral proof;
 then remaining local certification gaps. AI durable queue still needs a validated migration.
Commands:read app/sitemap.ts,tests/sitemapCoverage.test.mjs,backend/app/api/v1/routers/jobs.py,
 backend/scripts/start_qa_test_server.py; inspect existing canonical fixture/test helpers first.
 Do not overlap build/browser owners or pytest; paid test requires exact1 and must remain off.
Safety:clean explicit-path local commit; frozen refs unchanged; no push/deploy or hosted
 Neon/Vercel/Render/production-credential changes. Release:NO-GO, not release certification.
```

## Phase3Z checkpoint — compatible developer-tooling security updates (2026-09-19)

```text
Phase:3Z / DEP-004
Status:COMPLETE / VALIDATED
Initial HEAD:8a3020bc2b6eafc557ccb7d8ffe7d2677b24f48c
Final HEAD / Commit:git log -1 --format=%H --grep='security(deps): patch developer tooling advisories'
Files materially changed:package-lock.json; tests/developerDependencySecurity.test.mjs; ledger/handoff.
Dependencies:Babel core7.28.6→7.29.7 (related parser/generator/traverse/types7.29.8);
 humanfs node0.16.7→0.16.8/core0.19.2, required transitive types0.15.0;
 brace-expansion1.1.15→1.1.21 and2.1.1→2.1.7; browserslist4.28.1→4.29.0;
 js-yaml4.1.1→4.3.2. Browser-data dependencies follow the compatible Browserslist release.
 Exactly27 lock entries changed in these families. Five vulnerable packages remain dev-only;
 caniuse-lite1.0.30001766→1.0.30001810 is shared with production Next. An initial diagnostic
 assertion that ALL changed entries were dev-only failed on caniuse-lite; classification corrected,
 not suppressed. New clean production artifact tested below. Manifest/override unchanged.
Behavior changes:source maps outside package root refused; humanfs copies symlinks as links;
 expansion count/length bounded; YAML includes empty merge sources in accounting and caps sequences;
 Browserslist prototype-safe stats/cache fixes,4.29 adds query continuations. No major upgrade.
 Tests retain benign behavior and use tiny owned fixtures, not resource-exhaustion payloads.
Migrations / new application environment / services:none. No application workflow/auth/AI changes.
Tests run / exact results:focused new security11/11; full Node1315/1315 (+11); TSC/build exit0;
 lint0errors/32existing warnings; npm full audit0 all severities (previous3high/1moderate/1low);
 production audit gate0 analysed/0 unanalysed. No exception or threshold change.
 Clean production artifact /tmp/creatorjobs-3z-production.ju7z5l: npm ci --omit=dev --ignore-scripts
 installed81/audited82/0vulnerabilities; productionDependencyArtifact10/10 exit0.
 Evidence:/tmp/creatorjobs-3z-{focus,node,tsc,lint,build,production-audit,production-install,artifact}-20260919.log;
 /tmp/creatorjobs-3z-all-audit-20260919.json. Install began before pause in3z-install-20260917.log.
Browser:latest3Y standard504/504(2workers); liveStar2/2. Not rerun after this tooling patch yet;
 full real-backend293 and cross-engine aggregate are NEXT, not claimed green.
Backend unchanged:LAST_FULL_SUITE_OBSERVED7712passed/65skipped/72warnings;
 EXPECTED_CURRENT_COLLECTION7777; delta0. Alembic0070/current ownedSQLite unstamped unchanged.
Security assumptions:clean macOS artifact proof is not a Linux/Docker image scan. Upstream npm
 audit only covers published advisories. No new code uses these packages for customer input.
Known external failures:PostgreSQL/container/scanner availability and all hosted/provider/legal gates
 unchanged. Seven intermittent5worker browser failures from3Y retained; no false release certification.
Next phase:13C full real-backend QA with paid/live imports explicitly off, then3engine accessibility;
 resolve reproducible current failures in small commits; preserve original failed evidence.
Commands:RUN_LIVE_IMPORT_SMOKE=0 OPENAI_API_KEY= GOOGLE_PLACES_API_KEY= npm run test:e2e:qa -- --reporter=line
 npm run test:e2e:a11y -- --workers=1 --reporter=line
 Run sequentially, no overlapping build/Playwright/pytest owners.
Safety:explicit-path local commit, clean boundary; frozen references unchanged; no push/deploy,
 hosted Neon/Vercel/Render/production credentials/paid provider calls. Release:NO-GO.
```

Maintainer references reviewed before updating: [Babel advisory](https://github.com/babel/babel/security/advisories/GHSA-4x5r-pxfx-6jf8), [Babel provenance patch](https://github.com/babel/babel/releases/tag/v7.29.7), [humanfs changelog](https://raw.githubusercontent.com/humanwhocodes/humanfs/main/packages/node/CHANGELOG.md), [brace-expansion advisory](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-rgw5-rvv9-x895), [Browserslist security patch](https://github.com/browserslist/browserslist/releases/tag/4.28.7), [Browserslist4.29](https://github.com/browserslist/browserslist/releases/tag/4.29.0), [YAML4 changelog](https://raw.githubusercontent.com/nodeca/js-yaml/v4/CHANGELOG.md).

## Phase3Y checkpoint — authenticated demo Star boundary (2026-09-17)

```text
Phase:3Y / CORRECT-002A
Status:COMPLETE / VALIDATED
Initial HEAD:5e9958e433468fd36604f4b4ffe0bc50bcd933c7
Final HEAD / Commit:git log -1 --format=%H --grep='fix(workspace): keep authenticated demo stars local'
Files materially changed:components/you/ApplicationsWorkspace.tsx;
 tests/e2e/{scenarioAnchors.ts,messaging-accessibility.spec.ts,messaging-regressions.spec.ts};
 tests/e2e/qa/workspace-next-action.spec.ts; ledger/handoff.
Behavior changed:toggleStar uses liveMode for both conversation resolution and persistence.
 Authenticated explicit-demo records remain local; live resolution/authorization/PUT/rollback unchanged.
Security assumptions:demo selection already explicit; token presence alone does not mean live data.
 Tests observe both live conversation resolution endpoints and preference writes; none fire in demo.
 Live rollback test now waits for the actual503 PUT response before asserting rollback. Prior initial
 false-state assertion could pass before a write; no existing assertion removed or weakened.
Migrations / dependency changes / services / environment:none. AI retained, draft-only, untouched.
Tests run / exact results:serial demo3/3,14.6s; live private/durable/rollback2/2,21.2s;
 full standard504/504,2workers,4.3m; Node1304/1304; TSC/build exit0; lint0errors/32existing warnings.
 git diff --check clean. All successful processes exit0. Backend unchanged since3W:
 LAST_FULL_SUITE_OBSERVED=7712passed/65skipped/72warnings; EXPECTED_CURRENT_COLLECTION=7777;
 delta0. Alembic head0070_activity_page_indexes/current disposableSQLite unstamped unchanged.
Initial broad failure retained:default5workers497passed/7failed/5.1m under load peaking93.59.
 Exact tests:admin-panel.spec.ts:123 header admin menu; candidate-job-experience.spec.ts:60 filters;
 dev-tools.spec.ts:26 reset confirmation and:64 collapse; settings.spec.ts:384 logout-all and:444
 YouTube disconnect; talent-browse.spec.ts:73 popup bottom735.09375 > viewport720.
 First six:8s missing panel/expected state. All7 pass unchanged isolated1worker15.4s, then in full
 2worker run. Baseline3X full2worker passed these7; NOT claimed fixed or proven solely environmental.
 Ownership:browser certification; release impact:intermittent risk remains under CERT-001.
 Evidence:/tmp/creatorjobs-3y-{star-serial,live-star,e2e,e2e-bounded,isolated,node,tsc,lint}-20260917.log
 Original failed traces:/tmp/creatorjobs-3y-browser-failures.8lFcrH/test-results (inactive, preserved).
Known external failures:existing PostgreSQL/container/scanner/hosted/provider gates unchanged;
 fullQA aggregate and cross-engine recertification still pending. Existing stream diagnostics retained.
Next phase:3Z DEP-004, compatible Babel/humanfs/brace-expansion/browserslist/js-yaml patch group;
 no blind major upgrade. Then complete QA and accessibility certification.
Important commands:RUN_LIVE_IMPORT_SMOKE=0 OPENAI_API_KEY= GOOGLE_PLACES_API_KEY= npm run test:e2e:qa
 npm run test:e2e -- --workers=2 --reporter=line; never overlap build/browser owners.
Safety:no push, deployment, hosted Neon/Vercel/Render, production credentials or paid AI.
 Frozen refs unchanged; explicit-path local commit; release NO-GO.
```

## Phase3X checkpoint — framework and native-image security patches (2026-09-17)

```text
SLICE / STATUS:3X production patch group COMPLETE; DEP-001A VALIDATED; parent aggregate still open.
HEAD BEFORE:5d6de8c0831c19a8e5de940d8650994f4aca53e1
HEAD AFTER / COMMIT:git log -1 --format=%H --grep='security(deps): patch framework and image processing advisories'
CONTRACT:Next16.3.1→16.3.5; Sharp0.35.3→0.35.4 with actual libheif1.23.2/vips8.18.6;
  baseline-browser-mapping2.10.33→2.11.24. Lock changes only these families/platform artifacts.
  Next16.3.3 patches Windows RCE/AVIF;16.3.4 restores AVIF with patched dependency;16.3.5 adds
  empty-image cache and CSP loading/template nonce fixes. Browser mapping throws on invalid
  conflicting options rather than terminating its host. No feature removed or advisory waived.
FILES:package.json; package-lock.json; tests/productionDependencyArtifact.test.mjs; ledger/handoff.
MIGRATIONS / ENV / SERVICES:none; backend untouched; Alembic0070/current unstamped unchanged.
TESTS:focus16/16; full Node1304/1304 (+5); TSC/build0; lint0errors/32existing warnings.
  Real-backend CSP/personas/import41/41,2.5m,exit0,including fresh production build;
  /tmp/creatorjobs-3x-qa-focus-20260917.log. Explicit RUN_LIVE_IMPORT_SMOKE=0 and blank paid key.
ARTIFACT:clean npm ci --omit=dev --ignore-scripts in /tmp/creatorjobs-3x-production.sayr3B;
 81packages installed,82audited,0vulnerabilities; actual artifact tests10/10,exit0;
 /tmp/creatorjobs-3x-production-artifact-verified-20260917.log. No live image/Docker claim.
SCANS:npm production0 at ALL severities; /tmp/creatorjobs-3x-production-audit-20260917.json.
  Full developer install remains5 affected packages: Babel low, humanfs moderate, brace-expansion/
  browserslist/js-yaml high. /tmp/creatorjobs-3x-all-audit-20260917.json. Separate3Z, no threshold change.
BROWSER FAILURE:standard aggregate501passed/3failed/4.6m,2workers,exit1. Exact failures:
  messaging-accessibility.spec.ts:109 keyboard Star; messaging-regressions.spec.ts:166 row/header
  Star; same file:197 Pipeline card Star. aria-pressed staysfalse, expectedtrue,8s assertion timeout.
  All3 also fail isolatedserially. No test deleted/skipped/weakened. The aggregate is NOT green.
BASELINE PROOF:git archive5d6de8c into /tmp/creatorjobs-3x-star-baseline.9Veehn; independent npm ci
  and local Prisma generation, installed Next16.3.1 verified. Same3 unchangedtests fail serially
  with identical aria-pressedfalse; /tmp/creatorjobs-3x-star-baseline-20260917.log. No branch/worktree
  switched or modified, no live DB. Root cause:toggleStar checks token, not explicit liveMode,
  and tries to resolve a nonexistent backend conversation for authenticated demo records.
LAST_FULL_BACKEND:3W7712passed/65skips/72warnings/418.42s,7777cases0failures/errors,exit0.
NEXT READY:3Y CORRECT-002A liveMode boundary + network-silence regression assertions and live Star
  durability/privacy/rollback tests; rerun full standard suite, then remaining real-backend aggregate.
  Afterwards3Z DEP-004 dev-tooling patches. Known stream-closed diagnostics remain unsuppressed.
SAFETY:explicit-path local commit; no push/deploy/hosted Neon/Vercel/Render/paid AI/prod credentials.
  Frozen recovery refs unchanged. AI retained and draft-only. Release:NO-GO.
```

Reviewed maintainer notes: [Next 16.3.4](https://github.com/vercel/next.js/releases/tag/v16.3.4), [Next 16.3.5](https://github.com/vercel/next.js/releases/tag/v16.3.5), [Sharp 0.35.4](https://sharp.pixelplumbing.com/changelog/v0.35.4/), [browser mapping 2.11.0](https://github.com/web-platform-dx/baseline-browser-mapping/releases/tag/v2.11.0). Advisory links are in the 3W checkpoint.

## Phase3W checkpoint — shared AI attempt allowance (2026-09-17)

```text
SLICE / STATUS:3W AI-004A COMPLETE/VALIDATED (local application contract; not production billing).
HEAD BEFORE:f3518180ec3a423ed920525a4a4868c4b11f4b13
HEAD AFTER / COMMIT:git log -1 --format=%H --grep='security(ai-import): bound shared system attempt allowance'
CONTRACT:one fixed shared Redis bucket bounds logical extraction admissions over rolling30days.
  Reuses RATE-001 atomic Lua/server clock and fail-closed bounded transport. Default1000;
  JOB_IMPORT_SYSTEM_ATTEMPT_LIMIT range1..100000. Unit includes bounded provider retries, NOT
  currency/tokens/calendar-month. Duplicate/current outcome and user-capacity rejection precede
  reservation. Global refusal/cancellation rolls back local daily quota/lease/attempt. An uncertain
  or accepted reservation is never refunded after DB/provider failure. Completed owned GET stays
  available during Redis outage; mutations retain their mandatory HTTP safeguard. No auto-publish.
KEY FILES:backend/app/services/job_import_{system_budget,processing_service}.py;
  core/{config,config_contract}.py; tests/test_job_import_system_budget.py;
  tests/test_operational_metrics.py; backend/{.env.example,README.md}; ledger/handoff.
MIGRATION / DEPENDENCIES / SERVICES:none. Single Alembic head0070_activity_page_indexes;
  disposable SQLite .local-data/readiness-3o-backend.db current remains unstamped (Sept17).
BASELINE FAILURE:full run failed only test_operational_metrics.py::
  test_ai_processing_records_provider_success_without_source_or_identity; object has no scalar.
  Reproduced isolated using exact f351818 processing module loaded IN MEMORY, no worktree switch:
  /tmp/creatorjobs-3w-metrics-baseline-20260917.{log,xml},exit1. Phase3S added a repository count
  absent from this DB-free fixture. Add that mock plus assert-awaited; retain privacy/success
  assertions and all real-session admission tests. Earlier failed aggregate is NOT certification.
FOCUS:155passed/1existing skip/5warnings/3.48s,exit0;
  /tmp/creatorjobs-3w-focus-pass-20260917.{log,xml}. Eleven new budget cases and one config case.
BROWSER:canonical import6/6,31.3s,one worker,production build0;
  /tmp/creatorjobs-3w-browser-20260917.log. Existing Next stream diagnostics not suppressed.
FRONTEND:Node1299/1299; TSC/build0; lint0errors/32existing warnings. Whole backend Ruff0.
EXPECTED_CURRENT_COLLECTION:7777 independently collected, +12 from7765;
  /tmp/creatorjobs-3w-collection-20260917.log (per-file counts summed, not progress characters).
LAST_FULL_SUITE_OBSERVED:3W final7712passed/65existing skips/72warnings/418.42s,exit0;
  /tmp/creatorjobs-3w-full-backend-pass-20260917.{log,xml}. Parsed7777testcases,0failures/errors,
  matching independent collection. Initial failing aggregate is superseded, not hidden.
SCANS:frontend production audit exit1: Next16.3.1 critical GHSA-p293-qw3h-jr36 and
  GHSA-2xp9-vwfh-vxw4; Sharp0.35.3 high GHSA-rgj7-g3m4-5g8c. Raw npm audit also lists moderate
  baseline-browser-mapping2.10.33 GHSA-w5vr-8v7q-w6rv. These packages did not change in3W.
  Backend locked-production audit exit0:2 analysed ecdsa report entries,0unanalysed; no new waiver.
NEXT READY:3X DEP-001 patch group, then resume complete frontend/browser certification (inventories:
  standard504/42files, real-backendQA293/31files). Maintainer fixed floors Next16.3.3/Sharp0.35.4;
  read linked advisories/release notes before applying. Do NOT lower scan thresholds/add exceptions.
BLOCKERS:production Redis persistence/no-eviction/recovery and billing ceilings; authoritative prices
  for currency accounting; actual PostgreSQL and explicit durable queue migration/worker;
  existing provider/legal/storage/staging/accessibility/external gates. NO-GO.
SAFETY:explicit-path local checkpoint; frozen recovery refs unchanged; no push/deploy/hosted
  Neon/Vercel/Render changes, production credentials or paid provider calls. No new services.
```

Sources for the next patch group: [Next Windows advisory](https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36), [Next AVIF advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4), [Sharp advisory](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c), [Next 16.3.3 release](https://github.com/vercel/next.js/releases/tag/v16.3.3), [Sharp changelog](https://sharp.pixelplumbing.com/changelog/v0.35.4/).

## Phase3V checkpoint — recovery is not new provider work (2026-09-16)

```text
SLICE / STATUS:3V AI-001B COMPLETE/VALIDATED. Durable execution still IN_PROGRESS.
HEAD BEFORE:beb1b29e36d08e10089a9ac20b91e075eadf8f58
HEAD AFTER / COMMIT:git log -1 --format=%H --grep='fix(ai-import): recover only abandoned leased attempts'
CONTRACT:recovery_eligible requires a recorded expired lease on an eligible unfinished draft;
  it is independent of processing_eligible (permission to START paid work). Batch selection and
  atomic write both recheck recovery eligibility. Recovery sets its worker/lease only, never an
  attempt increment; final exhausted attempts can settle. Already settled failures stay untouched.
  Legacy processing rows without leases retain separate read-time metadata liveness.
KEY FILES:backend/app/repositories/job_import_execution_repository.py;
  tests/test_job_import_{execution_claim,sweeper}.py; backend/README.md; ledger/handoff.
MIGRATIONS / ENV / SERVICES / DEPENDENCIES:none; Alembic0070 unchanged.
BASELINE:3 new regressions failed onbeb1b29: untouched draft failed; recovery incremented attempts;
  final-attempt crash not recovered. /tmp/creatorjobs-3v-sweep-before-20260916.xml,exit1.
TEST CONTRACT CORRECTIONS:batch/exclusivity fixtures now actually have expired leases; exhausted
  fixture usesMAX_ATTEMPTS, notMAX-1 (recovery is not another attempt). Structural assertions now
  parse AST for distinct processing/recovery predicates and retain both batch/write guards.
FOCUS:115 passed/4warnings/5.06s exit0; /tmp/creatorjobs-3v-sweep-final-20260916.xml.
BROAD:AI5687 passed/39existing skips/10warnings/108.27s,5726 JUnit cases,exit0;
  /tmp/creatorjobs-3v-ai-20260916.xml. Node1299/1299; Ruff/diff-check0.
BROWSER:canonical import6/6,37.7s,one worker,production build0;
  /tmp/creatorjobs-3v-browser-20260916.log. Existing Next stream-closed diagnostics unchanged.
LAST_FULL_SUITE_OBSERVED:3R candidate7734=7669passed/65skipped before its final late-result guard.
EXPECTED_CURRENT_COLLECTION:7765 actually collected (+6); not an entire7765-test execution.
  /tmp/creatorjobs-3v-collection-20260916.log. Last TSC/lint3R0errors/32existing warnings.
NEXT READY:3W global provider-attempt budget; queue CHECK constraint requires explicit migration
  planning, not adding a schema-less queued string. PostgreSQL/infrastructure/legal/staging and
  accessibility gates remain unverified; no repeated unchanged environment probes.
SAFETY:explicit-path local commit; clean tree/frozen refs unchanged; no push/deploy/hosted
  Neon/Vercel/Render or production credentials. AI retained, draft-only. Release:NO-GO.
```

## Phase3U checkpoint — owned PostgreSQL admission exercise (2026-09-16)

```text
SLICE / STATUS:3U local harness COMPLETE; AI-003B IMPLEMENTED, AI-003A still BLOCKED_EXTERNAL.
HEAD BEFORE:caba5324a0edd2ba421821a0c7a7966e358769df
HEAD AFTER / COMMIT:git log -1 --format=%H --grep='test(ai-import): add owned PostgreSQL admission drill'
CONTRACT:scripts.exercise_import_admission validates the exact loopback harness URL BEFORE engine
  import/environment rebinding. Eight independent DB sessions share the actual quota/claim/count
  primitives; require2 admissions/6 rollback refusals, one duplicate claim, owner isolation and
  reusable released capacity. No providers; only fresh UUID-scoped fixtures. Finally cancels/awaits
  sibling tasks and removes/checks only owned fixture cascades, never a prefix/table-wide delete.
KEY FILES:backend/scripts/exercise_import_admission.py; tests/test_import_admission_drill.py;
  scripts/test_interaction_status_postgres.sh; .github/workflows/ci.yml;
  tests/ciWorkflowContract.test.mjs; backend/README.md; ledger/handoff.
MIGRATION / ENV / DEPENDENCIES / SERVICES:none; script reuses POSTGRES_TEST_DATABASE_URL and
  process-local DB timeout/pool settings. No schema changes; single Alembic0070 unchanged.
TESTS:focus57 passed/4warnings/2.86s; compatibility77 passed/7warnings/2.78s, both exit0;
  /tmp/creatorjobs-3u-{drill,compat}-20260916.xml. Exercise on test SQLite verifies results and
  unrelated-row preservation on success/assertion/cancellation. NOT actual PostgreSQL proof.
  Node1299/1299; Ruff/diff-check0; YAML parsed. No product behavior changed, no browser rerun.
LAST_FULL_SUITE_OBSERVED:3R candidate7734=7669passed/65skipped before final late-result guard.
  Last full AI3T5672passed/39skips; last browser3T6/6/build0. Current7759 actually collected(+9),
  /tmp/creatorjobs-3u-collection-20260916.log. No claim7759 execution.
BLOCKERS:actual PostgreSQL exercise and query-recovery drill unrun; unchanged missing Docker/local
  PG environment not reprobed. CI never pushed/run remotely. Hard process kill cannot execute
  finally; any such leftovers belong only to the disposable harness, never production.
NEXT READY:3V durable execution intent/queue; top summary warns against sweeping unrequested work.
SAFETY:explicit-path local commit; clean tree/frozen refs unchanged; no push/deploy/hosted
  Neon/Vercel/Render or production credentials. AI retained; release:NO-GO.
```

## Phase3T checkpoint — fresh contested-claim state (2026-09-16)

```text
SLICE / STATUS:3T AI-002A COMPLETE/VALIDATED; PostgreSQL contention exercise moved to separate3U.
HEAD BEFORE:80253fe5e734ac43205ff2c69549b15f23e730f9
HEAD AFTER / COMMIT: git log -1 --format=%H --grep='fix(ai-import): refresh state after contested claims'
CONTRACT: Only race recovery opts into populate_existing on the owner-scoped draft query. Both
  initial requests may have cached awaiting_processing; after losing a claim, return the current
  already_processing/processed state instead of stale409. Normal reads retain pending in-memory
  edits, and refresh never bypasses owner or soft-deletion filters. No HTTP payload contract change.
KEY FILES: backend/app/repositories/job_import_repository.py;
  app/services/job_import_{service,processing_service}.py; tests/test_job_import_user_concurrency.py;
  ledger/handoff. No new migration/dependency/env/service; Alembic0070 unchanged.
BASELINE:two requests barriered before quota consumption deterministically returned409 on80253fe;
  /tmp/creatorjobs-3t-snapshot-before-20260916.xml,exit1. Fixed200 already_processing, one provider
  call and one quota charge. Initial new test helper double-counted its FakeProvider base calls;
  replaced with the existing FakeProvider(release=event), retaining the strict one-call assertion.
FOCUS:55 passed/4warnings/4.47s,exit0; /tmp/creatorjobs-3t-snapshot-final-20260916.xml.
BROAD:AI5672 passed/39 existing skips/10warnings/87.37s,5711 JUnit cases,exit0;
  /tmp/creatorjobs-3t-ai-20260916.xml. Node1298/1298; Ruff/diff-check0.
BROWSER:canonical import6/6,29.1s,one worker,production build0;
  /tmp/creatorjobs-3t-browser-20260916.log. Existing Next destination-stream-closed diagnostics.
LAST_FULL_SUITE_OBSERVED:3R candidate7734=7669passed/65skipped before its final late-result guard.
EXPECTED_CURRENT_COLLECTION:7750 actually collected (+3); not an entire7750-test execution.
  /tmp/creatorjobs-3t-collection-20260916.log. Last TSC/lint3R0errors/32existing warnings.
NEXT READY:3U isolated PostgreSQL admission contention exercise; see top summary. Actual PostgreSQL
  recovery/races, production infrastructure/legal/accessibility/staging gates remain unverified.
SAFETY:explicit-path local commit; clean tree; frozen refs unchanged; no push/deploy/hosted
  Neon/Vercel/Render or production credentials. AI retained, draft-only. Release:NO-GO.
```

## Phase3S checkpoint — cross-draft user concurrency (2026-09-16)

```text
SLICE / STATUS:3S local implementation COMPLETE; AI-003A BLOCKED_EXTERNAL for PostgreSQL contention.
HEAD BEFORE:610bbc7e29b65e22ec40504ea37a3d8d7ec3a2fd
HEAD AFTER / COMMIT: git log -1 --format=%H --grep='security(ai-import): limit concurrent drafts per account'
CONTRACT: consume_import_quota's UPDATE holds the per-user row lock across tentative draft claim,
  live-lease count and begin_processing commit. Count occurs AFTER tentative claim; over-limit
  rolls back the whole admission transaction (quota, lease, attempt), returning safe429 before
  provider work. No filter on deleted/status: hiding a running draft cannot manufacture capacity.
  Count helper is NOT independently safe admission; never move it outside that write transaction.
NEW ENV:JOB_IMPORT_CONCURRENCY_LIMIT default2, range1..10. No dependency/service/migration added.
KEY FILES: backend/app/core/{config,config_contract}.py;
  app/repositories/job_import_execution_repository.py; app/services/job_import_processing_service.py;
  tests/test_job_import_user_concurrency.py; backend/{.env.example,README.md}; ledger/handoff.
FOCUS:139 passed/1 existing skip/4warnings/3.75s; config+health+new tests157 passed/1 existing skip/
  4warnings/2.73s. JUnit /tmp/creatorjobs-3s-{concurrency,config}-20260916.xml; both exit0.
  Six concurrent different drafts=>exactly2 calls/4 uncharged429s; refused draft attempt0/leaseNone;
  retry after completion succeeds; independent owners; hidden/deleted/final-state live leases count;
  expiry restores capacity. Actual transaction identities agree and provider holds no transaction.
BROAD:AI tests5669 passed/39 existing skips/10warnings/91.14s,5708 JUnit cases,exit0;
  /tmp/creatorjobs-3s-ai-20260916.xml. Node1298/1298; Ruff/diff-check0.
BROWSER:canonical import QA6/6,30.4s,one worker,production build0;
  /tmp/creatorjobs-3s-browser-20260916.log. Existing Next destination-stream-closed diagnostics.
LAST_FULL_SUITE_OBSERVED:3R candidate7734=7669passed/65skipped before its final late-result guard.
  Last TSC/lint3R:0errors/32existing warnings. Current7747 actually collected (+12:11 new concurrency
  cases+1 config contract); /tmp/creatorjobs-3s-collection-20260916.log. Not a full7747 execution.
MIGRATION:unchanged single0070_activity_page_indexes; last explicit local SQLite3R unstamped.
BLOCKERS:SQLite concurrency is local evidence, NOT empirical PostgreSQL row-lock/multi-process
  proof. Add an owned-loopback exercise to CI/harness next. No repeated Docker/provider probes.
NEXT READY:3T owned PostgreSQL contention harness plus simultaneous same-draft snapshot review;
  then real durable execution and global budget. Top summary lists files/commands.
SAFETY:explicit-path local commit, frozen refs unchanged; no push/deploy/hosted Neon/Vercel/Render
  or production credentials. AI retained, draft-only. Release:NO-GO.
```

## Phase3R checkpoint — provider deadline and lease coherence (2026-09-15)

```text
SLICE / STATUS:3R AI-005A COMPLETE/VALIDATED; RATE-005 and durable queue remain IN_PROGRESS.
HEAD BEFORE:fc1946dfc57c3989a8ce89769f0a202d15b17b05
HEAD AFTER / COMMIT: git log -1 --format=%H --grep='security(ai-import): align provider deadlines and durable leases'
CONTRACT: maximum_provider_seconds uses the actual45s viable floor and2s maximum retry delay,
  shared with adapter construction/backoff. Provider-only asyncio deadline defaults182s, max726s;
  processing lease/liveness add120s surrounding-work margin (302s default,846s max). No blanket
  database/commit cancellation. Owned expiry returns saved504 failure/retry; source retained.
  Caller/provider error identity preserved; a late result after caught timer cancellation is refused.
KEY FILES: backend/app/core/job_import_{attempt_liveness,execution}.py; app/api/deps.py;
  app/services/job_import_{provider,processing_service}.py; integrations/openai/job_import_adapter.py;
  tests/test_job_import_{provider_budget,terminal_state}.py; README; ledger/handoff.
MIGRATIONS / DEPENDENCIES / ENV / SERVICES:none. Alembic heads0070_activity_page_indexes;
  current explicit disposable .local-data/readiness-3r-backend.db unstamped. No hosted DB touched.
FOCUS:107 passed/4warnings/3.55s. Initial run106 passed/1 failed: prior terminal-state test called
  age301s abandoned, but it omitted actual2s retry backoff. Corrected to303s and added alive-at302s
  assertion; provider-floor/default and all failure/retry contracts remain. No tests weakened/skipped.
LAST_FULL_SUITE_OBSERVED: candidate7734 total=7669 passed/65 existing skips/72warnings/423.88s,
  exit0, /tmp/creatorjobs-3r-full-backend-20260915.xml. Then added one late-result rejection guard
  and regression; reran ALL affected AI tests on final code:5658 passed/39 existing skips/10warnings,
  5697 JUnit testcases,93.01s,exit0; /tmp/creatorjobs-3r-ai-final-20260915.xml.
EXPECTED_CURRENT_COLLECTION:7735 actually collected (+26 vs3Q); not a new entire backend run.
FRONTEND:Node1298/1298; TSC/build/Ruff0; ESLint0errors/32existing warnings.
BROWSER:canonical import QA6/6,31.6s,one worker,production build; no paid provider;
  /tmp/creatorjobs-3r-browser-20260915.log. Existing Next destination-stream-closed diagnostics.
BLOCKERS / RISKS:provider cancellation requires cooperative async transport; no thread/CPU
  preemption or guarantee a cancelled remote call is unbilled. Queue/poll remains local work:
  frontend still has240s HTTP wait and long configured imports need durable execution. At rollout,
  drain old import processors: new code cannot retrofit old running leases/cleanup. PostgreSQL
  races/recovery, live infrastructure/legal/accessibility/staging gates remain unverified.
NEXT READY:3S cross-draft user concurrency using the existing atomic daily-counter transaction.
  Top summary gives architecture/files/commands. Do not introduce an unlocked count-and-claim.
SAFETY:local explicit-path commit; frozen refs unchanged; no push/deploy/hosted Neon/Vercel/Render
  or production credentials. Release:NO-GO.
```

## Phase 3Q checkpoint — attempt-owned AI lease cleanup (2026-09-15)

```text
SLICE / STATUS: 3Q AI-001A COMPLETE/VALIDATED; RATE-005 and AI-001 remain IN_PROGRESS.
HEAD BEFORE: 1feff89335ef0249074b71fa788dc66005ac0b0c
HEAD AFTER / COMMIT: `git log -1 --format=%H --grep='security(ai-import): fence cleanup by processing attempt'`
CONTRACT: Success/failure cleanup passes the exact current worker ID into the existing guarded
  SQL updates. Worker IDs use full attempt UUIDs, not a12-hex display prefix. A delayed old
  cleanup cannot clear newer ownership or schedule its retry. Provider/UX/API/schema unchanged.
KEY FILES: backend/app/services/job_import_processing_service.py;
  backend/tests/test_job_import_lease_fencing.py; execution ledger/handoff.
MIGRATION / DEPENDENCIES / ENV / SERVICES: none. Single Alembic head0070 unchanged; no DB migration.
BASELINE REPRO: new failure-cleanup regression failed on1feff89 (new worker becameNone), exit1;
  /tmp/creatorjobs-3q-fence-before-20260915.xml. Actual DB predicate regression, no sleeps.
FOCUS: five new fencing cases + processing/execution/sweeper/terminal/quota/provider suites:
  174 passed/5warnings/5.45s exit0; /tmp/creatorjobs-3q-fence-20260915.xml.
BROAD: tests/test_job_import*.py tests/test_openai*.py tests/test_import*.py:
  5632 passed/39 existing skips/10warnings/86.63s exit0;5671 JUnit testcases;
  /tmp/creatorjobs-3q-ai-20260915.xml. Node1298/1298 and Ruff/diff-check0.
BROWSER: npm run test:e2e:qa -- tests/e2e/qa/import-job-publish.spec.ts --reporter=line
  =>6/6,31.4s,one worker,production build0; /tmp/creatorjobs-3q-browser-20260915.log.
  Controlled fixtures, no paid provider. Existing Next destination-stream-closed diagnostics
  occur; not suppressed/fixed. Private draft, retry and narrow/zoom canonical form checks pass.
LAST_FULL_SUITE_OBSERVED: entire backend3O7680=7615passed/65skipped. Current ACTUAL collection7709
  (+5); /tmp/creatorjobs-3q-collection-20260915.log. AI subset is not an entire backend rerun.
RECONCILIATION: Prior Phase6 local-completion claim corrected. API routers/job_imports.py awaits
  process(); job_import_sweeper explicitly calls no provider. It is recovery, NOT durable queued
  execution. Daily quota/per-draft lease are not cross-draft user concurrency. These are READY
  local work, not merely unavailable PostgreSQL proof. AI remains functional/draft-only.
NEXT READY:3R provider wall-clock/lease budget, then user concurrency and durable execution.
READ FIRST: app/services/job_import_processing_service.py; app/core/job_import_execution.py;
  app/core/job_import_attempt_liveness.py; app/api/deps.py viable-timeout floor;
  tests/test_job_import_timeout_policy.py. Resume from backend: APP_ENV=test .venv/bin/python -m
  pytest -o addopts='' -q tests/test_job_import_lease_fencing.py tests/test_job_import_processing_lease.py
SAFETY: clean explicit-path local commit; frozen refs unchanged; no push/deploy/hosted
  Neon/Vercel/Render or production credentials. External gates unchanged; release NO-GO.
```

## Phase 3P checkpoint — asyncpg operation deadlines (2026-09-15)

```text
SLICE / STATUS: 3P local implementation COMPLETE; RATE-004C BLOCKED_EXTERNAL for real PostgreSQL proof.
HEAD BEFORE: 8f93fdfa27cf7d6f3f57a94d2ec91dcba214bf0d
HEAD AFTER / COMMIT: resolve `git log -1 --format=%H --grep='security(database): bound asyncpg connection and command waits'`
CONTRACT: _connection_options passes finite connect/command bounds to the application asyncpg
  engine only. SQLite/Alembic are unchanged; driver owns cancellation, no write retry or blanket
  request/transaction deadline. Unknown commit outcome requires persisted-state reconciliation.
KEY FILES: backend/app/db/session.py; backend/app/core/{config,config_contract}.py;
  backend/tests/test_db_pool_bounds.py; backend/scripts/{exercise_database_timeouts.py,
  test_interaction_status_postgres.sh}; backend/{.env.example,README.md};
  .github/workflows/ci.yml; tests/ciWorkflowContract.test.mjs; ledger/handoff.
NEW ENV: DB_CONNECT_TIMEOUT_SECONDS=10 (maximum120), DB_COMMAND_TIMEOUT_SECONDS=30 (maximum300);
  both finite positive. No migration/dependency/service added; AI functionality unchanged/retained.
FOCUSED TESTS: db_pool_bounds/config/config_contract/auth_sessions/health_contracts:
  195 passed/1 existing skip/4 warnings/13.61s; /tmp/creatorjobs-3p-db-focus-20260915.xml.
  release_migration/container_hardening/http_admission/request_body_limit:
  92 passed/8 warnings/2.48s; /tmp/creatorjobs-3p-db-compat-20260915.xml. Both exit0.
  Real installed asyncpg abandons a stalled loopback handshake before the outer guard, with no
  checked-out connection. URL guards reject hosted/unowned/query-override drill targets.
BROAD TESTS: Node1298/1298 exit0 (/tmp/creatorjobs-3p-node-final-20260915.log); Ruff/diff-check0.
LAST_FULL_SUITE_OBSERVED: 3O backend7680 total=7615 passed/65 skipped; TSC/build0,
  ESLint0errors/32warnings; browser42/42. Not rerun for this PostgreSQL-only application change.
EXPECTED_CURRENT_COLLECTION: 7704 actually collected exit0 (+24:22 DB regressions+2 config cases).
  /tmp/creatorjobs-3p-collection-20260915.log. Not a claim 7704 execution passed.
KNOWN FAILURES / BLOCKERS: No task-caused failure. No local PG binary; unchanged Docker blocker
  not reprobed. The read-only owned-loopback pg_sleep timeout/rollback/query/pool-reuse drill is
  wired into CI and local PG harness but NOT executed against PostgreSQL. Empty URL CLI refusal
  actually returned2 before engine import; guard evidence only. Ingress/capacity and external
  release gates remain. Alembic single0070_activity_page_indexes; no migration changed.
NEXT READY ITEM: 3Q RATE-005 AI resource-guard reconciliation. Read job_import_processing_service.py,
  job_import_service.py, API job_import.py and config.py. Resume: git status --short;
  git branch --show-current; git rev-parse HEAD. No overlapping pytest/build/browser owners.
SAFETY: explicit-path local commit only; frozen refs unchanged; no push/deploy or hosted
  Neon/Vercel/Render/production credentials used. Release assessment NO-GO.
```

## Phase 3O checkpoint — incomplete-body receive deadlines (2026-09-15)

```text
SLICE / STATUS: 3O / RATE-004B COMPLETE; parent RATE-004 stays IN_PROGRESS.
HEAD BEFORE: 272f3da2b0fd198fe35332c32be8760ce0371e91
HEAD AFTER / COMMIT: resolve `git log -1 --format=%H --grep='security(request): bound incomplete body receive waits'`
CONTRACT: Each incomplete body receive has a finite idle timeout and cumulative wait budget;
  small drips cannot reset the budget. Processing outside receive, completed-body disconnect
  listeners, transactions/provider calls and WebSockets are untouched. Timeout cancels the
  awaited receive and releases admission after cleanup. External cancellation/transport timeouts
  keep their identity. Body rejection is HTTPException, preserving 408/413 through FastAPI.
KEY FILES: backend/app/middleware/request_body_limit.py; backend/tests/test_request_body_limit.py;
  backend/app/core/{config,config_contract}.py; backend/{.env.example,README.md}; ledger/handoff.
MIGRATION / DEPENDENCIES / SERVICES: none. AI import unchanged and retained.
NEW ENV: REQUEST_BODY_IDLE_TIMEOUT_SECONDS=10 (0 < value <=120);
  REQUEST_BODY_WAIT_BUDGET_SECONDS=60 (0 < value <=300); finite values only. Defaults are receive
  bounds, not production throughput promises. Validate permitted media uploads on staging links.
FOCUSED TESTS: request_body_limit, http_admission, config, config_contract, health_contracts,
  operational_metrics => 214 passed / 1 existing skip / 6 warnings / 1.68s / exit 0.
  /tmp/creatorjobs-3o-body-20260915.xml. Includes real FastAPI stalled/oversized-body cases proving
  auth/DB dependencies and mutations are not entered; headers/CORS/correlation survive.
BROAD TESTS: APP_ENV=test DATABASE_URL=sqlite+aiosqlite:///./.local-data/readiness-3o-backend.db
  YOUTUBE_API_KEY= YOUTUBE_DATA_API_KEY= .venv/bin/python -m pytest -o addopts='' -q
  --junitxml=/tmp/creatorjobs-3o-full-backend-20260915.xml
  => exit 0, 7,615 passed / 65 skipped / 0 failures / 0 errors / 72 warnings / 451.24s.
LAST_FULL_SUITE_OBSERVED / EXPECTED_CURRENT_COLLECTION: backend 7,680 total; parsed JUnit testcase
  count and fresh collect-only exit 0 independently agree. Delta +19 = 17 body tests +2 config cases.
FRONTEND: Node 1,297/1,297; TSC/build/Ruff exit 0; ESLint 0 errors/32 pre-existing warnings.
BROWSER: organization-resolver + qa-personas + content-security-policy real-backend matrix:
  42 passed / 0 failed / one worker / 2.7m; build included. Existing Next destination-stream-closed
  diagnostics still occur during navigation. Not fixed/suppressed and no failed assertion.
TEST CORRECTION: First focus had two failures because bare Starlette's default HTTP handler
  cannot serialize dictionary detail. Fixture now installs CreatorJobs' actual JSON HTTP handler;
  all old size assertions unchanged, plus real FastAPI regression added. No skip/assertion weakened.
ALEMBIC: single 0070_activity_page_indexes; disposable local SQLite unstamped; no migration run.
SECURITY / BLOCKERS: no task-caused failure remains. Whole-handler/DB deadlines and ingress
  slow-header/socket limits remain; no claim that a cancelled/unknown commit rolled back. No local
  PostgreSQL binaries available for next real query-timeout drill; Docker/scanners/live providers,
  managed infrastructure, legal/accessibility/staging gates remain separately external.
NEXT READY: 3P / RATE-004 PostgreSQL connect/command wait contract, then RATE-005 reconciliation.
RESUME COMMAND / FILES: top summary. git diff --check passed; frozen refs unchanged; local commit
  only, no push/deploy/hosted Neon/Vercel/Render modification. Release assessment: NO-GO.
```

## Resumed Phase 3N checkpoint (2026-09-15 — non-queuing HTTP admission)

```text
Phase: 3N / RATE-004A, a bounded subitem of RATE-004
Status: COMPLETE atomic slice; RATE-004 remains IN_PROGRESS for body/handler deadlines.
Initial HEAD: a27442ea2062e5f839e142bde567c23084b29831
Final HEAD: resolve `git log -1 --format=%H --grep='security(request): bound in-flight HTTP admission'`
Commit(s): security(request): bound in-flight HTTP admission
Files materially changed:
  backend/app/middleware/http_admission.py; backend/tests/test_http_admission.py
  backend/app/main.py; backend/app/core/{config,config_contract}.py
  backend/tests/test_config.py; backend/.env.example; backend/README.md
  docs/PRODUCTION_READINESS_EXECUTION.md; docs/PRODUCTION_READINESS_HANDOFF.md
Migrations: none; single head 0070_activity_page_indexes.
Behavior changed:
  Pure-ASGI per-worker HTTP admission rejects excess requests before parsing/auth/DB/provider
  work, with no waiting queue. Slot ownership lasts through response send and finally cleanup;
  handler cancellation, disconnect/send failure, handler errors and rejection-send failure
  cannot leak or prematurely release slots. Redis account quotas remain shared and unchanged.
  One separate bounded slot serves only exact GET /api/v1/health (uses configured API prefix).
  Readiness, feature probes, other methods, trailing slash and path-prefix tricks do not bypass
  capacity. WebSocket/lifespan scopes pass through. Existing correlation/CORS/metrics wrap 503.
  Overload is privacy-safe `server_busy`, no-store, Retry-After: 1, connection close, and explicitly
  says the request was not started. No automatic replay or blanket transaction cancellation.
Security assumptions:
  MAX_CONCURRENT_HTTP_REQUESTS is a positive, schema-bounded per-worker operator decision required
  at production boot. Unset outside production uses 100 for the existing local 100-caller harness;
  this is NOT production sizing evidence. Operator must include memory, DB pool, worker count,
  ingress and provider connection limits. One event loop owns each middleware instance; the
  check/increment has no await. This protects admitted application work, not incoming sockets,
  stalled rejected-response transports or WebSocket count; ingress defenses remain required.
  The QA audit wrapper can inspect test credentials before admission only in non-production;
  production authentication/DB work remains downstream. No production environment was changed.
Tests run / exact results:
  APP_ENV=test .venv/bin/python -m pytest -o addopts='' -q tests/test_http_admission.py
    tests/test_request_body_limit.py tests/test_config.py tests/test_config_contract.py
    tests/test_health_contracts.py tests/test_operational_metrics.py
    --junitxml=/tmp/creatorjobs-3n-admission-20260915.xml
    => 195 passed / 1 existing skip / 6 warnings / 1.81s; 15 new admission cases.
  APP_ENV=test DATABASE_URL=sqlite+aiosqlite:///./.local-data/readiness-3n-backend.db
    YOUTUBE_API_KEY= YOUTUBE_DATA_API_KEY= .venv/bin/python -m pytest -o addopts='' -q
    --junitxml=/tmp/creatorjobs-3n-full-backend-20260915.xml
    => exit 0; 7,596 PASSED / 65 SKIPPED / 0 failed / 0 errors / 72 warnings / 722.99s.
  LAST_FULL_SUITE_OBSERVED backend: 7,661 TOTAL (actual JUnit testcase count confirmed).
  EXPECTED_CURRENT_COLLECTION backend: 7,661 (fresh collect-only exit 0).
  This replaces ambiguous historical pass/total shorthand as the CURRENT full-suite evidence.
  node --test tests/*.test.mjs => 1,297 passed / 0 failed / 0 skipped / exit 0.
  npm run test:e2e:qa -- tests/e2e/qa/organization-resolver.spec.ts
    tests/e2e/qa/qa-personas.spec.ts tests/e2e/qa/content-security-policy.spec.ts --reporter=line
    => 42 passed / 0 failed / 2.5m / one worker; production build also exit 0.
  Whole-backend Ruff and git diff --check => exit 0.
  Alembic heads/current with explicit disposable local SQLite URL => single 0070 head; unstamped.
  Frontend TSC/lint unchanged from Phase 3M: exit 0 / 32 existing lint warnings; no frontend edit.
Test changes:
  Only the shared safe-production settings fixture gained its required test capacity (20).
  New tests use event-held contention (100 callers: exactly 7 admitted/93 rejected), not arbitrary
  sleeps. No existing assertion weakened, skip added, fixture generated or test removed.
Known external failures / diagnostics:
  65 existing backend skips remain; focused configuration skip concerns the documented default-on
  kill switch. Browser Next `The destination stream closed early` diagnostics occurred with all
  42 assertions passing; the same diagnostic predates this slice (Phase 13C handoff). No claim
  that the diagnostic is fixed. Logs: /tmp/creatorjobs-3n-{full-backend,qa,node}-20260915.log.
  Docker/image/Gitleaks/live provider/managed infrastructure/legal/accessibility/staging gates
  unchanged, not rerun or claimed. No paid provider call or production credential use.
Remaining risks:
  Slow-body receive deadline, DB/whole-handler deadlines with transaction semantics, ingress
  slow-client/sockets limits and actual production capacity measurement. RATE-005 existing AI
  resource implementation needs reconciliation. Deterministic product/certification rows open.
  AI import remains intact, human-reviewed and unchanged; no dependency or model change.
Next phase: 3O — bound body receive waits without blanket transaction cancellation.
Important commands/files: top resume summary; no overlapping pytest or build/browser owners.
Safety: no push/deploy/hosted Neon/Vercel/Render writes; all frozen refs unchanged. NO-GO.
```

## Resumed Phase 3M checkpoint (2026-09-15 — bounded YouTube provider)

```text
Phase: 3M / RATE-004 subitems OF-103 and OF-104
Status: COMPLETE atomic slice. RATE-004 remains IN_PROGRESS for inbound concurrency/cancellation.
Initial HEAD: 7f5d1fca960eeb251d846b4f050b4d850bca818f
Final HEAD: resolve `git log -1 --format=%H --grep='security(provider): consolidate bounded YouTube lookups'`
Commit(s): security(provider): consolidate bounded YouTube lookups
Files materially changed:
  backend/app/services/youtube_service.py; backend/app/api/deps.py
  backend/app/api/v1/routers/me.py; backend/app/schemas/{profile,__init__}.py
  backend/app/core/{config,config_contract}.py; backend/.env.example; backend/README.md
  backend/tests/test_youtube_provider_boundary.py; backend/tests/test_endpoint_rate_limits.py
  lib/{youtubeIdentity,backendClient}.ts; app/api/profile/organization-identity/route.ts
  .env.example; tests/youtubeIdentityResolver.test.mjs
  playwright.qa.config.ts; tests/e2e/qa/organization-resolver.spec.ts
  docs/{CREDENTIAL_ROTATION,PRODUCTION_READINESS_EXECUTION,
    PRODUCTION_READINESS_OUTBOUND_FETCH,PRODUCTION_READINESS_HANDOFF}.md
Migrations: none. Dependencies: none. New services: none.
Behavior changed:
  - one backend YouTube client owns the exact channels/videos URLs, secret key and optional
    owned-channel OAuth header; parsed selectors never choose a host, path or credential;
  - fresh redirect-free, environment-proxy-free HTTP requests have 2s connect/8s operation/12s
    whole-resolution deadlines and a 512 KiB decoded-response ceiling. Non-JSON, deeply nested,
    non-standard numeric JSON, oversized fields and invalid result shapes fail safely;
  - identity fields, metrics, duration and thumbnails are bounded before returning/persisting.
    Owned thumbnails honor the existing 1024-character column; normalized @ handles honor the
    100-character API limit. Valid missing thumbnails and manual portfolio entry still work;
  - malformed, partial, paginated or >50-item owned-channel snapshots fail temporarily instead
    of clearing/replacing links. Genuine empty items remain valid. Duplicate valid IDs dedupe.
    401 and explicit 403 authError/insufficientPermissions still require reauthorization;
    outage/quota/redirect/malformed replies never masquerade as revoked consent;
  - `/me/youtube-identity` requires normal durable authentication and the shared 30/10m/user
    outbound quota. The Next same-origin session boundary proxies the CreatorJobs bearer only;
    it contains no YouTube provider credential or Data API fetch and preserves URL fallback;
  - backend-only YOUTUBE_API_KEY/YOUTUBE_DATA_API_KEY now use SecretStr with one stripped-key
    precedence rule. QA blanks both keys so its YouTube fallback cannot consume a live key.
Security assumptions:
  Fixed HTTPS Google endpoints rely on normal platform TLS/DNS trust, not arbitrary-user-URL
  fetching. User-selected page reads still use the existing SafeOutboundFetcher. Deployment
  operators must relocate any frontend YouTube key to backend configuration and restrict its
  API/quota in Google Cloud; no real configuration or key was touched. Existing log formatter
  discards HTTP log interpolation args and redacts URLs. No new credential exposure.
Tests run and exact results (all exit 0):
  APP_ENV=test YOUTUBE_API_KEY= YOUTUBE_DATA_API_KEY= .venv/bin/python -m pytest
    -o addopts='' -q tests/test_youtube_provider_boundary.py tests/test_google_oauth_refresh.py
    tests/test_auth_and_channels.py tests/test_endpoint_rate_limits.py
    tests/test_google_oauth_scope_disconnect.py
    --junitxml=/tmp/creatorjobs-3m-provider-20260915.xml
    => 104 passed / 0 skipped / 5 warnings / 7.53s (43 provider-boundary cases)
  APP_ENV=test .venv/bin/python -m pytest -o addopts='' -q tests/test_config.py
    tests/test_config_contract.py tests/test_link_preview.py tests/test_portfolio_proof_cards.py
    tests/test_creator_profile_phase1.py tests/test_oauth_credentials.py
    --junitxml=/tmp/creatorjobs-3m-compat-20260915.xml
    => 169 passed / 1 existing skip / 4 warnings / 13.31s
  APP_ENV=test .venv/bin/python -m pytest -o addopts='' -q tests/test_auth_sessions.py
    --junitxml=/tmp/creatorjobs-3m-sessions-20260915.xml
    => 16 passed / 4 warnings / 24.64s. Prior host-load import timeout no longer reproduces.
  node --test tests/youtubeIdentityResolver.test.mjs => 11/11
  node --test tests/*.test.mjs => 1297 passed / 0 failed / 0 skipped
  npx tsc --noEmit => exit 0
  npm run lint => exit 0, 0 errors / 32 pre-existing warnings
  backend/.venv/bin/ruff check backend (run as `.venv/bin/ruff check .` inside backend) => clean
  npm run test:e2e:qa -- tests/e2e/qa/organization-resolver.spec.ts --reporter=line
    => production build exit 0; 7/7 real-backend browser tests / 24.4s / one worker
  Alembic heads/current with explicit disposable SQLite URL => one head 0070_activity_page_indexes;
    current is unstamped. No hosted DB, migration or PostgreSQL container touched.
  git diff --check => exit 0
Collection reconciliation:
  EXPECTED_CURRENT_COLLECTION backend: 7645 (pytest --collect-only -o addopts='' -q, exit 0).
  LAST_FULL_SUITE_OBSERVED frontend: 1297 passed in this slice.
  LAST_FULL_SUITE_OBSERVED backend: no fresh full run in this slice. Earlier Phase 10 JUnit note
    says 7499 TOTAL / 65 skipped, whereas RATE-001 later says 7499 PASSED / 65 skipped. The old
    XML is not retained here, so these are historical reports, not interchangeable/current
    certifications. Do not infer either a fresh total or pass count from console dots. Next
    full certification must retain and parse JUnit and reconcile against current collection.
Test contract corrections:
  The previous in-progress provider test tolerated malformed/truncated owned lists; this was
    incorrect because consumers replace linked authority. It now requires a temporary error.
  The frontend unit test no longer mocks its own Google fetch because that transport moved to
    backend tests. Structural TS checks print the AST without comments; backend transport options
    are behaviorally captured. A formerly invalid six-character video fixture is now a valid
    eleven-character ID; production accepts only valid ID syntax.
Known external failures:
  No paid/credentialed Google/AI request made. Existing Instagram browser cases may attempt
  unauthenticated public metadata enrichment; their assertions use URL-derived fallback.
  Docker/Gitleaks/image scans not retried; managed infrastructure, provider key restrictions,
  DNS, legal approval, authenticator device/accessibility review and staging soak remain external.
Remaining risks:
  RATE-004 inbound concurrency/cancellation; RATE-005 AI resource guard reconciliation; open
  deterministic correctness/trust/product and certification items. AI import remains intact,
  queue-backed and human-reviewed; this slice does not enable/disable it or alter its budget.
Next phase: 3N — read existing middleware/ASGI/DB transaction contracts before a bounded slice.
Important commands: top resume summary; never overlap pytest/build/browser owners.
Repository safety: local commit only; all five frozen refs unchanged; no push, deployment,
  hosted Neon, Vercel or Render modification. Release assessment remains NO-GO.
```

## Resumed Phase 3L checkpoint (OF-105 — authenticated bounded Google Places)

```text
Phase: 3L — Google Places provider boundary and final endpoint quota coverage
Status: COMPLETE atomic slice; RATE-003 VALIDATED. RATE-004 remains IN_PROGRESS for
  OF-103/OF-104 and general concurrency/cancellation safeguards.
Initial HEAD: 898d0effefa2c8c0569eefc67f62122df2543f15
Final HEAD: resolve `git rev-parse HEAD`; this handoff is committed with the implementation
Commit(s): `security(provider): bound authenticated Google Places lookup`
Files materially changed:
  backend/app/services/google_places_service.py
  backend/app/api/v1/routers/locations.py; backend/app/schemas/location.py
  backend/app/api/deps.py; backend/app/api/v1/api.py
  backend/app/core/{config,config_contract,rate_limit}.py; backend/.env.example
  backend/tests/test_google_places_service.py; backend/tests/test_endpoint_rate_limits.py
  app/api/location/{autocomplete,details}/route.ts
  components/you/LocationAutocompleteField.tsx
  lib/backendClient.ts; lib/locationTypes.ts; .env.example
  tests/locationProviderBoundary.test.mjs
  docs/PRODUCTION_READINESS_EXECUTION.md
  docs/PRODUCTION_READINESS_OUTBOUND_FETCH.md
  docs/CREDENTIAL_ROTATION.md; docs/PRODUCTION_READINESS_HANDOFF.md
Migrations: none. Alembic remains one head at 0070_activity_page_indexes; configured local
  SQLite remains unversioned. No model, table, persisted field or migration consumer changed.
Behavior changed:
  - location autocomplete and non-local place verification now require a same-origin signed-in
    NextAuth session and a valid backend durable bearer session. Anonymous and cross-site callers
    cannot consume either provider work or the local fallback through these routes;
  - the two Next routes no longer know the Google URL or key and no longer parse provider JSON.
    They proxy small typed responses from authenticated backend `/me/location/*` routes;
  - the optional key moved from the frontend environment template to backend `SecretStr`
    configuration. An absent key fails provider work closed with a machine code; autocomplete then
    uses the existing owned local catalogue, while unknown non-local details remain invalid;
  - both provider operations share one `LOCATION_LOOKUP_LIMIT` allowance of 120/minute per
    independently verified user through the existing Redis-atomic/fail-closed limiter. A bounded
    positive numeric backend `Retry-After` is retained by `BackendRequestError` and the proxy;
  - provider results are at most six normalized city suggestions. Google-backed suggestions carry
    `google_maps` source metadata and the dropdown shows exact, non-translated `Google Maps`
    attribution in the same visual container. Local suggestions are never attributed to Google.
Security assumptions:
  `GooglePlacesService` accepts a user query/place ID only as encoded parameters to two exact HTTPS
  constants. It refuses redirects, environment proxies and cookies; uses a two-second connect,
  four-second HTTP operation and six-second whole-attempt deadline; accepts HTTP 200 JSON only;
  streams decoded bytes under 128 KiB; bounds provider list traversal, every string, coordinates
  and output cardinality; and never includes key, provider URL, payload or provider error text in
  returned/loggable errors. Cancellation still propagates. Google DNS/TLS trust remains the normal
  public PKI/provider assumption. The optional production key must remain unset until the external
  provider restriction, billing, policy and live-attribution gates are complete.
Tests run:
  cd backend && APP_ENV=test .venv/bin/python -m pytest -q \
    tests/test_google_places_service.py tests/test_endpoint_rate_limits.py
  cd backend && APP_ENV=test .venv/bin/python -m pytest -q \
    tests/test_config.py tests/test_config_contract.py tests/test_auth_sessions.py \
    tests/test_profile_features.py tests/test_creator_profile_phase1.py
  cd backend && .venv/bin/ruff check <changed Python files>
  node --test tests/locationProviderBoundary.test.mjs
  node --test tests/*.test.mjs
  npx tsc --noEmit
  npm run lint
  npm run build
  /usr/bin/time -p env APP_ENV=test .venv/bin/python -c \
    'from app.repositories.auth_repository import AuthRepository; from app.services.auth_service import AuthService'
  git diff --check
Exact results:
  Places provider/auth/quota/backend focus             37 passed / exit 0
  final location frontend boundary                     5 passed / exit 0
  complete current frontend Node                 1,297 passed / exit 0
  TypeScript                                            0 errors / exit 0
  ESLint                                                0 errors / 32 existing warnings / exit 0
  production build                                      compiled, typed, 32 static pages / exit 0
  complete backend Ruff                                all checks passed / exit 0
  final targeted location ESLint                       no findings / exit 0
  compatibility matrix                                152 passed / 1 skipped /
                                                       1 environmental timeout / exit 1
  direct isolated import after timeout                  exit 0; real 24.63s,
                                                       user 1.61s, sys 1.70s
  git diff check                                       exit 0 at final commit gate
Known external/environmental failures:
  `test_auth_repository_is_importable_before_the_services_package` has an unchanged hard ten-second
  child deadline. With load about 69 it timed out in both the compatibility matrix and isolated
  rerun. The same import completed successfully without the artificial deadline and spent only
  3.31 CPU seconds across 24.63 wall seconds. This slice does not touch either imported module or
  package initialization, and no test was weakened. Playwright was not started under this load.
  Google console key restriction, API enablement, billing quota, provider-policy review and a live
  lookup/attribution/outage drill remain external. No hosted provider was contacted.
Remaining risks:
  OF-103 backend YouTube and OF-104 Next YouTube fixed-provider response/redirect/whole-attempt
  boundaries remain. RATE-004 also retains general request concurrency/cancellation safeguards;
  RATE-005 AI resource guards is NOT_STARTED. The many later product/infrastructure audit rows remain
  authoritative in the execution ledger, so release assessment remains NO-GO.
Next phase:
  Phase 3M / RATE-004. Inventory OF-103 and OF-104 together and preserve current OAuth
  reauthentication semantics. Stop before implementation if both callers cannot be completed and
  validated as one coherent fixed-provider boundary.
Important commands:
  git status --short && git branch --show-current && git rev-parse HEAD && uptime
  rg -n 'youtube.googleapis.com|googleapis.com/youtube|YOUTUBE_(DATA_)?API_KEY|fetch_user_youtube' \
    app backend lib tests
  cd backend && APP_ENV=test .venv/bin/python -m pytest -q \
    tests/test_google_places_service.py tests/test_endpoint_rate_limits.py
  node --test tests/locationProviderBoundary.test.mjs
```

## WEB-008B CSP origin inventory (gathered Phase 2I, spent in Phase 2J)

The inventory below is what the shipped policy was built from. Two entries were
corrected by inspection when the policy was written: there is no `<iframe>`
anywhere in the tree, so `frame-src` is `'none'` rather than a provider list —
portfolio video is linked and thumbnailed, and the oEmbed `embed_html` a
provider returns is stored but never rendered; and `data:`/`blob:` in `img-src`
are both genuinely required, the first by a `url("data:…")` in the built CSS and
the second by `URL.createObjectURL` upload previews in `components/you/YouHubClient.tsx`.

```text
connect-src   'self' + the configured backend origin from NEXT_PUBLIC_BACKEND_URL,
              plus its ws:/wss: form — lib/realtimeMessaging.ts derives the socket
              URL from getBackendApiBaseUrl() and swaps the scheme. Parse and
              normalize that origin; never interpolate the raw env value into the
              header (tests/securityHeaders.test.mjs enforces this).
frame-src     https://www.youtube.com https://www.youtube-nocookie.com
              https://player.vimeo.com — portfolio/work embeds.
img-src       'self' data: blob: plus remote portfolio media. Creators link work
              anywhere, so a narrow host list is not practical here; decide
              deliberately between `https:` for images only (documented) and a
              proxying approach, and do not let that decision leak into other
              directives.
script-src    The open question. Next App Router inline bootstrap plus the theme
              bootstrap in app/layout.tsx. Nonce via middleware is the correct
              answer if hydration survives it.
style-src     Tailwind ships a stylesheet, but inline styles are used; expect to
              need 'unsafe-inline' for styles and document it.
font-src      'self' — no external font host is referenced anywhere in the tree.
default-src   'self'; object-src 'none'; base-uri 'self'; form-action 'self'.
Not needed    No fonts.googleapis.com, no gstatic, no analytics script. Google
              Places and YouTube Data API are called server-side only, so they do
              not belong in connect-src.
```

## Phase 5I checkpoint (EMAIL-004 — bounces, complaints, and a webhook that cannot be forged)

```text
Commit: "feat(email): stop mailing an address that told us to stop"
Migration: 0062_email_suppressions, parents 0061_beta_invitations, single head. New table only.
        Offline SQL render verified; no PostgreSQL harness in this environment (Docker absent).

THE RULE THAT MATTERS is the asymmetry, and collapsing it is expensive in BOTH directions:
  hard bounce  = a fact about the mailbox. It does not exist. Suppress EVERYTHING, auth included:
                 a reset link to a mailbox that rejects it helps nobody and costs the sending
                 domain its reputation.
  complaint    = a judgement about mail WE chose to send. The person is still there. Suppress
                 everything EXCEPT authentication mail — otherwise reporting one job alert locks
                 someone out of their own account forever.
  soft bounce  = transient. Not a suppression at all; the outbox retry schedule already covers it.
  unknown      = recorded, acts on nothing. Silently dropping mail for a category nobody ruled on
                 is worse than sending it.
This is what AUTH_EVENT_KEYS in notifications/email.py is for; it was added in EMAIL-002 with
exactly this in mind.

WHERE THE CHECK LIVES: in the worker, immediately before the provider is asked — NOT at enqueue.
An address can be suppressed after its mail is queued, and that queued mail is precisely what
must not go out. A suppressed row becomes `skipped`.

THE WEBHOOK IS THE ATTACK SURFACE. It cannot be authenticated the ordinary way (a provider holds
no session), so the signature is the entire gate. Unsigned, this endpoint lets any stranger post
a fabricated hard bounce for any address and silently stop that person's mail, including password
resets — a denial of service against one account at a time that leaves nothing resembling an
attack in the logs. Three properties, each closing a specific hole:
  - HMAC-SHA256 over `timestamp.body`, so the CLAIM is signed, not merely the request;
  - the timestamp is INSIDE the signed material and checked against a 300s window, so a captured
    request is not a lasting credential (a header-only timestamp could be swapped for a fresh one);
  - hmac.compare_digest, because a byte-by-byte comparison leaks how much of a guess was right.
An unset EMAIL_WEBHOOK_SECRET REFUSES every request. "No secret configured, so accept everything"
turns a missing environment variable into an open door, in exactly the deployment nobody watches.

DELIBERATELY PROVIDER-NEUTRAL: no provider has been chosen (EMAIL-005 is BLOCKED_EXTERNAL on the
sending domain), so writing a specific vendor's header scheme now would mean implementing a
verifier for something this codebase has never seen. Mapping a real provider onto this is a small
adapter; the properties above are the part worth getting right first.

Idempotent by construction: providers redeliver webhooks as a matter of contract, so recording is
INSERT ... ON CONFLICT DO NOTHING. A second delivery neither raises on the unique index nor
overwrites the original reason with a later, vaguer one.

Releasing sets released_at rather than deleting: "this address bounced in March" is the context
for April's support conversation, and a deleted row cannot explain why mail stopped.

Tests: tests/test_email_suppression.py, 30 cases. Non-vacuity PROVEN by mutation: neutering the
signature check and the worker's suppression check fails 6 tests, including every forgery case.

BUG FOUND AND FIXED DURING THIS SLICE, worth remembering: the router first imported
`get_db_session` from app.db.session instead of `get_db` from app.api.deps. conftest overrides
ONLY the deps one, so the endpoint ran against the real configured engine and wrote a row into
the local dev.db while the test saw nothing. Symptom: a 200 response with the assertion failing.
The stray dev row was removed. Always take get_db from app.api.deps.

Test note: the endpoint commits on its own session, so a test holding db_session sees a snapshot
from before the request. Read committed rows through a fresh TestSessionLocal session.

NOT DONE HERE: EMAIL-002's removed 503 owed some failure visibility, and a misconfigured provider
is still only visible in worker logs and in rows that reach MAX_ATTEMPTS. An operator view of
failed/suppressed rows belongs with the admin panel work, not in the delivery path.
```

## Phase 5H checkpoint (EMAIL-003 — event email, and the second delivery path is gone)

```text
Commit: "refactor(email): leave one way for an email to be delivered"
Status: COMPLETE. No migration, no new producer.

Most of EMAIL-003 was already true and the ledger row was stale: app/notifications/service.py
already enqueued inside the caller's transaction, and EMAIL-001's worker plus EMAIL-002's runner
gave those rows a way out. What was actually wrong was that TWO delivery paths existed.

REMOVED: notifications/email.py::_process_outbox_row. It marked rows "mocked" — a status the
worker never produces and that eligible_predicate does not know — so a row processed by the old
path landed in a state the rest of the system could not reason about. Its only caller was a test.
One vocabulary now: queued -> sent | failed | skipped. The model comment, the dev-outbox route
docstring and the module docstring said otherwise and were corrected rather than left to mislead.

TEST TRAP, and it cost a wrong-looking pass: SmtpEmailProvider does
`from app.services.email_service import send_auth_email` AT IMPORT TIME. Patching
`email_service.send_auth_email` therefore does NOT affect it — the real sender stays in place and
a test that expected a failure quietly passes on a successful send. Patch
`app.notifications.provider.send_auth_email`. Two existing tests were patching the wrong module.

SECOND TRAP: process_outbox_once claims table-wide, so in a file where earlier tests queue mail,
the batch fills with their rows and the row under test is never attempted. Delete the others
first (see test_external_delivery_failure_after_commit_does_not_rollback_hire) — this is the same
lesson as Phase 5C-fix, in a different disguise.

Rewritten rather than deleted: test_external_delivery_failure_after_commit_does_not_rollback_hire
now drives the real worker. Its old assertion was status == "failed" on the first outage, which
is the wrong contract — a transient outage is retried, so the row is queued with attempts == 1
and a next_attempt_at. The hire standing regardless is still the point of the test.

NEXT: EMAIL-004 (bounce/suppression) — it also owes the failure visibility that EMAIL-002's
removed 503 used to provide, since a misconfigured provider is now only visible in worker logs
and in rows that reach MAX_ATTEMPTS.
```

## Phase 5G checkpoint (EMAIL-002 — auth email goes through the outbox, and something drains it)

```text
Status: COMPLETE for verification and password reset. The invitation email itself is NOT written
        yet: nothing issues invitations over HTTP, so there is no place to send it from. The
        event key `auth.invitation` is reserved for whatever admin path issues them.
Migration: NONE. Reuses the email_outbox table and the 0060 lease columns.

WHAT CHANGED, and why it is not just plumbing:
  Auth email used to be sent inline, AFTER the transaction committed:
      create token -> commit -> send_auth_email()   <- a network call, in the request
  Two failures follow and neither shows up in a happy-path test.
    1. a crash between the commit and the send loses an email nobody knows is owed. The account
       exists and nothing will ever tell its owner how to verify it.
    2. a provider outage raises inside the request, so a signup that fully succeeded reports
       failure to the person who made it. Reset was worse: the person is locked out and waiting.
  Now:
      create token -> queue_auth_email() -> commit    (worker delivers, on its own schedule)
  The enqueue is INSIDE the transaction, so the promise to email lands with the thing it is
  about, or not at all. auth_service.log_* were renamed emit_* because they no longer log — they
  queue. Local link capture and the returned verification_url are unchanged.

REMOVED (deliberately, not overlooked): the three `except EmailDeliveryError -> 503` handlers in
  routers/auth.py. Nothing in those paths can raise it any more, and a handler for a failure that
  cannot happen implies a failure mode that does not exist. The old test asserting 503 on SMTP
  failure was REWRITTEN, not deleted — it now asserts the better contract: the request succeeds,
  the row is queued, and the link is in the row. Losing the immediate 503 does mean a
  misconfigured SMTP is quieter; EMAIL-004 owns making failed rows visible.

THE QUEUE NOW DRAINS. app/notifications/runner.py:
  run_worker_forever(session_factory, provider=, interval_seconds=, stop=asyncio.Event)
    - a FRESH session per pass; a long-lived one holds a transaction open across the sleep and
      turns an idle worker into a lock holder
    - a pass that raises is logged and the loop continues; the claimed rows are unharmed because
      an unfinished lease lapses on its own
    - the interval is `wait_for(stop.wait(), timeout=)`, NOT `sleep()`, so shutdown costs the
      pass in flight rather than a full interval
    - build_provider() returns the mock unless real_delivery_enabled(); an incompletely
      configured deployment records mail rather than half-sending it
  Two ways to run it:
    python -m app.notifications.runner            (preferred in production: its own lifetime)
    EMAIL_WORKER_IN_PROCESS=true                  (local convenience; app/main.py startup)
  In-process is OFF by default. A worker sharing a lifetime with the web server shares its
  restarts and deploys.

Tests: tests/test_auth_email_durability.py (8) + tests/test_email_worker_runner.py (8).
Non-vacuity PROVEN by mutation, twice:
  - restore an inline send inside queue_auth_email -> both TestNoProviderIsContactedDuringARequest
    tests fail. The counting test exists because "the request succeeded" would still pass if the
    send happened inline and worked.
  - drop the runner's try/except and use sleep() instead of the event wait -> the raising-pass
    test and the shutdown-latency test both fail.

NEXT (EMAIL-003): route event email (application, hiring, safety) through the same queue, then
  EMAIL-004 for bounce/suppression and the visibility that the removed 503 used to provide.
```

## Phase 5F checkpoint (INVITE-002 — the gate is wired into both signup paths)

```text
Commit: "feat(invites): check the invitation at both signup doors"
Status: COMPLETE. Registration is refused server-side when the beta gate is on and no valid
        invitation is presented. No migration; behaviour is off by default.
Setting: settings.invite_only_beta (env INVITE_ONLY_BETA), DEFAULT FALSE. Off = today's behaviour
        exactly, which is why every existing environment is unaffected by deploying this.
        NOTE: backend/.env.example could not be updated — that path is denied to tooling
        (BLOCKED_ENVIRONMENT, already recorded). config.py carries the documentation instead.

One gate, called twice:
  require_invitation_for_signup(session, email=, token=) in beta_invitation_service.py
    - returns None when the flag is off (the ONLY case where a missing token is acceptable)
    - raises InvitationError otherwise, reusing invitation_problem() so the wording, and the
      refusal to distinguish "wrong address" from "unknown token", are identical to redemption.
  Call sites, both BEFORE create_user so no account exists when the answer is no:
    - app/services/auth_service.py register_user()                  (password signup)
    - app/services/auth_service.py _exchange_verified_google_oauth() (Google signup)
  Redemption happens in the SAME transaction as user creation, so a crash cannot leave an
  invitation burned with no account, or an account created from an unburned invitation.

Schema/route: invitation_token (str|None, max_length=512) added to RegisterRequest and
  OAuthGoogleExchangeRequest; router maps InvitationError -> HTTP 403.

Two copies of an access rule drift and the weaker one becomes the way in. That is why this is a
single function rather than a check written at each call site.

ALSO IN THIS SLICE — single use is now enforced by the WRITE, not by a read:
  redeem_invitation() previously read "not yet redeemed" and then wrote, which is check-then-act:
  two requests carrying the same token can both pass the read before either writes. That is the
  same defect class as the outbox claim (see Phase 5B) and it was closed the same way —
    UPDATE beta_invitations SET redeemed_at=, redeemed_user_id=
     WHERE id= AND redeemed_at IS NULL AND revoked_at IS NULL RETURNING id
  No row back means someone else won, and the caller gets "already been used". The ORM copy is
  refreshed afterwards because synchronize_session=False leaves it stale and the caller is handed
  that object (the same trap that made the outbox retry counter read 0 forever).
  Address binding already limited the practical exposure — an invitation is valid for one address,
  and users.email is unique — but "another constraint happens to cover it" is not single use.
  test_a_redemption_that_races_another_one_loses reproduces the interleaving by redeeming the row
  out of band while a stale in-memory snapshot is held. Proven non-vacuous by mutation: restore
  the read-then-write and the second redemption SUCCEEDS (pytest.raises reports DID NOT RAISE).

Backend suite after this slice: 6,856 passed / 64 skipped / 0 failed, uncontended (was 6,845/64).
Tests: tests/test_beta_invitations.py, 30 cases. TestRegistrationIsActuallyGated drives the real
  route through the client fixture — a gate that exists but is not called is the usual way
  "invite-only" turns out to be open.
Non-vacuity PROVEN by mutation: replacing both require_invitation_for_signup calls with a stub
  returning None makes the uninvited signup return 200 and fails
  test_registration_is_refused_without_an_invitation. Restored; 3/3 pass.

Two test traps paid for here:
  - the API validates with EmailStr, which REFUSES reserved TLDs. `@example.test` (fine in the
    service tests) is a 422 at the route. API-level tests use @example.com + a uuid suffix,
    because users persist between runs and a fixed address hits a UNIQUE constraint.
  - the autouse _isolate fixture must COMMIT its cleanup, not flush. A flush holds the write
    transaction open, SQLite allows one writer, and the API's own connection then fails with
    "database is locked" — which looks nothing like an invitation problem.

NEXT (EMAIL-002): route auth email (invite, verification, reset) through the outbox instead of
  the direct emitter, so delivery survives a crash. The invitation email is the first real sender.
```

## Phase 5E checkpoint (INVITE-001A — invitation model, migration, service)

```text
Status: COMPLETE for issue/redeem/revoke mechanics. Registration ENFORCEMENT (INVITE-002) is next.
Commit: "feat(invites): bind an invitation to one address and one use"
Migration: 0061_beta_invitations, parents 0060_email_outbox_lease, single head. New table only.
New: backend/app/models/beta_invitation.py, backend/app/services/beta_invitation_service.py
     issue_invitation -> IssuedInvitation(invitation, token)  [token returned ONCE, never stored]
     find_by_token / invitation_problem(pure) / redeem_invitation / revoke_invitation
Tests: 19 cases. Ruff clean on changed files.

Security decisions, each aimed at a specific bypass:
  - token stored as SHA-256 only; the raw value exists in the email and nowhere else, so a backup,
    log or admin screen cannot leak a working credential. Nothing here can recover a token.
  - invitation is BOUND to an email; a forwarded code is refused. Addresses compared casefolded
    and trimmed so the same mailbox in different casing still works.
  - "wrong address" returns the SAME message as "unknown token" — distinguishing them confirms the
    code is real and hands over half the answer. A test asserts the two messages are identical.
  - single use recorded via redeemed_at/redeemed_user_id, so a replay is refused by stored fact.
  - expiry required; revocation keeps a reason for audit; revoking an ALREADY-REDEEMED invitation
    is a deliberate no-op (it would imply un-creating the account, which this does not do).
  - email indexed but NOT unique: re-inviting after expiry is ordinary, and uniqueness would force
    deleting the audit trail or refusing a legitimate second invitation.

Test note: redeemed_user_id is a real FK, so redemption tests need an actual User row — an invented
uuid4 raises IntegrityError. That is the constraint doing its job; there is a `redeemer` fixture.

NEXT (INVITE-002): enforce at registration. Both paths must check server-side — password signup in
backend/app/api/v1/routers/auth.py register(), and the Google path. A UI-only gate is not a gate.
```

## Phase 5D checkpoint (EMAIL-001E/F — provider seam and the worker)

```text
Status: COMPLETE. Commit: "feat(email): actually deliver what the outbox promised"
New: backend/app/notifications/provider.py — EmailProvider protocol, ProviderOutcome
     (SENT/RETRYABLE/TERMINAL/SUPPRESSED), ProviderResult, MockEmailProvider, SmtpEmailProvider.
     backend/app/notifications/worker.py — process_outbox_once(session, *, provider, worker_id,
     limit, now) -> DeliveryRun. One pass, no internal loop or sleep: the caller owns scheduling
     and the retry schedule lives on the row.
Tests: 15 worker cases; 100 including claim/delivery/migration/notifications/interaction-transitions.

FINDING: there was NO production consumer of the outbox at all. `_process_outbox_row` had exactly
one caller — a test. Every notification email was being recorded as intended and never sent. Safe
(better than sending twice) but the queue never drained. The worker closes that.
`queue_notification_email` already writes inside the caller's transaction, so the enqueue half of
EMAIL-001F was already correct; `app/notifications/service.py` is the single enqueue site.

Design notes worth keeping:
  - MockEmailProvider returns SENT, not a separate "mocked" outcome, so dev and production exercise
    one success path. Mock-vs-real belongs in config and logs, not in the state machine.
  - SmtpEmailProvider classifies EmailDeliveryError as RETRYABLE: send_auth_email raises one type
    for everything, and guessing "terminal" on a transient outage silently drops mail, whereas
    retrying is bounded by MAX_ATTEMPTS and then reported.
  - A provider that RAISES is treated as a retryable failure. Letting it escape would leave the row
    leased until expiry with no recorded reason.

NEXT: EMAIL-002/003 (auth + event email through the outbox), EMAIL-004 (bounce/suppression state,
needs provider_message_id which 0060 added), INVITE-001/002. EMAIL-005 stays BLOCKED_EXTERNAL.
```

## Phase 5C-fix (outbox test isolation) — read this before writing more outbox tests

```text
Commit: "test(email): give the outbox suites their own empty table"
The broad checkpoint after three green focused runs produced 21 failures, all in the new outbox
suites, all passing in isolation. Cause was scope, not product: `claim_due_emails` asks the WHOLE
table what is due — right for a worker, wrong for an assertion. `assert claim_due_emails(...) == []`
actually means "nothing anywhere in the database is claimable", so any outbox row another test left
behind broke it.
Fixed with an autouse fixture in both modules that deletes EmailOutbox rows before each test —
real isolation rather than looser assertions.
Full backend after the fix: 6,811 passed / 64 skipped / 0 failed.
Lesson for the next outbox test: assert about the row under test, or empty the table first. Never
assert about the global claim result.
```

## Phase 5C checkpoint (EMAIL-001C/D — attempts, retry, terminal states)

```text
Status: COMPLETE. Commit: "feat(email): bound the retries and separate the failures"
New: backend/app/repositories/email_outbox_delivery.py
     mark_sent / mark_retryable_failure / mark_terminal_failure / mark_suppressed,
     retry_delay_seconds(attempts) pure function.
     MAX_ATTEMPTS=5, BASE_RETRY_SECONDS=60, MAX_RETRY_SECONDS=3600, deterministic (no jitter —
     untestable jitter is not worth it at this size; inject a source if contention ever needs it).
State model: queued (claimable) -> sent | failed | skipped. Retry returns to `queued` with a future
next_attempt_at rather than adding a "retrying" state that could disagree with the timestamp.
Suppressed is separate from failed and consumes NO attempt — withheld on purpose vs attempted and
rejected read differently to an operator.
Tests: 21 cases; 52 across the three outbox suites. Ruff clean.

REAL DEFECT FOUND BY THE LOOP TEST, worth remembering: mark_retryable_failure originally took the
ORM row and read `row.attempts`. Every write here uses synchronize_session=False, so an instance
the caller holds — including one from the claim's RETURNING — keeps its loaded value. A worker
looping would have read a stale 0 forever, never reached MAX_ATTEMPTS, and the retry bound would
not have existed despite every individual test passing. Now takes an id and re-reads.
Re-reading is safe there and NOT safe in claim_due_emails: the caller already holds the lease, so
exclusivity is established. The claim has no such guarantee and must stay one statement.

NEXT: EMAIL-001E/F — provider abstraction (send -> message id | classified error) and moving
`_process_outbox_row` in backend/app/notifications/email.py onto claim + delivery. Note that
queue_notification_email already writes inside the caller's transaction, so the enqueue half of
EMAIL-001F is already satisfied.
```

## Phase 5B checkpoint (EMAIL-001B — atomic claim primitive)

```text
Status: COMPLETE. Commit: "feat(email): claim outbox rows in one statement, not two"
New: backend/app/repositories/email_outbox_repository.py
     claim_due_emails(session, *, worker_id, limit, lease_seconds, now) -> list[EmailOutbox]
     release_lease(session, row_id); eligible_predicate(now) exposed for testing.
Claim is ONE `UPDATE ... WHERE id IN (SELECT ... LIMIT) RETURNING`, with
`.with_for_update(skip_locked=True)` added on PostgreSQL only. Eligibility re-stated on the UPDATE
as well as the subquery, so the claim stays correct on engines without row locking.
Eligibility: status='queued' AND (next_attempt_at IS NULL OR <= now) AND (leased_until IS NULL OR <= now).
`now` is injected everywhere — no test sleeps to watch a lease expire.
Tests: 20 cases; 31 with the migration suite. Ruff clean.

NON-VACUITY, and the reason the structural test exists: mutating the claim into a
read-then-decide-then-write form left ALL 19 behavioural tests passing and was caught only by
`TestTheClaimIsOneStatement`. SQLite serialises writes, so check-then-act is behaviourally
invisible locally — the shape assertion is the only local defence against the RATE-001 defect
being reintroduced here.

STILL BLOCKED_ENVIRONMENT: true concurrent-claim proof needs PostgreSQL SKIP LOCKED. No local
postgres binaries, Docker denied. The SQL contract and predicate are tested; two real workers
racing are not.

NEXT: EMAIL-001C/D — attempt accounting and bounded retry/backoff (mark_sent, mark_failed with
retryable vs terminal classification, next_attempt_at scheduling). Then the provider abstraction,
then migrating `_process_outbox_row` in backend/app/notifications/email.py onto the worker path.
```

## Phase 5A checkpoint (EMAIL-001A — expand-only outbox lease schema)

```text
Status: COMPLETE. Commit: "feat(email): give the outbox the state a durable worker needs"
HEAD before: e4bccb9b6844f315118c34480b7e840ff26f78a0
Migration: 0060_email_outbox_lease, parents 0059_oauth_connection_events, single head preserved.
Adds: leased_by, leased_until, attempts (NOT NULL server_default 0), next_attempt_at,
      provider_message_id; indexes ix_email_outbox_claimable (status, next_attempt_at) and
      ix_email_outbox_leased_until.
Expand-only: every column nullable or defaulted, no status touched, no data statements — schema
and worker can deploy in either order.
Files: backend/alembic/versions/0060_email_outbox_lease.py, backend/app/models/email_outbox.py,
       backend/tests/test_email_outbox_lease_migration.py (11 cases)
Tests: 11 focused; complete backend 6,770 passed / 64 skipped / 0 failed (was 6,759 + 11); Ruff clean.

MIGRATION EXECUTION IS BLOCKED_ENVIRONMENT — do not mistake this for validated.
  No local postgres/psql/initdb binaries, Docker denied, and the chain contains a JSONB column
  SQLite cannot compile (`jobs.platforms`), so `alembic upgrade head` cannot run locally at all.
  Upgrade/downgrade/re-upgrade and SKIP LOCKED semantics all need disposable PostgreSQL.

WHY THE PARITY TEST IS SHAPED THE WAY IT IS: tests build schema with create_all, so a column added
to the model and forgotten in a migration passes all 6,770 tests and is absent in production.
There is no other local signal, because migrations cannot execute. The test therefore compares the
model's FULL column set against PRE_LEASE_COLUMNS plus what 0060 adds. A first version compared a
hardcoded list to itself and passed a deliberately injected model-only column — verified by
mutation, rewritten, and re-verified failing with `assert not {'drift_probe'}`.
```

## Phase 5 gap analysis — EMAIL-001 durable outbox (research done, start here)

Do not begin by designing an outbox. One already exists and is wired in; the gap is narrower
than the ledger row implies.

```text
EXISTS: backend/app/models/email_outbox.py (EmailOutbox)
  id, user_id, to_email, event_key, template_key, subject, preview, body, cta_url,
  metadata_json, dedupe_key (UNIQUE -> idempotency already covered),
  status (queued|mocked|sent|failed|skipped), error, created_at, processed_at
  Consumers: app/db/qa_scenarios.py, app/api/v1/routers/dev_emails.py, app/api/v1/routers/admin.py
  Auth emails deliberately bypass it and use email_service.send_auth_email.

MISSING for EMAIL-001 ("lease, concurrent claim, retry, crash recovery, idempotency"):
  - lease:   leased_until (timestamptz, nullable, indexed), leased_by (worker identity)
  - retry:   attempts (int, default 0), next_attempt_at (timestamptz, indexed)
  - provider: provider_message_id — needed later by EMAIL-004 to correlate bounces
  - the atomic claim itself: SELECT ... FOR UPDATE SKIP LOCKED, or an UPDATE ... RETURNING
    guarded on (status='queued' AND next_attempt_at <= now() AND (leased_until IS NULL OR
    leased_until < now())). A read-then-write claim has the same defect RATE-001 is blocked on.
```

**Next slice is a migration**, so: `alembic heads` is `0059_oauth_connection_events` (single head)
and the new revision parents it. Expand-only — add nullable columns with server defaults, leave
`status` alone, and do not touch the three existing consumers in the same slice. The atomic claim
and its concurrency tests are the slice after, and those want the disposable PostgreSQL harness
(`backend/scripts/test_interaction_status_postgres.sh`) because SQLite will not exercise
`SKIP LOCKED`.

EMAIL-005 (SPF/DKIM/DMARC, real provider) stays BLOCKED_EXTERNAL and must not gate any of this.

## Phase 6H checkpoint (AI-002 proof + AI-003 quota; AI-004 partly blocked on a product decision)

```text
COMMITS: "test(import): prove a repeat never buys a second draft" (8e27b61)
         "feat(import): bound how many imports one person may start"
MIGRATION: 0064_job_import_quota_counters, parents 0063, SINGLE HEAD, new table only.
BROAD: full backend 7,022 passed / 64 skipped / 0 failed. COLLECTION 7,065 -> 7,086 (+21, all new).

AI-002: creation idempotency ALREADY existed (client_request_id) and was already tested —
concurrent duplicate source/draft requests return one record. What was missing was the expensive
half, now asserted as a CALL COUNT: a repeat after success calls no provider and consumes no
attempt. No second identifier invented.

AI-003 QUOTA — one statement, and that is the whole point:
  UPDATE counters SET used = CASE WHEN window stale THEN 1 ELSE used + 1 END,
                      window_started_at = CASE WHEN window stale THEN now ELSE unchanged END
  WHERE user_id = :u AND (window stale OR used < :limit) RETURNING used
  No row back = refused. Read-then-decide-then-write lets ten simultaneous requests all read
  "3 of 20" and all proceed, and the window reset has the same trap: "reset if stale, then
  increment" is two steps, and two requests at the rollover both reset and both start at one.
  JOB_IMPORT_DAILY_QUOTA default 25, JOB_IMPORT_QUOTA_WINDOW_HOURS default 24.
  PER USER, not per draft: the cost is the provider's, and one person with fifty drafts is
  exactly what a per-draft limit misses.
  Charged BEFORE the lease, refunded when no provider call happens — the unit stands for a call.
  A repeat on a finished draft returns before the charge at all, so refreshing your own draft
  cannot lock you out of importing. Both directions are tested through the route.
  Refused with 429 JOB_IMPORT_QUOTA_EXCEEDED.
  Mutation-proven: a read-then-write rewrite passes every behavioural test and fails only the
  two structural ones. As with the claim, structure is the only witness on SQLite.

AI-004 IS NOW SPLIT HONESTLY. Allowlist and output cap are done. Spend is bounded in ATTEMPTS,
which is the unit this codebase can actually count. A budget denominated in CURRENCY is marked
BLOCKED_PRODUCT_DECISION: it needs real per-model prices, and inventing them would produce a
number that looks like control and is not.

NEXT READY: AI-009 (provider privacy — inspect the actual payload; much may already hold),
AI-010 (evaluation corpus incl. prompt injection), AI-005/AI-007/AI-008 survey-then-close.
```

## Phase 6G checkpoint (AI-001E + AI-006 — the sweep runs, and readiness can see it)

```text
SLICE: AI-001E (run the sweep) + AI-006 (queue readiness).
COMMIT: "feat(import): run the sweep, and let readiness say whether anything will"
MIGRATION: none. BROAD: full backend 7,001 passed / 64 skipped / 0 failed.
COLLECTION: 7,048 -> 7,065 (+14 sweeper, +3 readiness). Accounted for.

RUNNING IT: JOB_IMPORT_SWEEPER_IN_PROCESS (default FALSE) +
JOB_IMPORT_SWEEPER_INTERVAL_SECONDS (default 30). Same posture as the email worker, for a
sharper reason: a sweeper that shares a lifetime with the web server shares its restarts, and
the stranded rows it exists to rescue are created by exactly those restarts. Own process:
  python -m app.services.job_import_sweeper
app/main.py shutdown now stops BOTH background loops through one list, so adding a third cannot
leave the second unstopped.

READINESS reports `sweeper_configured` SEPARATELY from `ready`, and that separation is the
point: an import can be started and finished in-request with no sweeper at all. What is missing
without one is RECOVERY. Folding it into `ready` would send an operator hunting for a broken
provider when nothing is broken. The probe also cannot see a sweeper running as its own process,
so it reports what it knows ("this API hosts one") rather than asserting none exists.
Provider health is still deliberately NOT probed — a probe that called the provider would bill a
request every time a load balancer looked.

AI-001 is now IMPLEMENTED, not VALIDATED, and the ledger says why: live multi-worker concurrency
cannot be raced here (no PostgreSQL harness, Docker absent). The contract is implemented and
tested; the distributed race is not empirically proven.

NEXT READY: AI-002 (idempotency — review against the EXISTING client_request_id contract rather
than inventing a second one), then AI-003 quotas, AI-004 spend budget (now that
processing_attempts is a durable per-draft record), AI-010 evaluation corpus.
```

## Phase 6F checkpoint (AI-001D — the sweep for imports nobody is watching)

```text
SLICE: AI-001D. COMMIT: "feat(import): settle the imports nobody is watching"
MIGRATION: none. FILES: app/services/job_import_sweeper.py (new),
  settle_as_failed() added to job_import_execution_repository, tests/test_job_import_sweeper.py (14).
FOCUSED: sweeper 14, plus claim/lease/terminal/checkpoint dependents green.

THE DESIGN DECISION, and it is the whole slice: THE SWEEP NEVER CALLS THE PROVIDER.
It settles a stranded attempt into processing_failed and schedules when it may be tried again;
it does not try again itself. Re-running an import unattended would spend money for someone who
is not there to see the result and hand them a draft they did not ask for. The recruiter, or
their next request, decides whether to spend again.
That also answers the kill-switch-while-queued question BY CONSTRUCTION rather than by a flag:
an incident switch must stop provider work already queued, and a sweep that invokes no provider
cannot violate that. Running it while the switch is off is actively useful — rows stop claiming
to be in progress while the feature is paused. A test asserts both halves.

SESSION FACTORY IS INJECTED, never imported. A worker that reaches for the configured engine
cannot be pointed at a disposable database by a test — which is exactly how a test once wrote a
row into dev.db. A structural test asserts the module never imports SessionLocal.

NOT WIRED TO STARTUP YET. run_import_sweeper_forever exists and is tested; nothing runs it. That
is the next slice, and it should follow the EMAIL_WORKER_IN_PROCESS pattern (off by default, own
process preferred) rather than silently starting a second background loop in the API.

NEXT READY: AI-001E — run the sweeper (setting + startup wiring, mirroring Phase 5), then AI-006
queue readiness now that a queue exists, then AI-002 idempotency review against client_request_id.
```

## Phase 6E checkpoint (AI-001C — the claim is wired into the request path)

```text
SLICE: AI-001C. COMMIT: "feat(import): take the import before calling the provider"
MIGRATION: none. BROAD: full backend 6,984 passed / 64 skipped / 0 failed.
COLLECTION: 7,018 -> 7,048 (+24 AI-001B claim tests, +6 new). Fully accounted for.

HONEST SCOPE — read this before claiming AI-001 fixed "loading forever":
app/core/job_import_attempt_liveness.py ALREADY settled a stale `processing` row when someone
read it. That covers the recruiter who comes back and refreshes. What ownership adds, and what
these tests cover, is narrower and real:
  - two concurrent requests produce ONE provider call (previously bounded only by a
    transaction-scoped mutation token, which says nothing once the transaction ends);
  - attempts are bounded by the claim, counted AT CLAIM so a process that dies mid-attempt still
    spent one — a crash reports nothing, so counting failures cannot bound a crash loop;
  - a queryable lease, so a sweep can find stranded rows WITHOUT a reader;
  - a failure schedules its own retry.

TWO DESIGN CORRECTIONS FOUND BY THE EXISTING TESTS, both worth keeping:

1. THE CLAIM MUST NOT WRITE processing_status. It did at first, and begin_processing's
   allowed-from set is {awaiting_processing, processing_failed} — so the claim made the very next
   transition illegal and every import failed. Ownership (lease) and lifecycle (status) are two
   axes. The eligibility rule now reads: nobody holds the lease AND the work is still wanted.
   This is also why the status is briefly stale by construction: ownership is taken first.

2. BACKOFF BINDS THE SWEEP, NOT A PERSON. Scheduling a 30s retry after a failure made the
   recruiter's "try again" wait out a machine's delay — an existing test caught it.
   claim_draft_for_processing defaults honour_retry_schedule=False; claim_stranded_drafts
   defaults True. A person pressing the button is watching, wants it now, and is already bounded
   by the attempt ceiling and the route rate limit.

CONTRACT PRESERVED: a second request while one is running still returns 200 with
outcome="already_processing" (_current_outcome), NOT a 409. The new 409s are only for cases the
old contract never had: JOB_IMPORT_ATTEMPTS_EXHAUSTED and the narrow window where ownership is
taken but the status transition has not landed.

NEXT READY: AI-001D — the sweeper that drains stranded imports (reuse the Phase 5 runner shape;
give the worker an injectable session factory, NOT app.db.session directly), plus deciding
kill-switch-while-queued semantics from the ledger.
```

## Phase 6D checkpoint (AI-001B — the atomic claim)

```text
SLICE: AI-001B — one-statement claim + stranded sweep. Not wired into the request path yet.
COMMIT: "feat(import): claim an import in one statement, not two"
MIGRATION: none. FILES: app/repositories/job_import_execution_repository.py (new),
  tests/test_job_import_execution_claim.py (new, 24 cases).

CONTRACT:
  claim_draft_for_processing(session, draft_id, worker_id=, now=)  -> draft | None
  claim_stranded_drafts(session, worker_id=, limit=, now=)         -> [draft]
  release_expired_claim(session, draft_id, now=)                   -> bool
  All three are UPDATE ... WHERE eligible ... RETURNING. Never read-then-write: two callers both
  reading a draft as free and both writing is one import becoming two provider calls and two
  bills. Same defect class as RATE-001 and the invite redemption.
  The batch claim re-checks eligibility INSIDE the write; the subquery only proposes candidates.
  PostgreSQL adds FOR UPDATE SKIP LOCKED so a second worker steps over rather than queues.

ATTEMPTS ARE COUNTED AT CLAIM, not at failure. A process that dies mid-attempt reports nothing,
so counting failures would let a crash loop retry forever — and the attempt may already have
reached the provider and been billed. Counting claims makes the ceiling bound spend.

DRIFT GUARD: the eligibility rule exists twice (pure Python for callers, SQL for atomicity).
TestTheSqlRuleAndThePythonRuleAgree writes all 189 state combinations, offers each to the claim,
and compares against may_start_attempt. It also asserts the matrix produces BOTH answers, so an
all-ineligible matrix cannot pass vacuously.

MUTATION RESULT WORTH KNOWING: rewriting the claim as select-then-decide-then-write passes EVERY
behavioural test — SQLite on one connection cannot show the race — and is caught only by
TestTheClaimIsOneStatement. Structural tests are not optional here; they are the only witness.
Live concurrency proof remains unavailable (no PostgreSQL harness, Docker absent): the CONTRACT is
implemented and tested, the distributed race is not empirically proven. Do not claim otherwise.

NEXT READY: AI-001C — wire the claim into the processing path (lease on start, release/settle on
finish, failure -> bounded retry schedule), then AI-001D worker + kill-switch-while-queued.
RESUME: cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_job_import_execution_claim.py -q
```

## Phase 6C checkpoint (AI-001A — durable execution state for an import attempt)

```text
SLICE: AI-001A — schema + pure execution rules. No behaviour change yet.
STATUS: committed. AI-001 stays IN_PROGRESS.
COMMIT: "feat(import): let a stranded import be found and retried"
MIGRATION: 0063_job_import_execution_lease, parents 0062, SINGLE HEAD. Expand only: four
  nullable/defaulted columns + two indexes on job_import_drafts. No data statement, so schema and
  code deploy in either order. Offline SQL render verified; no PostgreSQL harness (Docker absent).

THE DEFECT: an import is a request-thread operation. If the process died mid-call the draft stayed
at processing_status='processing' and nothing had reason to look at it again — the recruiter's
screen said "preparing your draft" forever. That is worse than an error: it is indistinguishable
from slow success, so nobody reports it and nothing retries it.

NEW COLUMNS (job_import_drafts): processing_lease_expires_at, processing_worker_id,
  processing_attempts, processing_next_attempt_at.
  The lease EXPIRES rather than being released — a process that crashes releases nothing.
  LEASE_SECONDS=300, deliberately > provider ceiling (90s) x2: reclaiming a merely-slow attempt
  turns one import into two provider calls and two bills. A test pins that inequality.
  attempts moved OUT of provider_metadata JSON into a column, because a bound in a JSON blob
  cannot be enforced by a query and the rows worth finding are the ones nobody is loading.
  Existing rows start at 0 — no backfill, since no consumer reads the column yet.

RULES: app/core/job_import_execution.py — pure, no session. may_start_attempt / is_stranded /
  lease_is_live / retry_delay_seconds. MAX_ATTEMPTS=5, backoff 30s..900s, deterministic.
  Deliberately does NOT fold in the kill switch or ownership: three questions in one function is
  a function trusted for none of them.

TESTS: tests/test_job_import_execution_rules.py (20) + tests/test_job_import_execution_lease_migration.py (7).
  The migration guard derives "columns some migration creates" by PARSING THE MIGRATION CHAIN,
  never from the model — a model-derived baseline agrees with itself. Proven non-vacuous by
  mutation: an injected model-only column fails it with assert not {'drift_probe'}.
  It also guards its own parser (a regex matching nothing would make everything vacuously pass).

NEXT READY: AI-001B — atomic claim (UPDATE ... WHERE eligible RETURNING; never read-then-write),
  then AI-001C wiring, AI-001D worker + kill-switch-while-queued semantics.
RESUME: cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_job_import_execution_rules.py -q
```

## Phase 6B checkpoint (AI-004 partial, AI-006 partial — a model allowlist and a readiness probe)

```text
Commit: "feat(import): refuse a model nobody chose, and say so before a recruiter waits"
Both rows are IN_PROGRESS, not VALIDATED, and the ledger says which half is missing. Claiming
either as complete would be the more comfortable lie.

WHY AN ALLOWLIST. OPENAI_MODEL was a free-form string validated by a character pattern. A pattern
cannot distinguish a typo from a different model: the typo failed every import SLOWLY, at the
provider, after the recruiter had pasted a job and watched a progress bar, and a valid-but-
unintended name SUCCEEDED — calling a model nobody chose, at whatever that model costs. The
allowlist turns both into an answer available before any request is billed.
  OPENAI_MODEL_ALLOWLIST, comma separated. Empty = the single shipped default.
  Deliberately narrow: a deployment running another model must name it. Inventing a list of
  plausible-looking model identifiers would be worse than useless — it would authorise calls to
  models nobody has chosen.
  Enforced in app/api/deps.get_job_import_provider, i.e. at the last point before a name can
  become a billed request. Reporting it on the probe alone assumes somebody reads the probe
  first, and nothing makes them.

READINESS: GET /api/v1/health/job-import -> {ready, enabled, problems[]}
  - configuration only, NO provider call: a probe that asked the provider would bill a request
    every time a load balancer looked, and would report an outage nothing here could fix.
  - always 200, including unready. A probe that 503s takes the whole process out of rotation
    over one feature.
  - switched off reports enabled:false with NO problems, so a deliberately paused feature does
    not read as a broken one on a dashboard.
  - does not echo the configured model or key; it is unauthenticated, and configuration is not
    something to hand out. A test asserts neither value appears in the body.

Nothing here refuses to boot. Import already has a kill switch, and taking the whole API down
over one feature's configuration trades a small outage for a large one.

Tests: tests/test_job_import_model_allowlist.py, 14 cases. Non-vacuity PROVEN by mutation:
removing require_allowed_model from the provider factory fails the test that builds it with an
unlisted model.

NEAR-MISS WORTH RECORDING: these tests were first written to tests/test_job_import_readiness.py,
which ALREADY EXISTED — 2,249 lines of it — and the write silently replaced the lot. Nothing
failed: the suite stayed green, because the destroyed tests simply stopped existing. It was
caught only by comparing the total against the previous run (6,930 collected where 6,977 was
expected), and restored with git checkout. Two habits follow. Check whether a test file exists
before writing one, and treat a DROP in the collected total as a failure, because a suite cannot
report tests it no longer has.

STILL MISSING, explicitly: AI-004's spend budget and thresholds need somewhere to record spend,
which does not exist yet; AI-006's queue readiness cannot exist until AI-001 does. The
token/output cap AI-004 asks for was already in the adapter before this work (max_output_tokens),
and so was store=False, the measured 90s timeout and the single transient-only retry — which is
why AI-005 and AI-009 should be surveyed before being implemented rather than after.
```

## Phase 6A checkpoint (AI-011 — the switch that actually turns AI job import off)

```text
Commit: "feat(import): give AI job import a switch that actually turns it off"
Setting: JOB_IMPORT_ENABLED, DEFAULT TRUE. No migration.
Taken out of order: the ledger lists AI-011 as depending on AI-001, but a kill switch is worth
more BEFORE a durable queue exists than after, and it depends on nothing AI-001 provides.

WHAT WAS ACTUALLY MISSING: `ENABLE_JOB_IMPORT` in lib/importJob/flag.ts hides the frontend entry
point and leaves every /api/v1/job-imports route open. Anyone with a session or a saved request
can still spend provider budget, so ending an incident meant shipping a deploy — the slowest
response to the fastest kind of problem.

WHAT "OFF" MEANS, deliberately narrow: no NEW provider work starts. It does NOT confiscate work
already done. A prepared draft can still be read and carried into Post Job, because that draft
exists, it cost what it cost, and taking it away helps nobody. Reading stored state has always
resolved to "read stored state and render it" (the pause invariant), so this fits the existing
model rather than bolting a second one beside it.

TWO PROVIDER ENTRY POINTS, both closed:
  app/services/job_import_processing_service.py  process()  -> refuse_if_disabled(), 503
  app/services/job_import_conversation_service.py may_call_provider() -> False when disabled
The check lives inside may_call_provider rather than beside its callers, for the same reason the
state rules do: a second copy of "may we call the provider" drifts, and the weaker copy becomes
the way in. app/core/job_import_availability.py is the one home for the switch, read at CALL time
— captured at import time it would need a restart, and a switch that needs a restart is not one.

UI: components/import-job/ImportJobPageClient.tsx maps JOB_IMPORT_DISABLED to its own sentence.
This is required, not cosmetic. That component deliberately refuses to render backend prose for
import failures, so without a case the refusal falls through to "try again" — the one thing that
cannot work while the feature is off, and an invitation to keep retrying through the incident
that caused it to be switched off. The backend message stays provider-neutral too; a test asserts
it names no provider, model, or flag.

TESTING LESSON WORTH KEEPING: the first version drove conversation/begin over HTTP and asserted
the provider call count stayed at zero. It passed with the switch REMOVED — the fixture drafts
sit in states that never start provider work, so the assertion could not fail. Replaced with a
direct check on may_call_provider for the two states that DO start work (source_received,
resuming), which fails correctly under mutation. The HTTP sweep is kept as a safety net for a
future route that starts work without asking, and is labelled as exactly that.

Non-vacuity PROVEN by mutation: removing refuse_if_disabled fails 3 tests; removing the
conversation gate fails both parametrised gate tests.

NOT COVERED BY A UNIT TEST, stated plainly: the frontend copy. readableImportError is private to
ImportJobPageClient.tsx and is not exported, so reaching it would mean extracting it from a
mature component — a bigger change than this slice justifies. It is typechecked, and the code
string it matches is asserted on the backend side.
```

## Phase 7D checkpoint (MEDIA-004 — a request may not decide where media lives)

```text
COMMIT: "fix(media): stop letting a request decide where media lives"
MIGRATION: none. BROAD: full backend 7,096 passed / 64 skipped / 0 failed. COLLECTION 7,157 -> 7,160.

A REAL VULNERABILITY, and a STORED one rather than reflected. Uploads built their URL from
`request.base_url`, which Starlette derives from the Host header. A request arriving with
`Host: evil.example` therefore wrote `https://evil.example/media/avatars/...` into that profile
row — persisted, and served to every later visitor of the profile. The attacker needed no access
to the account, and the poisoned URL outlived the request that planted it.

FIX: canonical_media_base_url() prefers MEDIA_PUBLIC_BASE_URL and falls back to the request only
as a development convenience. validate_production_settings() now REFUSES TO BOOT in production
without the setting, so the fallback cannot quietly become the production behaviour.
A CDN hostname is simply what that setting holds; the CDN itself is external.
Mutation-proven: preferring the request origin again fails two tests, including one that drives
the real route with a hostile Host header.

NOTE for whoever adds settings later: tests/test_config.py::_safe_production_settings is the
fixture that must gain any new production requirement, or every production-validation test fails
at once — which is what happened here and is the intended signal.
```

## Phase 7C checkpoint (MEDIA-005 partial — replacement no longer orphans)

```text
COMMIT: "feat(media): stop keeping the avatar someone replaced"
MIGRATION: none. BROAD: full backend 7,093 passed / 64 skipped / 0 failed.
COLLECTION: 7,148 -> 7,157 (+9). Accounted for.

THE DEFECT: replacing an avatar left the previous file on disk for ever. The row pointed
somewhere new and nothing pointed at the old object, so nothing could ever decide to remove it.
Storage that only grows is a bill that only grows, and every orphan is a copy of someone's face
that outlived their decision to change it.

HOW: key_from_url() resolves the superseded object from the stored URL, and returns None for
anything that is not ours — a YouTube channel image, a pre-seam URL, or a path under our prefix
that does not look like a key we would have written. That last case matters: a stored URL is
data, and data that arrives looking like a traversal must not become a delete.
ORDER: noted before the row changes, deleted AFTER it commits, so a crash in between leaves an
orphan rather than a profile pointing at a file that is gone. Cleanup can never fail the upload —
the profile is already correct and the person is waiting; a surviving file is tidiness, an error
here would be their upload appearing to fail after it worked.
Mutation-proven: removing the cleanup call fails the end-to-end test.

STILL OPEN in MEDIA-005, and named rather than implied: deleting a person's objects when their
account goes, and sweeping objects orphaned by an earlier crash. Both want a stored key column on
the row rather than parsing it back out of a URL, which is a migration and a slice of its own.
```

## Phase 7B checkpoint (MEDIA-001 — uploads go through a seam, not to a directory)

```text
COMMIT: "feat(media): put uploads behind a seam the filesystem does not own"
MIGRATION: none. BROAD: full backend 7,084 passed / 64 skipped / 0 failed.
COLLECTION: 7,123 -> 7,148 (+25 storage). Accounted for.

WHY: media goes to the application's own filesystem, which works until there is a second instance
or a redeploy onto fresh disk — then half the avatars are missing on half the requests. This does
not fix that; an object store does. It makes the fix a CONSTRUCTOR SWAP rather than a rewrite,
and pins the contract before the swap so the adapter has something to satisfy.

app/services/media_storage.py:
  MediaStorage protocol — url_for / put / delete / exists, and a test asserts it has not grown.
    Every method here is one every future adapter must implement, and the ones that are easy on a
    filesystem are the awkward ones on an object store.
  LocalMediaStorage — what runs today; its docstring says plainly it is not a production answer,
    and a test asserts the docstring still says so.
  build_object_key(prefix, owner_id, extension) -> "prefix/owner-hex/random.ext"
    Owner in the path so an object can be attributed and swept WITHOUT a database lookup — a
    deletion that has to join back to a table stops happening when the table is what is being
    cleaned up. Random suffix so knowing an account id does not let you enumerate its uploads.
  validate_object_key — refused at EVERY entry point, not just put, plus an independent
    is_relative_to check after resolution. The regex already excludes traversal; the second check
    is for the day someone loosens the regex.

The real object-store adapter (S3/R2) is BLOCKED_EXTERNAL: bucket, credentials, bill. A fake
in-memory adapter satisfying the protocol is exercised in the tests, so substitutability is
demonstrated rather than asserted.

NEXT READY: MEDIA-005 (object lifecycle — replacement currently ORPHANS the previous avatar,
which is now cheap to fix through the seam), then MEDIA-004 canonical delivery, MEDIA-002 upload
grants. Then Phase 8.
```

## Phase 7A checkpoint (MEDIA-003 — an upload is what its bytes say, not what it claims)

```text
COMMIT: "feat(media): decide what an upload is from its bytes, not its label"
MIGRATION: none. BROAD: full backend 7,059 passed / 64 skipped / 0 failed.
COLLECTION: 7,098 -> 7,123 (+25 media validation). Accounted for.

TWO REAL DEFECTS, both live before this:
  1. The stored file's extension came from the CALLER'S content_type. Anyone could declare
     image/png, upload something else, and have it served from this application's own origin at
     a .png path. What a browser does with same-origin bytes depends on how it sniffs them, and
     "depends" is not a security property.
  2. Bytes were stored exactly as received, EXIF included. A creator uploading an avatar taken on
     a phone was publishing the GPS coordinates of where they took it, next to their face.

NOW: app/services/media_validation.py — sniff the format from the bytes, refuse a declared type
that disagrees, derive the extension from the sniffed type, cap PIXELS as well as bytes (a
200-byte PNG can declare 60,000x60,000; the byte ceiling cannot see that at all), and strip
metadata. Fails CLOSED: a container it cannot parse is refused, because "we could not tell" and
"it is fine" are different answers.

NOT DONE, and it is the strongest version: RE-ENCODING. Decoding and re-emitting neutralises
anything hiding in a container this code parses correctly but a decoder reads differently. It
needs an imaging library (no Pillow in the venv), which is a dependency decision against a locked
contract, not a coding one. Everything above is what can be done exactly with no new dependency.
GIF metadata is passed through — its extensions interleave with frame data and a wrong rewrite
corrupts the image; GIFs carry no EXIF, so the exposure that motivated this is absent there.

FOUND ON THE WAY: the banner test fixture was a CORRUPT PNG — its IDAT length field said 11 while
the chunk was 13 bytes (CRC-verified). Nothing had ever parsed it, so it passed. Replaced with a
valid generated PNG. If another image fixture starts failing, check the file before the parser.
```

## Phase 8B checkpoint (REALTIME-003 + REALTIME-002 — degraded operation, and what typing already did)

```text
COMMIT: "feat(realtime): keep the record when the hint does not arrive"
MIGRATION: none. BROAD: full backend 7,121 passed / 64 skipped / 0 failed.
COLLECTION: 7,178 -> 7,185 (+5 degraded, +2 typing). Accounted for.

REALTIME-003: the claim "realtime is a hint, not a record" is easy to make and easy to stop being
true — one publish moved above a commit and a broker outage loses a message. So it is tested from
the OUTSIDE: a completely broken bus, a real message sent through the real route, and then the
message must exist, read back over HTTP, and still count as unread. That read-back IS the
reconnect path, which is why no separate replay mechanism is needed.
Mutation-proven: removing the publish try/except fails three tests, including both end-to-end.

GET /api/v1/health/realtime -> {configured, cross_instance, problem}
  `configured` and `cross_instance` are deliberately separate: an operator needs to distinguish
  "a broker is delivering across instances" from "this process is talking to itself", and those
  look identical from every other angle. Leaks no URL or credential — it is unauthenticated.

REALTIME-002: typing ALREADY had a 6-second expiry, disconnect cleanup, and multi-tab handling
("typing elsewhere") before this phase. Now pinned: a disconnect must tell the other side typing
stopped, and the expiry must stay short — a stuck "typing…" is a lie that persists, and a
long one is the same lie more slowly.
PRESENCE HAS NO PRODUCT SURFACE. No endpoint, model or UI exposes online status. There is nothing
to give TTL semantics to, and building one would be inventing a feature rather than hardening
one. Recorded in the ledger as such rather than left looking unfinished.

Test note: typing events are conversation-scoped, so a test recipient must SUBSCRIBE to the
conversation before it can observe them. An unsubscribed socket sees nothing and the test reads
as a missing feature.

NEXT READY: Phase 8 certification, then Phase 9 (privacy/legal/moderation mechanics).
```

## Phase 8A checkpoint (REALTIME-001 — the seam a second instance plugs into)

```text
COMMIT: "feat(realtime): give events a seam a second instance can plug into"
MIGRATION: none. BROAD: full backend 7,114 passed / 64 skipped / 0 failed.
COLLECTION: 7,160 -> 7,178 (+18 realtime bus). Accounted for.

WHAT WAS ALREADY RIGHT — do not rebuild it: app/realtime/events.py emits only AFTER the database
commit, payloads already carry event_id, and authorization (including the blocking check) is
decided server-side per recipient. The architecture the phase asks for was already the one in
place: DB commit -> durable truth -> realtime hint -> client reconciles.

WHAT WAS MISSING: publish_to_user delivered only to sockets in THIS process. With a second
instance that fails silently — someone connected to instance 2 never sees a message sent through
instance 1, nothing errors, and the symptom is a conversation that looks dead until reload.

NOW: app/realtime/bus.py
  RealtimeEvent(event_id REQUIRED, user_id, payload, conversation_id) — an event without an id
    cannot be deduplicated, and "usually unique" is not an identity.
  RealtimeBus protocol + InProcessRealtimeBus (exactly the previous behaviour).
  DeliveryDeduplicator — PER CONNECTION, not per user: two tabs are two audiences. Bounded
    OrderedDict (256) because an unbounded set lives as long as an idle socket; a redelivered
    event is refreshed so it cannot age out and arrive again as new.
  publish_to_user never raises: the message is already committed and the client reconciles over
    HTTP, so a broker hiccup must not report a failed send.
  build_realtime_bus() REFUSES in production unless ALLOW_PROCESS_LOCAL_REALTIME_IN_PRODUCTION.
    Two instances each talking to themselves look healthy from every angle. Configuring a bus
    name that is not implemented also refuses rather than falling back — silent process-local
    delivery wearing the name "redis" is the exact failure, disguised.

Mutation-proven: removing the dedupe check fails the duplicate-delivery test.

BLOCKED: the Redis/NATS adapter and real cross-process delivery proof (no broker available).
The CONTRACT is implemented and tested; multi-process delivery is not empirically proven.

NEXT READY: REALTIME-003 (degraded operation — reconnect reconciliation over HTTP), then
REALTIME-002 (typing/presence TTL; typing expiry already exists in the manager, check before
building).
```

## Phase 9I checkpoint (LEGAL-001 — inventory only)

```text
COMMIT: "docs(legal): inventory the legal surface so counsel review is bounded"
MIGRATION: none. FILES: docs/LEGAL_SURFACE_INVENTORY.md (new). No code changed.

WHAT IT IS: a description of what the software actually does, so counsel reviews behaviour rather
than guessing, and so the questions needing a human decision sit in one list instead of being
found one at a time. Every surface is classified TECHNICAL CONTROL / NEEDS LEGAL COPY /
NEEDS PRODUCT DECISION / NEEDS COUNSEL REVIEW.

Third-party processors are named WITH WHAT ACTUALLY CROSSES THE BOUNDARY, read from the code —
including that the AI provider receives source job text and the schema but no account, email,
session or internal id (pinned by a test), and that the realtime broker currently receives
nothing at all because no broker adapter is implemented.

OPEN FINDING, recorded rather than fixed: the rendered Terms and Privacy pages carry NO version
marker, while acceptances are stored against version 2026-06-01. Nothing ties the wording somebody
accepted to the wording they were shown. Fixing it needs two decisions first — how a version is
surfaced to the reader, and whether superseded wording must remain retrievable (archive versus
replace). Implementing before those are answered would be guessing.

EIGHT QUESTIONS LEFT OPEN ON PURPOSE, retention period among them: a plausible thirty or ninety
days would be indistinguishable from a decided one.
Contains no legal wording, no retention period, and no compliance claim.

NEXT: Phase 9 certification, then Phase 10.
```

## Phase 9H checkpoint (SUPPORT-001 — internal support queue)

```text
COMMIT: "feat(support): give staff somewhere to track support work"
MIGRATION: 0069_support_tickets, parents 0068, SINGLE HEAD, new table only.
VERIFICATION: pytest exit 0, zero ^FAILED/^ERROR, junitxml 7,335 tests / 0 failures / 0 errors /
  64 skipped. Collection 7,308 -> 7,335 (+27). Accounted for.

SCOPE HELD DELIBERATELY SMALL. Staff log requests that arrive by email; there is NO customer-facing
intake, and inventing one to populate the table would be a product decision disguised as
plumbing. A scope-guard test asserts the model has no attachment, thread, SLA, priority or CSAT
column — each of those is its own decision and none is needed to know who is handling what.

DESIGN POINTS WORTH KEEPING:
  - ESCALATION IS A FLAG, NOT A STATUS. A ticket can be escalated while assigned and stays
    escalated once resolved; one column could not hold both facts. Escalating twice keeps the
    FIRST reason and timestamp, and records ONE audit entry — a repeated click is not a second
    escalation, and an audit row for it would invent an event.
  - RESOLUTION IS NOT A TOGGLE. Resolving an already-resolved ticket is refused (409) rather than
    overwriting the original note and close time. Reopening is not implemented because it is a
    product decision about what happens to those fields, and a silent overwrite is the wrong
    answer to it.
  - ASSIGNEE IS VALIDATED against the account, not a role string in the request. Assigning to a
    member of the public would leave a ticket looking handled by someone who will never see it.
  - RESPONSES NAME EVERY FIELD. Support means looking at accounts and the lazy way is to return
    the user row, which carries a password hash and whatever is added next.
  - NO ACCOUNT-MUTATION ACTIONS. The ledger asked for ticketing/assignment/escalation; adding
    suspend-from-support would have created a second path around account_block() and moderation
    authorization.
  Uses the existing admin permission scaffold via a new "support.tickets" key, and the existing
  append-only audit log. A refused action records NOTHING — a misleading success entry is worse
  than no entry.

TEST NOTE: the same timestamp serialises with a Z suffix when freshly written and without when
read back, because SQLite drops tzinfo. Compare instants, not strings.

PRE-EXISTING, UNTOUCHED: app/core/admin_permissions.py carries four E402 ruff findings that
predate this work (verified by stashing the change). Part of the known whole-tree baseline.

NEXT READY: LEGAL-001 inventory (inventory ONLY — no wording, no retention duration), then
Phase 9 certification, then Phase 10.
```

## Phase 9G checkpoint (MOD-001 — both blocking states enforced everywhere)

```text
COMMIT: "fix(moderation): enforce both blocking states everywhere, not just the one in mind"
MIGRATION: none. SCOPE: enforcement hardening, not a new moderation product (per scope decision).
VERIFICATION (new mandatory method): pytest exit 0, zero ^FAILED/^ERROR lines, THEN junitxml:
  7,308 tests / 0 failures / 0 errors / 64 skipped / 7,244 passed. Collection 7,294 -> 7,308 (+14).

THE AUDIT FOUND THREE REAL GAPS, all the same shape — code that remembered suspension and forgot
the deletion state:
  1. LOGIN. auth_service gated credential ISSUANCE on suspended_at alone, so a deletion-hidden
     account could still log in and collect fresh tokens, then meet 403 on every request.
  2. PUBLIC PROFILE. profile_service hid suspended accounts only, so someone who had asked to be
     deleted stayed publicly visible — the one thing a deletion request is meant to stop at once.
  3. PUBLIC TALENT LISTING. Same omission in marketplace.py.
  Also converted: review anonymisation, strong-auth, QA persona/controller, refresh revocation.

NOW: every blocking/visibility read goes through account_block() / account_is_blocked().
The admin suspend/unsuspend endpoints STILL read suspended_at directly and correctly — they are
about suspension specifically, and reading the combined state there would be wrong.
A structural test forbids `.suspended_at is (not) None` anywhere else in app/, with that exemption
named, and it guards its own regex.

ENFORCEMENT IS TESTED THROUGH AN ALREADY-ISSUED TOKEN, for both states, across: posting a job,
applying, sending a message, the authenticated door, public profile, and login. The token is
obtained BEFORE the block in every case — testing with a token issued afterwards would only prove
login is gated, which is the easy half.
Mutation-proven: reverting the door to suspended_at alone fails five tests, all deletion variants.

NEXT READY: SUPPORT-001 (minimal internal operations capability — no customer-facing intake),
then LEGAL-001 inventory, then Phase 9 certification, then Phase 10.
```

## Phase 9F checkpoint (deletion and suspension become independent states)

```text
COMMIT: "fix(accounts): stop a deletion request from making an account un-suspendable"
MIGRATION: 0068_account_deletion_hidden_at, parents 0067, SINGLE HEAD. Expand only, one nullable
  column on users + index. No data statement.
VERIFICATION: pytest exit 0, ZERO FAILED/ERROR lines, then collection 7,282 -> 7,294 (+12).
  Counts are only read after the run is proven green — see the note at the end of this block.

A REAL ESCAPE, not a tidiness fix. Deletion borrowed `suspended_at` to hide an account, and
admin_suspend_user REFUSES WITH 409 when that column is already set. So:
    request deletion -> account can no longer be suspended by an administrator
    cancel later      -> back to a clean account
An abusive user could have used a deletion request to become un-moderatable for as long as the
attention lasted. The earlier fix stopped deletion ERASING a suspension; it did not stop deletion
PRE-EMPTING one.

NOW: `suspended_at` means an administrative decision and nothing else. `deletion_hidden_at` is the
account holder's own request taking effect. Either hides the account; neither cancels the other.
app/core/account_state.py::account_block(user) is the ONE place both are consulted, because an
enforcement point that checks a single column is how the other state silently stops being
enforced. api/deps.py now asks the helper.
Mutation-proven: writing `suspended_at` from the deletion service again fails three tests,
including the escape itself and a structural test that the service never writes suspension state.

TESTED CROSS-STATE: all four combinations, and BOTH undo directions — cancelling deletion leaves a
suspension in place, and lifting a suspension leaves a deletion request in place (an administrator
deciding someone is no longer suspended has not decided they want their account back).

VERIFICATION METHOD CHANGED, permanently. The character-counting heuristic is abandoned: it read
"s"/"E" inside tracebacks and reported a green-looking 7,673/357 for a run with 15 failures. The
redirected -q log also DROPS the final summary line, which is what tempted the heuristic in the
first place. The rule now is: exit code 0 AND zero ^FAILED/^ERROR lines FIRST, and only then read
the count — with `--collect-only` (or --junitxml) as the structured denominator, never characters.
```

## Phase 9E checkpoint (MOD-002 partial — the audit log stays uneditable)

```text
COMMIT: "test(admin): stop the audit log from becoming editable"
MIGRATION: none. BROAD: full backend 7,218 passed / 64 skipped / 0 failed.
COLLECTION: 7,269 -> 7,282 (+13). Accounted for.

NOTHING WAS REBUILT. The audit log already existed, is already written in the same transaction as
the action, and already documents an append-only intent. What did not exist was anything that
would notice if that stopped being true — and a convention in a docstring is exactly what erodes
when someone adds "correct a typo in the reason" or a cleanup script.

NOW ENFORCED: no source file issues update()/delete() against AdminAuditLog, and admin.py exposes
no PATCH/PUT/DELETE audit route. Plus the actor FK is SET NULL rather than CASCADE, so an
administrator cannot erase their own trail by deleting their account, and target_label is
snapshotted at write time so an old entry stays legible without anyone editing it.
The guard guards itself: a test asserts the scan actually finds the model, since a regex matching
nothing would make every other assertion pass while checking nothing.
Mutation-proven: injecting `update(AdminAuditLog)` into app/core/qa_personas.py fails it.

STATED PLAINLY: this is NOT a database-level guarantee. There is no trigger and no revoked GRANT,
so a structural test is weaker than a permission — and much stronger than a comment, because it
fails in review rather than during an investigation. Retention and export are still open.

TEST NOTE: ON DELETE SET NULL is applied by the DATABASE, so the ORM copy stays stale — re-read
with populate_existing=True or the assertion tests the identity map instead.

NEXT READY: MOD-001 profile/portfolio moderation, SUPPORT-001, LEGAL-001 (inventory only — the
wording is external). Then Phase 10 CI/CD.
```

## Phase 9D checkpoint (PRIV-002 partial — what an export may contain)

```text
COMMIT: "feat(privacy): export what someone owns, and nothing that is not theirs"
MIGRATION: none. BROAD: full backend 7,205 passed / 64 skipped / 0 failed.
COLLECTION: 7,258 -> 7,269 (+11). Accounted for.

THE HARD PART IS THE WORD "THEIR", and there are two traps.
  A conversation is attached to this account, so the obvious export walks the relationship and
  hands over the WHOLE THREAD — including everything the other person wrote. They were present
  for those messages, which is not the same as owning them, and the counterparty never agreed to
  appear in somebody's download folder. Messages are filtered to sender_user_id.
  Mutation-proven: widening the filter to "conversations they took part in" fails the test.

  A row-by-row dump of the account includes the PASSWORD HASH. That is not their data in any
  useful sense — it is the means of being them, in a file that gets emailed, saved to Downloads
  and occasionally forwarded. The account section names every field by hand; a test asserts it
  uses no reflection, because reflection exports whatever column someone adds in six months.

Both are asserted against the SERIALISED output rather than the code, since that is where a
leak actually shows up.

STILL OPEN (the remaining test names in the ledger row describe exactly this): reauthentication
before export, an expiring download link, and async archive generation. What is built is the
CONTENT rule, which is the part that is dangerous to get wrong.

NEXT READY: MOD-002 audit-log integrity (survey first — the admin panel already has an
append-only rule), then MOD-001, SUPPORT-001, LEGAL-001. Then Phase 10.
```

## Phase 9C checkpoint (PRIV-003 partial — asking to be deleted)

```text
COMMIT: "feat(privacy): let someone ask to be deleted, and act on the part that is theirs"
MIGRATION: 0067_account_deletion_requests, parents 0066, SINGLE HEAD, new table only.
BROAD: full backend 7,194 passed / 64 skipped / 0 failed. COLLECTION 7,244 -> 7,258 (+14).

WHY NOT JUST DELETE THE ROW: an account is entangled with other people's records. Their messages
are half of somebody else's conversation; their application is a decision a recruiter is in the
middle of. Erasing that inside the request that asked for it resolves every one of those
questions silently, in whatever way the query happened to be written, and irreversibly.

WHAT HAPPENS IMMEDIATELY (all reversible, none destructive):
  - the request is recorded, so nothing depends on someone remembering;
  - the account is hidden by reusing `suspended_at` — every visibility and access check already
    consults it, and a second flag would give two answers to "is this account active";
  - every session is revoked through the EXISTING revocation, not a second implementation. A
    session that survives the window between asking and completing is a stolen laptop still using
    an account whose owner has said they are finished with it.

BUG FOUND BY ITS OWN TEST, worth recording: the first version overwrote suspension_reason
unconditionally. An account an administrator had suspended would have had that reason destroyed,
and cancelling would then have LIFTED THE ADMIN SUSPENSION — asking to be deleted would have been
a way out of being suspended. Now an already-suspended account is left exactly as it is, and
cancel only lifts a suspension whose reason is the self-requested one.

NOT BUILT, deliberately: erasure and anonymisation, because they need a RETENTION DURATION, and
that is a legal and product decision. A number chosen here would look exactly like a number
someone decided. A test asserts the service invents none. This is BLOCKED_PRODUCT_DECISION; the
erasure pass becomes READY the moment a duration exists.

NEXT READY: PRIV-002 export (deterministic archive, and it must not include another person's
private messages), then MOD-002 audit-log integrity — survey first, the admin panel already has
an append-only rule.
```

## Phase 9B checkpoint (PRIV-006 — what a person can switch off)

```text
COMMIT: "feat(consent): let people switch off the mail we chose to send them"
MIGRATION: 0066_notification_preferences, parents 0065, SINGLE HEAD, new table only.
BROAD: full backend 7,161 passed / 64 skipped / 0 failed. COLLECTION 7,201 -> 7,225 (+24).

THE ASYMMETRY, which mirrors the Phase 5 suppression rule deliberately:
  ESSENTIAL (transactional + all auth mail) is always sent. Let someone unsubscribe from these
  and they can lock themselves out of their own account by clicking a link at the bottom of an
  email they did not want — the reset they request next never arrives and nothing explains why.
  OPTIONAL (lifecycle, digest) is theirs to refuse completely.
  An UNKNOWN event key is treated as ESSENTIAL. The failure directions are not symmetric: wrongly
  sending one email is a nuisance, wrongly withholding a password reset is a lockout.
  selectable_categories() never offers an essential one — a switch that does nothing is worse
  than no switch, because the person believes they unsubscribed.

STORED AS OPT-OUT: absence of a row means subscribed. The other way round, a category added next
year arrives switched off for every existing account — a feature nobody can find, failing
silently. A row per (user, category), idempotent, so a link clicked twice or prefetched by a mail
client means one refusal.
A user_id of None (mail to someone with no account, e.g. an invitation) has refused NOTHING;
reading that as "refused everything" would stop the one message that matters most.

ENFORCED IN THE WORKER, beside suppression and for the same reason: someone can unsubscribe after
their mail is queued, and that queued mail is exactly what must not go out.
Mutation-proven: removing the consent check fails the opted-out test.

TWO TESTING LESSONS FROM THIS SLICE, both worth keeping:
1. The Phase 5C outbox trap AGAIN: process_outbox_once claims the WHOLE table, so these tests
   passed alone and failed in the suite by counting other tests' queued mail (claimed=10, sent=10).
   Any test that runs the worker needs the autouse delete(EmailOutbox) fixture.
2. The character-counting method used to verify collection movement is only valid on a log with
   NO tracebacks — failure output is prose, and prose is full of "s" and "E". It reported 7,673
   total and 357 skips for a run that actually had 15 failures. The count check now asserts the
   log contains no FAILED/ERROR before trusting the numbers.

UNSUBSCRIBE LINK (same phase, next commit): app/services/unsubscribe_tokens.py + POST
/api/v1/unsubscribe. UNSUBSCRIBE_TOKEN_SECRET, unset = refuse.
  - HMAC over (user_id, category). The obvious version carries a raw user id, and anyone who saw
    one URL could switch off a stranger's mail by changing it — no login, no trace, and a victim
    who only notices when something they wanted stops arriving.
  - NO EXPIRY, deliberately and unlike every other signed link here: it lives as long as the
    email holding it, and someone clearing a two-year-old inbox is exactly who should be able to
    use it. A test asserts the absence so a future "harden it" change has to argue with the
    reason.
  - Scoped to ONE category, so a digest's link cannot switch off everything.
  - POST only. Mail clients and scanners follow links to prefetch them, so a GET that changes
    state means being unsubscribed by your own spam filter. A test asserts GET does nothing.
  - An essential category is refused even if a token names one.
  Mutation-proven: removing the signature comparison fails four tests.

NEXT READY: PRIV-002 export, PRIV-003 deletion. Both are large; decompose. Survey first — the
admin panel already has an append-only audit rule and suspension enforcement.
```

## Phase 9A checkpoint (PRIV-001 — versioned legal acceptance)

```text
COMMIT: "feat(legal): record which version someone agreed to, not that they agreed"
MIGRATION: 0065_legal_acceptances, parents 0064, SINGLE HEAD, new table only.
BROAD: full backend 7,137 passed / 64 skipped / 0 failed. COLLECTION 7,185 -> 7,201 (+16).

WHY A TABLE AND NOT A FLAG: the question asked later is never "did they accept". It is "what did
they accept, and when", usually by someone establishing whether a specific person saw a specific
clause. A boolean overwritten at the next version change cannot answer that and cannot be
reconstructed afterwards. Rows are written, never updated.

THE RULE (app/core/legal_documents.py, pure): outstanding_documents(accepted) compares against
the CURRENT version, so someone who accepted last year's terms is treated exactly like someone
who accepted nothing. Anything softer lets a change to the terms take effect without agreement.
Mutation-proven: relaxing it to "any acceptance counts" fails two tests.

VERSIONS LIVE IN CODE, not in the database. A document's wording ships with the release that
references it, so the version a running server asks for is always one whose text exists. A
database-held current version could name a document this build cannot render.
Versions are DATES (2026-06-01) rather than counters: acceptance records get read by people
asking "what were they shown in June".

IDEMPOTENT BY CONSTRUCTION: INSERT ... ON CONFLICT DO NOTHING on (user, document, version). A
double-click or client retry is ONE agreement; a second row would suggest a separate act of
consent that never happened. Not "select then insert", which races exactly the double-click it
is meant to survive.

DELIBERATELY ABSENT: any legal wording. A test asserts the module contains none — writing and
reviewing the text is LEGAL-001/002 and external, and a build must not ship prose nobody
approved. The version registry is the machinery that will carry whatever the wording becomes.

NEXT READY: the acceptance API surface (present outstanding documents, record acceptance), then
PRIV-006 notification consent, PRIV-002 export, PRIV-003 deletion. SURVEY FIRST — the admin
panel already has an append-only audit rule and suspension enforcement.
```

## Phase 3K checkpoint (RATE-003A — backend endpoint quotas)

```text
Phase: 3K — backend endpoint quota identity, categories and route coverage
Status: COMPLETE atomic slice; RATE-003 IN_PROGRESS only for the separate OF-105 Google Places
  boundary in the Next runtime
Initial HEAD: e931d547dd8de8b549739574ffc398508cee0b51
Final HEAD: resolve `git rev-parse HEAD`; this handoff is committed with the implementation
Commit(s): `security(rate-limit): enforce user-scoped endpoint quotas`
Files materially changed:
  backend/app/core/rate_limit.py; backend/app/api/deps.py
  backend/app/core/admin_permissions.py
  backend/app/api/v1/routers/{auth,job_imports,jobs,marketplace,me,messaging,portfolio,reviews,search}.py
  backend/tests/test_endpoint_rate_limits.py
  docs/PRODUCTION_READINESS_EXECUTION.md; docs/PRODUCTION_READINESS_OUTBOUND_FETCH.md
  docs/PRODUCTION_READINESS_HANDOFF.md
Migrations: none. Alembic remains one head at 0070_activity_page_indexes; configured local
  SQLite remains unversioned. No model, database field or migration consumer changed.
Behavior changed:
  - anonymous/pre-auth quotas now use a namespaced `ip:<trusted caller>` key; authenticated
    quotas use `user:<verified durable-session user UUID>`. A person's allowance therefore
    follows the account across devices/IP changes, and multiple people behind one NAT no longer
    consume one shared marketplace/import/messaging allowance;
  - `enforce_rate_limit` is the one safe 429/Retry-After and privacy-safe fail-closed 503 path.
    Existing IP and new user dependencies both call it, so backend failure cannot produce two
    subtly different security behaviors;
  - verification and refresh receive explicit pre-auth IP ceilings. Logout and logout-all remain
    explicit exemptions so an operator/customer can terminate sessions during compromise;
  - one shared outbound-fetch allowance covers URL import, brand enrichment, portfolio/oEmbed,
    YouTube refresh/ingest, organization lookup and hiring-identity verification. Switching
    endpoints does not create another allowance. Avatar/banner share a media allowance;
  - public deep search is IP-scoped; all 14 messaging mutations are user-scoped; all 33
    admin/support routes share one post-permission per-admin policy; existing job/import/review/
    marketplace and checkout policies move from caller IP to independently verified user;
  - every rate-limit dependency carries finite policy metadata. Tests read the actual FastAPI
    dependency graph, inventory all auth routes and protect future messaging/admin additions.
Security assumptions:
  user identity comes only from the existing verified bearer/durable-session dependency. The
  quota dependency never trusts a caller-supplied user/email/header. Admin quota is charged only
  after the permission key succeeds, while unauthorized callers still face the normal auth
  entry-point/IP controls. Anonymous reports remain intentionally IP-scoped. Production retains
  RATE-001's mandatory shared Redis/fail-closed posture; no process-local fallback was added.
  Redis keys contain only the existing caller IP or internal user UUID namespace, never email,
  token, URL, message, prompt or provider credential.
Tests run:
  cd backend && APP_ENV=test .venv/bin/python -m pytest -q \
    tests/test_endpoint_rate_limits.py tests/test_rate_limit.py \
    tests/test_trusted_client_identity.py
  cd backend && APP_ENV=test .venv/bin/python -m pytest -q \
    tests/test_auth_and_channels.py tests/test_auth_sessions.py \
    tests/test_admin_panel.py tests/test_support_tickets.py \
    tests/test_brand_about_endpoint.py tests/test_creator_profile_phase1.py \
    tests/test_profile_features.py tests/test_link_preview.py \
    tests/test_organization_page.py tests/test_deep_search.py \
    tests/test_marketplace_core.py tests/test_marketplace_withdraw.py \
    tests/test_messaging.py tests/test_interviews.py \
    tests/test_engagement_reviews.py tests/test_job_import_checkpoint.py \
    tests/test_job_import_readiness.py
  cd backend && .venv/bin/ruff check <all changed Python files>
  git diff --check
Exact results:
  quota/identity/route-policy focus                 48 passed / exit 0
  final endpoint-policy rerun after cleanup         8 passed / exit 0
  affected auth/admin/profile/search/marketplace/
    messaging/review/import matrix                 389 passed / exit 0
  changed-file Ruff                                all checks passed / exit 0
  git diff check                                   exit 0
Known external/environmental failures:
  no task-caused failure. Host load was already 45-60 and remained about 54, so Playwright and a
  redundant 52-minute full-backend aggregate were not started. The immediately preceding
  RATE-001 checkpoint's complete backend (7,499 passed/65 skipped) remains the broad baseline.
  Managed Redis provisioning/TLS/credentials/failover/alert delivery/cutover remain external.
Remaining risks:
  OF-105 still performs Google Places autocomplete/details in two Next routes with a fixed
  four-second abort but unbounded provider JSON/redirect behavior and no distributed user quota.
  RATE-003 cannot become VALIDATED until that surface is behind the shared boundary. RATE-004
  timeout/concurrency work and RATE-005 AI resource guards also remain open. No frontend,
  dependency, setting, service, migration, production provider or hosted system changed here.
Next phase:
  Phase 3L / OF-105 only. Inspect both Next location routes and existing authenticated Next-to-
  backend proxy patterns; implement a bounded provider client with Redis user quota and exact
  tests. Do not introduce an in-memory Next limiter. Then return to quiet-host Phase 13C QA.
Important commands:
  git status --short && git branch --show-current && git rev-parse HEAD && uptime
  rg -n 'places.googleapis.com|location/autocomplete|location/details' app backend tests
  cd backend && APP_ENV=test .venv/bin/python -m pytest -q \
    tests/test_endpoint_rate_limits.py tests/test_rate_limit.py \
    tests/test_trusted_client_identity.py
```

## Resumed Phase 3J checkpoint (RATE-001 — atomic shared admission)

```text
Phase: 3J — shared Redis rate-limit atomicity, lifecycle and real-service proof
Status: COMPLETE; RATE-001 VALIDATED locally. Managed Redis deployment remains external.
Initial HEAD: d8c948a2e7385c02fa403d8b318978bec7400f26
Final HEAD: resolve `git rev-parse HEAD`; this handoff is committed with the implementation
Commit(s): `security(rate-limit): make Redis admission atomic`
Files materially changed:
  backend/app/core/rate_limit.py; backend/app/main.py
  backend/pyproject.toml; backend/uv.lock; backend/.env.example
  backend/scripts/exercise_redis_rate_limit.py
  backend/tests/test_rate_limit.py; backend/tests/test_operational_metrics.py
  .github/workflows/ci.yml; .github/workflows/README.md
  tests/ciWorkflowContract.test.mjs; tests/incidentRunbooks.test.mjs
  DEPLOYMENT.md; docs/CREDENTIAL_ROTATION.md; docs/INCIDENT_RESPONSE.md
  docs/INCIDENT_TABLETOP.md; docs/OPERATIONS_ALERTS.md
  docs/PRODUCTION_READINESS_EXECUTION.md; docs/PRODUCTION_READINESS_HANDOFF.md
Migrations: none. Alembic remains one head at 0070_activity_page_indexes; configured local
  SQLite remains unversioned. The Phase 13A disposable PostgreSQL proof remains authoritative.
Behavior changed:
  - one Lua EVAL now removes expired admissions, counts, admits/rejects, computes retry time and
    attaches expiry under one Redis linearization point. Redis server time prevents instance
    clock skew, and a UUID makes every simultaneous admission a distinct member;
  - redis-py 8.1.0 is a shipped runtime dependency, with bounded one-second connect/command
    timeouts, retry-on-timeout disabled and explicit RESP2 for the supported Redis 7.2/7.4 line;
  - a configured shared limiter is probed before the application performs startup work. Invalid
    or unavailable Redis refuses startup; a later outage returns a generic 503 and never silently
    grants a separate process-local allowance; shutdown closes the client pool;
  - CI starts exact Redis 7.4.11 and runs the same standalone contention exercise used locally.
    Its URL parser accepts only explicit loopback Redis/Rediss targets, so it cannot be aimed at a
    hosted or production service.
Security assumptions:
  production multi-instance limiting uses RATE_LIMIT_BACKEND=redis. Memory remains a deliberate
  local/dev or explicitly acknowledged single-instance mode, never an outage fallback. Redis is
  treated as a mandatory production security dependency. The public 503, startup error and test
  command never echo a Redis URL, credentials, keys or provider exception. Hosted TLS, network
  policy, credentials, failover, alert delivery and incident response still require the selected
  managed service and are not inferred from loopback proof.
Tests run:
  cd backend && APP_ENV=test .venv/bin/python -m pytest -q
  cd backend && APP_ENV=test .venv/bin/python -m pytest -q <RATE/config/metric/package focus>
  cd backend && .venv/bin/python -m ruff check app tests scripts
  cd backend && .venv/bin/uv lock --check
  cd backend && .venv/bin/python -m scripts.audit_production_dependencies
  cd backend && .venv/bin/python -m alembic heads
  cd backend && .venv/bin/python -m alembic current
  RATE_LIMIT_TEST_REDIS_URL=redis://127.0.0.1:56380/15 \
    .venv/bin/python -m scripts.exercise_redis_rate_limit  # twice, while service existed
  node --test tests/incidentRunbooks.test.mjs tests/ciWorkflowContract.test.mjs \
    tests/credentialRotation.test.mjs
  node --test tests/*.test.mjs
  git diff --check
Exact results:
  complete backend                                         7,499 passed / 65 skipped /
                                                           71 warnings / 52m05s
  RATE/config/metric/packaging focus                       153 passed / 1 skipped /
                                                           5 warnings
  real Redis 7.4.11 exercise, run 1                        17 allowed / 183 rejected / exit 0
  real Redis 7.4.11 exercise, run 2                        17 allowed / 183 rejected / exit 0
  focused frontend runbook/workflow/credential contracts  23/23
  frontend Node aggregate                                  1,292/1,292 / exit 0
  whole-backend Ruff                                       all checks passed / exit 0
  uv lock check                                            64 packages resolved / exit 0
  production-only backend audit                            1 analysed ecdsa residual,
                                                           0 unanalysed / exit 0
  Alembic heads/current                                    one head 0070 / SQLite unversioned
  git diff check                                           exit 0
Known external/environmental failures:
  Docker Desktop was installed but its daemon was unavailable. The real proof therefore built
  the official Redis 7.4.11 source archive exposed by the official image layer after verifying
  SHA-256 e973da69febfea096ab94690b44bf976482788a1b5e070df373b4f27697d57d4. It was
  bound only to loopback with persistence disabled, stopped after the exercise, and its 49 MiB
  temporary build was moved recoverably to
  /Users/guhanpurushothaman/.Trash/creatorjobs-rate-limit.8BMPSt. No test service remains.
  Exact production-only syncs were also disposable: the Python 3.12 proof (53 distributions,
  284 MiB) is recoverable at
  /Users/guhanpurushothaman/.Trash/creatorjobs-prod312-sync.8y9FOX; an earlier Python 3.14
  cross-check is at /Users/guhanpurushothaman/.Trash/creatorjobs-prod-sync.qrytI0 and the hashed
  export scratch directory is at /Users/guhanpurushothaman/.Trash/creatorjobs-prod-export.keS1Gr.
  GitHub-hosted CI, managed Redis provisioning/credentials/TLS/failover/alerts and production
  incident or credential-cutover drills have not run. No hosted system was contacted.
Remaining risks:
  RATE-003 endpoint coverage, RATE-004 timeout/concurrency protection and RATE-005 AI resource
  guards remain open. RATE-001 is now their validated shared admission primitive. A managed Redis
  service remains required before customer traffic. CERT-001 still needs the quiet-host QA
  aggregate and unavailable Gitleaks/built-image scans.
Next phase:
  Check host load. On a quiet host, resume Phase 13C with the QA aggregate alone. While load is
  abnormal, RATE-003 is the next bounded locally implementable security slice.
Important commands:
  git status --short && git branch --show-current && git rev-parse HEAD && uptime
  rg -n 'Depends\(rate_limit|rate_limit\(' backend/app backend/tests
  cd backend && APP_ENV=test .venv/bin/python -m pytest -q tests/test_rate_limit.py
  npm run test:e2e:qa  # alone, only when host load is quiet
```

WHY THE ASSERTION CHANGE IS CORRECT: `tests/incidentRunbooks.test.mjs` used to require a sentence
that the current Redis limiter was non-atomic. Keeping that assertion after closing the race would
make the operational gate demand a false statement. The replacement requires both sides of the
new contract: explicit real local atomic proof and explicit hosted credential/failover/drill truth.

## Phase 13B checkpoint (CERT-001 — browser/security repair and quiet-host triage)

```text
Phase: 13B — browser certification repair, production-audit correction and failure isolation
Status: COMPLETE atomic repair/triage slice; CERT-001 remains IN_PROGRESS
Initial HEAD: e46f6c8b79024cfefbb3c20bef8261122a09f606
Final HEAD: resolve `git rev-parse HEAD`; this handoff is committed with the repair
Commit(s): `fix(certification): harden browser and dependency gates`
Files materially changed:
  components/you/ApplicationsWorkspace.tsx; components/you/CompactChatDock.tsx
  lib/realtimeMessaging.ts; lib/repositories/jobRepository.ts; lib/jobs.ts
  backend/app/db/seed_data_jobs.py
  backend/scripts/audit_production_dependencies.py
  backend/security/pip-audit-allowlist.json
  backend/tests/test_demo_job_seed.py; backend/tests/test_production_dependency_audit.py
  tests/realtimeMessaging.test.mjs; tests/demoJobMarketplace.test.mjs
  tests/ciWorkflowContract.test.mjs
  tests/e2e/qa/draft-assistant.spec.ts; tests/e2e/qa/qa-personas.spec.ts
  tests/e2e/qa/requirements-recruiter-order.spec.ts
  tests/e2e/qa/workspace-next-action.spec.ts
  .github/workflows/security.yml; .github/workflows/README.md
  docs/PRODUCTION_READINESS_EXECUTION.md; docs/PRODUCTION_READINESS_HANDOFF.md
Migrations: none. Alembic remains one head at 0070_activity_page_indexes. The Phase 13A
  disposable PostgreSQL proof remains empty -> 0070 -> 0038 -> fixture -> 0070 and 29/29.
Behavior changed:
  - a live Star click whose row has not loaded a conversation now resolves the participant-
    authorised conversation before optimistic paint, awaits the durable PUT, rolls back failure,
    survives reload and remains private to each participant;
  - the browser no longer synthesises a second `connected` event beside the authenticated server
    handshake, and adaptive polling consults a ref so connection-state paint cannot tear down and
    immediately restart every polling effect. The measured first-load request profile fell from
    profile 1/activity 3/conversations 4/preferences 1/interviews 3/engagements 3 to
    profile 1/activity 2/conversations 2/preferences 1/interviews 2/engagements 2;
  - absent demo employer media stays absent and uses the existing initials fallback instead of
    fetching a random third-party image;
  - the Python production audit now evaluates a hashed `--no-dev` lock export rather than the
    active developer environment. One exact evidence-bound ecdsa residual is accepted only while
    its package/version/advisory aliases and executable HMAC-only evidence all match.
  Five QA assertions were corrected without weakening product contracts: the assistant waits for
  a real supported answer control instead of sampling between turns; the workspace selects the
  actionable Priya record after intentionally visiting an empty mode; recruiter answers target
  the API-established record rather than activity-order row one; and messaging/Star assertions
  wait for the legitimate New -> Viewed open transition before proving those actions do not mutate
  lifecycle. Star durability now waits for the PUT acknowledgement rather than optimistic paint.
Security assumptions:
  the ecdsa advisory affects asymmetric signing/key generation/key agreement while CreatorJobs
  structurally allows only HS256/384/512; verification is not affected. The allowlist is exact and
  evidence-bearing, and new, changed, unanalysed or stale findings fail. There is no
  `--ignore-vuln`, severity threshold, timeout increase, sleep, skipped test or relaxed assertion.
  Conversation resolution and preference writes remain backend-authorised for participants.
Tests run:
  node --test tests/*.test.mjs
  npx tsc --noEmit
  npm run lint
  npm run build
  cd backend && .venv/bin/python -m ruff check app tests scripts
  cd backend && APP_ENV=test .venv/bin/python -m pytest -q
    tests/test_demo_job_seed.py tests/test_production_dependency_audit.py
  cd backend && .venv/bin/python -m scripts.audit_production_dependencies
  npm run audit:production
  npm run test:e2e
  npm run test:e2e:qa
  npm run test:e2e:a11y
  npm run test:e2e:synthetics
  focused unchanged reruns for all named browser failures
  frontend/backend SBOM generation and source-level container-hardening checks
  git diff --check
Exact results:
  frontend Node aggregate                                  1,291/1,291 / exit 0
  TypeScript                                               exit 0
  ESLint                                                   0 errors, 32 existing warnings
  Next production build                                    exit 0; 32/32 static pages
  whole-backend Ruff                                       all checks passed / exit 0
  backend seed/audit focus                                 12/12
  production-only backend audit                            1 analysed ecdsa residual,
                                                           0 unanalysed / exit 0
  frontend production audit                               0 analysed high/critical,
                                                           0 unanalysed / exit 0
  frontend CycloneDX/backend hashed export                 39 components / 53 rows
  container hardening source contract                      22/22
  accessibility aggregate                                  87/87 / 9.6m
    Chromium / Firefox / WebKit                            29/29 each
  six owned synthetics                                     6/6 / 2.7m
  standard Playwright aggregate                            502 passed, 2 host-load timeouts
  exact unchanged standard failures                        both passed; timestamp 10/10;
                                                           broader affected set 45/45
  real-backend QA aggregate                                256 passed, 35 failed, 1 skipped /
                                                           1.9h under load roughly 49-57
  unchanged focused QA cases cleared                       22 of the 35
Known external/environmental failures:
  the local Docker CLI could not reach a daemon; Gitleaks, Trivy and Syft are unavailable, so
  full-history secret scanning and a real immutable-image build/scan did not run. QA encountered
  repeated Next `destination stream closed early` errors and request/global budget exhaustion on
  a host dominated by user-owned Visual Studio Code/Electron processes. Those processes were not
  killed, reniced or modified.
Remaining risks:
  a quiet-host full QA aggregate is still required. The desktop Shine fixture reproducibly reaches
  the safe recoverable backend-unavailable state when its local POST exhausts the unchanged
  30-second client budget; mobile passes once the backend is warm. Four grouped persona cases
  exhausted their unchanged 45-second global budget; the exact Hired case completed hire, reload,
  cross-persona and Pipeline assertions before its final logout/relogin timed out. Eight late QA
  persona timeouts remain to isolate. Full-history Gitleaks and a built-image scan remain external.
Next phase:
  Phase 13C — wait for a quiet host, run `npm run test:e2e:qa` alone, isolate only genuine
  remaining failures, then run unavailable supply-chain/image gates in a suitable environment.
Important commands:
  git status --short && git branch --show-current && git rev-parse HEAD && uptime
  npm run test:e2e:qa
  npx playwright test -c playwright.qa.config.ts <file> --workers=1 --grep '<exact title>'
  npm run audit:production
  cd backend && .venv/bin/python -m scripts.audit_production_dependencies
```

NO FAILURE WAS PAPERED OVER: every changed browser assertion now identifies the canonical record
or waits for the real state transition it claims to test. Product waits, client request budgets,
global test budgets and retry semantics are unchanged. The unresolved QA cases remain recorded,
so CERT-001 is not promoted.

## Phase 13A checkpoint (CERT-001 — complete non-browser application and migration gates)

```text
Phase: 13A — whole-repository static, unit, backend, Ruff, build and PostgreSQL certification
Status: COMPLETE atomic slice; CERT-001 remains IN_PROGRESS pending browser/scans/focused matrix
Initial HEAD: 293bc4612795f712d2517f6ae929afe30e43758f
Final HEAD: resolve `git rev-parse HEAD`; this handoff is committed with the repair
Commit(s): `chore(certification): clear backend static gate`
Files materially changed:
  16 historical Alembic modules from 0034 through 0049: import ordering only; revision IDs,
    lineage and upgrade/downgrade bodies unchanged
  19 backend app modules: safe import/typing/UTC cleanup plus reviewed lint repairs
  23 backend test/support modules: safe import/unused cleanup plus exact exception assertion
  backend/tests/test_import_compound_applications.py
  backend/tests/test_job_application_instructions.py
  docs/PRODUCTION_READINESS_EXECUTION.md; docs/PRODUCTION_READINESS_HANDOFF.md
Migrations: none. Existing migration modules received import-order formatting only. Alembic has one
  head, 0070_activity_page_indexes. Configured SQLite current is unversioned. The disposable
  PostgreSQL harness upgraded empty -> 0070, downgraded to 0038, loaded the historical fixture,
  re-upgraded to 0070, and cleaned its compose container/network/volume on exit.
Behavior changed:
  no product behavior changed. Ruff-safe edits sort imports, remove unused imports/variables,
  replace timezone.utc with the equivalent UTC alias, unquote modern annotations and remove
  placeholder-free f-strings. Reviewed edits rename ambiguous local variables, preserve truncating
  zip behavior explicitly with strict=False, preserve the public idempotency conflict while hiding
  the internal IntegrityError chain, and make one constraint test expect IntegrityError rather than
  every Exception. Two deadline tests now use 2099 rather than an elapsed 2026 timestamp; their
  assertions and production deadline behavior are unchanged.
Security assumptions:
  no lint repair relaxes an authorization, cryptographic, validation, migration or error boundary.
  Exact elapsed timestamps remain invalid; date-only imports still normalize to end-of-day. The
  PostgreSQL harness targets only the repository's dedicated loopback test service and never a
  hosted database. No warning was suppressed and no test was skipped or weakened.
Tests run:
  cd backend && .venv/bin/python -m ruff check .
  cd backend && APP_ENV=test .venv/bin/python -m pytest
  cd backend && APP_ENV=test .venv/bin/python -m pytest -q
    tests/test_import_compound_applications.py tests/test_job_application_instructions.py
  cd backend && .venv/bin/python -m alembic heads
  cd backend && APP_ENV=test .venv/bin/python -m alembic current
  cd backend && ./scripts/test_interaction_status_postgres.sh
  npx tsc --noEmit
  npm run lint
  node --test tests/*.test.mjs
  npm run build
  git diff --check
Exact results:
  initial whole-backend Ruff                                83 visible findings / exit 1
  final whole-backend Ruff                                  all checks passed / exit 0
  first complete backend aggregate                          7,474 passed, 65 skipped,
                                                           2 failed, 71 warnings / 44:01
  exact two-file deadline isolation after fixture repair    85 passed / 24.5s
  final complete backend aggregate                          7,476 passed, 65 skipped,
                                                           71 warnings / 46:34
  Alembic heads                                             0070_activity_page_indexes (head)
  Alembic current                                           SQLite context, no revision printed
  disposable PostgreSQL migration/auth/session/interaction 29/29 / exit 0
  TypeScript                                                exit 0
  ESLint                                                    0 errors, 32 existing warnings
  frontend Node aggregate                                   1,289/1,289 / 37.3s
  Next production build                                     exit 0; 32/32 static pages
Known external failures: none in this slice. Docker was initially stopped; Docker Desktop 29.2.0
  was started locally so the dedicated PostgreSQL harness could run. The harness removed its own
  container, network and volume. No hosted database, Neon, Vercel, Render or provider was touched.
Remaining risks: CERT-001 still requires serial standard Playwright, real-backend QA,
  three-engine accessibility, six-journey synthetic, security/dependency, storage, rate-limit,
  realtime, privacy/admin/metadata and remaining certification gates. OPS-005 remains IMPLEMENTED
  until a quiet-host synthetic 6/6. Thirty-two ESLint warnings and 71 backend deprecation warnings
  are recorded technical debt, not hidden errors; evaluate them separately rather than changing
  Phase 13 assertions opportunistically.
Next phase: Phase 13B — serial browser certification, starting with `npm run test:e2e`, then QA,
  accessibility and synthetics. Never share `.next` between concurrent build/browser processes.
Important commands:
  git status --short && git branch --show-current && git rev-parse HEAD
  npm run test:e2e
  npm run test:e2e:qa
  npm run test:e2e:a11y
  npm run test:e2e:synthetics
```

RERUN TRUTH: the first full backend failure was not hidden. Both failing tests used
2026-08-31T00:00:00Z as a future deadline; on 2026-08-31 that exact instant had elapsed. The
application correctly discarded it. Only the future fixture instant moved to 2099, the original
assertions stayed, both complete files passed, and a second full aggregate proved 7,476/7,476
non-skipped tests green.

## Phase 12E checkpoint (OPS-007 — rotate without exposing or pretending to revoke)

```text
Phase: 12E — credential inventory, planned overlap, and disposable local rehearsal
Status: COMPLETE; OPS-007 VALIDATED locally, every live/provider rotation remains external
Initial HEAD: a837019d02bf8d8be7648a05d94869777159a45d
Final HEAD: resolve `git rev-parse HEAD`; this handoff is committed with the implementation
Commit(s): `ops(credentials): make secret rotation rehearsable`
Files materially changed:
  docs/CREDENTIAL_ROTATION.md; docs/INCIDENT_RESPONSE.md
  tests/credentialRotation.test.mjs; tests/imageDeliverySecurity.test.mjs
  next.config.ts; .env.example
  backend/app/core/config.py; backend/app/core/config_contract.py
  backend/app/api/v1/routers/auth.py; backend/app/api/v1/routers/email_webhooks.py
  backend/app/services/email_webhook_signature.py
  backend/scripts/rotate_strong_auth_secrets.py
  backend/tests/test_rotate_strong_auth_secrets.py; backend/tests/test_config.py
  backend/tests/test_google_oauth_scope_disconnect.py
  backend/tests/test_email_suppression.py; backend/tests/conftest.py
  docs/PRODUCTION_READINESS_EXECUTION.md; docs/PRODUCTION_READINESS_HANDOFF.md
Migrations: none. Alembic remains 0070_activity_page_indexes, one head.
Behavior changed:
  - planned Google credential-authority exchange accepts current plus one backend-only previous
    secret; frontend always sends current; removing previous makes old requests fail 401 again;
  - planned email webhook rotation accepts current plus one previous HMAC secret; current remains
    mandatory, replay/freshness behavior is unchanged, and old fails after retirement;
  - production frontend boot requires >=32-character NEXTAUTH_SECRET and
    GOOGLE_OAUTH_EXCHANGE_SECRET; backend production boot rejects short CreatorJobs-owned
    JWT/webhook/unsubscribe secrets, previous-without-current and same-value fake overlap;
  - operators can dry-run or apply bounded/resumable TOTP factor rewrap under a new AES-GCM key.
  No existing/customer factor seed, OAuth grant, provider credential, live session, hosted setting
  or customer row was read or changed in this phase; only disposable local fixtures were decrypted.
Security assumptions:
  previous-secret overlap is planned maintenance only. A credibly compromised old value must not
  remain accepted. The TOTP command proves authenticated decryption before any rewrite, locks rows
  in apply mode, commits bounded batches, fails closed when an old key is absent, and emits only the
  active key ID plus counts. Rewrapping a TOTP seed or provider token does not revoke knowledge an
  attacker may already have; factor re-enrollment or provider grant revocation remains mandatory.
Tests run:
  APP_ENV=test .venv/bin/python -m pytest tests/test_config.py
    tests/test_config_contract.py tests/test_rotate_strong_auth_secrets.py
    tests/test_rotate_oauth_credentials.py tests/test_google_oauth_scope_disconnect.py
    tests/test_email_suppression.py -q
  APP_ENV=test .venv/bin/python -m pytest tests
    -k 'auth or oauth or google or email or config or unsubscribe or notification' -q
  node --test tests/credentialRotation.test.mjs tests/imageDeliverySecurity.test.mjs
    tests/incidentRunbooks.test.mjs
  npx tsc --noEmit
  npm run lint
  npm run build
  .venv/bin/python -m ruff check [all changed Python]
  git diff --check
Exact results:
  focused backend rotation/config/security                     165 passed, 1 skipped
  broad auth/OAuth/Google/email/config regression              600 passed, 16 skipped
                                                               6,925 deselected
  credential/image/incident frontend contract                 16/16
  TypeScript                                                   exit 0
  ESLint                                                       0 errors, 32 existing warnings
  Next production build                                        exit 0; 32 static pages generated
  changed Python Ruff                                          exit 0
  expected backend collection                                  7,541
  expected frontend node collection                            1,289
Known external failures: no Google/provider key, database/Redis/SMTP credential, NextAuth/JWT
  hosted secret, CI/hosting permission, physical TOTP factor, object-store credential, production
  config or customer session was rotated. No hosted overlap deploy, real login/refresh/revoke,
  signed delivery event or provider retirement was exercised. All remain BLOCKED_EXTERNAL.
Remaining risks: routine rotation of UNSUBSCRIBE_TOKEN_SECRET would invalidate non-expiring links;
  current templates do not emit them, and a versioned keyring is required before routine rotation
  after links ship. Real object-storage credentials do not exist because MEDIA-001 remains open.
  OPS-005 still needs a quiet-host 6/6 synthetic aggregate and live alert delivery. Whole-backend
  Ruff's previously observed 67 findings and every complete aggregate are Phase 13 work.
Next phase: Phase 13A / CERT-001 complete local certification. Begin with whole frontend/backend
  static and unit gates plus PostgreSQL migration evidence, repair only reproduced certification
  failures, then run browser suites serially against one owned `.next` build.
Important commands:
  git status --short && git branch --show-current && git rev-parse HEAD
  cd backend && .venv/bin/python -m alembic heads
  npx tsc --noEmit && npm run lint && node --test tests/*.test.mjs && npm run build
  cd backend && APP_ENV=test .venv/bin/python -m pytest
```

INVENTORY SHAPE: 18 families cover application signing, shared service proof, provider clients,
stored OAuth grants, encrypted TOTP factors, database, Redis, SMTP/webhooks, unsubscribe signing,
AI/API keys, CI/hosting/storage and user-scoped one-time/rotating credentials. Each row names its
authority, declaration, enforcement, consumer, rotation mode, local evidence and external stop.

ROTATION TRUTH: planned overlap and compromise are opposite procedures. Google exchange and email
webhook previous values exist only so independently controlled producers can switch without an
outage. Compromise uses current only. Keyring rewrap preserves availability and lets an old wrapping
key retire; it cannot undo disclosure of plaintext. Machine checks pin both statements and forbid
credential-bearing/destructive command blocks.

## Phase 12D checkpoint (OPS-006 — specific containment, not a generic essay)

```text
Phase: 12D — incident runbooks and local no-provider tabletop
Status: COMPLETE; OPS-006 VALIDATED locally, live/human/provider drills remain external
Initial HEAD: 0e73c1e648b11201db0a2bd60752d8df9382caab
Final HEAD: resolve `git rev-parse HEAD`; this handoff is committed with the implementation
Commit(s): `ops(runbooks): make incident containment executable`
Files materially changed:
  docs/INCIDENT_RESPONSE.md; docs/INCIDENT_TABLETOP.md
  docs/NOTIFICATIONS.md
  tests/incidentRunbooks.test.mjs
  backend/app/core/config.py; backend/app/core/config_contract.py
  backend/app/notifications/email.py; backend/app/notifications/registry.py
  backend/app/notifications/service.py
  backend/scripts/grant_admin.py; backend/tests/test_grant_admin.py
  docs/PRODUCTION_READINESS_EXECUTION.md; docs/PRODUCTION_READINESS_HANDOFF.md
Migrations: none. Alembic remains 0070_activity_page_indexes, one head.
Behavior changed: the sanctioned administrator role-revocation command now locks the target,
  demotes it, revokes every durable session family/refresh credential, and appends a bounded
  actor-less operator audit event in one transaction. Grant also records the role transition.
  No customer-facing route, workflow, provider behavior, backup or deployment changed.
  Operator-facing configuration and notification documentation now match the executable shared
  outbox contract: the delivery gate controls real auth and notification sends together, and a
  worker restart is required because provider selection occurs at process startup.
Security assumptions: database/operator access controls identify the human running grant_admin;
  actor_user_id is intentionally null because the operator need not be a CreatorJobs user. The
  audit JSON contains only before/after account type and bounded revoked-session count, never the
  email or a credential. User-first then session locks match existing auth security-event ordering.
  Demotion stops current DB-backed permission checks; durable revocation stops persistent-family
  access. A temporary claimless migration JWT cannot be selectively revoked and remains ordinary
  access until its production-capped expiry unless a separate assured admin suspends the demoted
  account or a coordinated global signing-secret rotation invalidates it.
Tests run:
  node --test tests/incidentRunbooks.test.mjs
  APP_ENV=test .venv/bin/python -m pytest tests/test_grant_admin.py -q
  APP_ENV=test .venv/bin/python -m pytest tests/test_grant_admin.py
    tests/test_admin_audit_integrity.py -q
  APP_ENV=test .venv/bin/python -m pytest tests/test_config_contract.py
    tests/test_config.py tests/test_grant_admin.py tests/test_admin_audit_integrity.py -q
  APP_ENV=test .venv/bin/python -m pytest [16 incident-control files] -q
  .venv/bin/ruff check app/core/config.py app/core/config_contract.py
    scripts/grant_admin.py tests/test_grant_admin.py
  git diff --check
Exact results:
  incident runbook/tabletop contract                         5/5
  emergency revoke/grant behavior                            2/2
  revoke/grant plus append-only audit integrity              15/15
  configuration/operator-contract focus                      120 passed, 1 skipped
  alert/health/auth/admin/email/AI/media/realtime/release     281/281
  changed Python Ruff                                        exit 0
  expected backend collection                                7,530
  expected frontend node collection                          1,284
Known external failures: no hosted alert, traffic shift, immutable artifact rollback, PostgreSQL
  or media restore, RPO/RTO measurement, real Redis/realtime recovery, provider outage/revocation,
  customer communication, physical-factor recovery, operator acknowledgement or live credential
  was exercised. The repository tabletop says this in its title, method, every external stop and
  findings. No customer/hosted data or paid provider was used.
Remaining risks: OPS-001/002 backup/restore remain BLOCKED_EXTERNAL. OPS-005 remains IMPLEMENTED
  until the six tagged synthetics pass together on a quiet host and live alert delivery is proven.
  OPS-007 must inventory and locally rehearse credential rotation without touching live secrets.
  The runbook command assumes a trusted second database operator; operational identity/approval
  and a human tabletop remain external. A production maintenance/read-only switch does not exist;
  data-loss write isolation is correctly named as an infrastructure action rather than invented.
Next phase: Phase 12E / OPS-007 credential rotation. Inventory each secret and classify whether it
  supports overlap/rewrap, requires coordinated redeploy/global logout, or is provider-owned.
Important commands:
  git status --short && git branch --show-current && git rev-parse HEAD
  cd backend && .venv/bin/python -m alembic heads
  cd backend && .venv/bin/python -m scripts.rotate_oauth_credentials  # dry-run only
  rg -n 'SecretStr|SECRET|KEYS|TOKEN|PASSWORD|DATABASE_URL|REDIS_URL' \
    backend/app/core .env.example lib app
```

TABLETOP SCOPE: the 11 decision cards cover rollback, bad migration, compromised customer/admin,
database/media loss, abuse/shared limiter failure, email, AI, realtime and Google/YouTube. A card
passes only when it identifies the smallest safe first decision, a real application control, what
private evidence not to collect, verification, and the exact external stop. Machine tests require
all five ledger classes and the six-stage runbook shape, check control source after stripping
comments/docstrings, and forbid destructive shortcuts or live-credential shapes in code blocks.

CONCRETE DEFECT FOUND: grant_admin --revoke changed account_type only. Because permission checks
read current database state, admin authorization stopped, but every session remained valid and the
stolen browser continued as a normal authenticated customer. The smallest coherent correction is
inside the sanctioned revoke transaction. Removing the session-revocation call makes the behavioral
test fail; the fix is not documentation-only.

## Phase 12C checkpoint (OPS-005 — finite alerts and owned no-cost synthetics)

```text
Phase: 12C — actionable provider-neutral alerts and canonical synthetic journeys
Status: COMPLETE implementation boundary; OPS-005 remains IMPLEMENTED pending a quiet-host 6/6
  browser aggregate and external delivery proof
Initial HEAD: 8107f143424bd82d4d1ac6d196f05c5040188b8c
Final HEAD: resolve `git rev-parse HEAD`; this handoff is committed with the implementation
Commit(s): `ops(alerts): add finite policies and local synthetics`
Files materially changed:
  backend/app/core/operational_alerts.py
  backend/scripts/evaluate_operational_alerts.py
  backend/tests/test_operational_alerts.py
  docs/OPERATIONS_ALERTS.md
  package.json
  tests/operationalSynthetics.test.mjs
  tests/e2e/qa/applicant-requirements.spec.ts
  tests/e2e/qa/brand-about-candidate.spec.ts
  tests/e2e/qa/deep-search.spec.ts
  tests/e2e/qa/qa-personas.spec.ts
  tests/e2e/qa/workspace-next-action.spec.ts
  docs/PRODUCTION_READINESS_EXECUTION.md; docs/PRODUCTION_READINESS_HANDOFF.md
Migrations: none. Alembic remains 0070_activity_page_indexes, one head; the configured local
  APP_ENV=test SQLite has no stamped current revision.
Behavior changed: operators or a future provider adapter can stream JSONL logs through one finite
  policy and receive at most one static alert per key per input batch. The evaluator exits 2 when
  it selects an alert and 0 otherwise. Existing QA tests now carry exactly one tag for each auth,
  browse, publish, apply, message and admin operational journey; the package entry point selects
  those six under the existing real-backend serial harness. Product workflows and test assertions
  are unchanged.
Security assumptions: only known finite error/metric values or exact pre-existing static messages
  may select an alert. The policy output is static except for a 1..1,000,000,000 count and cannot
  copy a request ID, route, exception/provider text, URL, identity, content or arbitrary label.
  Alert delivery is not in-process and cannot fail a customer request. The publish synthetic uses
  the deterministic test-only probe; no selected test can be the live-provider import smoke. The
  QA controller and canonical scenario restore remain APP_ENV=test-only and the disposable SQLite
  store remains isolated from hosted data.
Tests run:
  APP_ENV=test .venv/bin/python -m pytest tests/test_operational_alerts.py
    tests/test_operational_metrics.py tests/test_error_reporting.py -q
  .venv/bin/ruff check app/core/operational_alerts.py
    scripts/evaluate_operational_alerts.py tests/test_operational_alerts.py
  node --test tests/operationalSynthetics.test.mjs
  npx playwright test -c playwright.qa.config.ts --grep @synthetic: --list
  npx eslint [the five tagged QA files] tests/operationalSynthetics.test.mjs
  npx tsc --noEmit
  two `npm run test:e2e:synthetics` attempts under the recorded saturated host
  .venv/bin/python -m alembic heads; APP_ENV=test .venv/bin/python -m alembic current
  git diff --check
Exact results:
  alert + metric + error-reporting backend suites           27/27
  new alert-policy suite alone                                8/8
  synthetic selector contract                                3/3
  Playwright selector listing                                6/6 in five files
  changed frontend ESLint                                    exit 0
  TypeScript                                                 exit 0
  changed backend Ruff                                       exit 0
  Alembic heads                                               one: 0070_activity_page_indexes
  Alembic current                                             no revision printed; local SQLite unstamped
  browser attempt 1                                           4 passed / 2 failed in 5.3m
  browser attempt 2                                           2 passed / 4 failed in 6.6m
Known environmental failures: unrelated user-owned VS Code/Electron processes held sustained CPU
  and drove load from roughly 50 to 76. Attempt one passed publish, browse, auth and admin while the
  initially broader existing apply/message choices reached the unchanged 45-second ceiling. Tags
  were moved to narrower existing tests without changing any body, assertion, sleep or timeout.
  Attempt two passed browse/auth; apply reached its final session read after UI submission, publish
  timed out after having passed attempt one, admin timed out in login after having passed attempt
  one, and message did not finish its unchanged 12-second send expectation. At checkpoint time load
  remained 53.89 / 65.15 / 60.61. No editor/user process was killed, reniced or modified. This is
  not recorded as a green browser gate; rerun the exact six together when the host is quiet.
Known external failures: no live log drain, retention/access policy, alert destination, page
  acknowledgement, worker-death detector, scheduled staging synthetic or staging data cohort was
  configured or exercised. No evidence-based traffic/latency/capacity thresholds or 72-hour soak
  exists. No hosted service, provider credential or paid model was used.
Remaining risks: OPS-005 cannot become VALIDATED until the current tagged aggregate is 6/6 on a
  quiet host and the production consumer/destination is exercised. Absence-of-signal monitoring is
  required for the email worker and import sweeper because an event-only rule cannot detect a dead
  process. Queue depth/oldest-age needs a real production consumer/source; this phase does not infer
  it from worker-pass noise. CERT-002/OPS-008 own live delivery and soak evidence.
Next phase: Phase 12D / OPS-006 incident runbooks and local tabletop contracts. Inventory the
  existing rollback, session-compromise, data-recovery, abuse, email, storage, Redis, realtime,
  Google and AI recovery material before writing; make destructive/provider steps approval-gated.
Important commands:
  git status --short && git branch --show-current && git rev-parse HEAD
  cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_operational_alerts.py -q
  cd backend && .venv/bin/python -m alembic heads
  npm run test:e2e:synthetics  # only on a quiet host; expect exactly six tests
  rg -n 'rollback|incident|compromise|restore|rotation|outage|abuse|runbook' docs DEPLOYMENT.md backend
```

WHY THE ROW IS IMPLEMENTED, NOT VALIDATED: source registration and tests prove that every alert key
has a producer, policy, executable consumer and specific response path. They do not prove a real log
provider retained an event, sent a page, or received an acknowledgement. Likewise, discovery proves
the six canonical browser contracts are selected, but the two aggregate runs did not finish green.
The status deliberately preserves that distinction instead of turning host saturation into success.

WHY NO TRAFFIC THRESHOLDS WERE INVENTED: there is no production traffic distribution, capacity plan
or error budget to justify a numeric 5xx/latency/rate threshold. The local rules cover hard discrete
failure states. Deployment owners must derive aggregate thresholds from an isolated staging soak and
early controlled-cohort measurements, document the evidence, and then test each destination.

## Phase 12B checkpoint (OPS-004 — useful signals, finite labels, every process)

```text
Phase: 12B — privacy-bounded operational metrics and request correlation
Status: COMPLETE
Initial HEAD: 85152961a995c9d8182441d00d18bcf40e76cde8
Final HEAD: resolve `git rev-parse HEAD`; this handoff is committed with the implementation
Commit(s): `ops(metrics): emit privacy-bounded operational signals`
Files materially changed:
  backend/app/core/operational_metrics.py; backend/app/core/logging.py
  backend/app/middleware/operational_metrics.py; backend/app/middleware/request_id.py
  backend/app/main.py; backend/app/core/error_reporting.py
  backend/app/health/service.py; backend/app/core/rate_limit.py
  backend/app/notifications/worker.py; backend/app/notifications/runner.py
  backend/app/realtime/manager.py; backend/app/services/job_import_processing_service.py
  backend/tests/test_operational_metrics.py
  docs/PRODUCTION_READINESS_EXECUTION.md; docs/PRODUCTION_READINESS_HANDOFF.md
Migrations: none. Alembic remains 0070_activity_page_indexes, one head.
Behavior changed: every HTTP response emits a finite status/duration/count event using only the
  matched framework route template; auth, avatar/banner upload and AI-import routes receive finite
  subsystem labels. Database health probes, Redis rate-limit decisions/failures, claimed email work
  and outcomes, realtime publish success/failure and AI provider success/failure/cancellation emit
  the same schema. Idle email polls deliberately emit nothing. Metric transport failure is swallowed.
  Caller X-Request-ID is preserved only when it is a canonical UUID; every other value is replaced
  by a server UUID and that value is returned in X-Request-ID.
Security assumptions: structured stdout is still a transport, not proof of live aggregation. Only
  app.core.operational_metrics may construct a metric event. The formatter independently requires a
  known name/subsystem/outcome and copies only bounded count/duration/status, a standard HTTP method
  and a canonical matched route. No helper accepts email, user/account ID, message/job/AI text,
  event/draft ID, provider error, arbitrary URL or arbitrary dimension map. Numeric observations are
  measurements, not labels. Request IDs are unique correlation fields and canonical UUIDs only.
  The middleware sits inside RequestID and outside RequestBodyLimit, so an early 413 is observed and
  the metric log still carries the exact response correlation UUID. No external tracing provider is
  required for local boot. The existing Redis limiter remains non-atomic under RATE-001; measuring
  it does not make that blocker safe or validated.
Tests run: listed below; all pytest processes were serial against the shared test database.
Exact results:
  new operational telemetry suite                       14/14
  telemetry plus Phase 12A error security               19/19
  request/error/body-boundary focus                     43/43
  affected subsystem matrix authoritative rerun         236/236
  auth/session/Google/strong-auth/request-ID matrix      104/104
  unchanged child-import probe isolated                 1/1; fixed 10s child timeout unchanged
  changed-file Ruff                                     exit 0
  full backend collection                               7,520 (Phase 12A 7,506 + 14)
  full backend attempt under host load                  INTERRUPTED after observed failure:
                                                        121 passed / 5 skipped / 1 failed
                                                        in 317.47s
  git diff --check                                      exit 0
Task-caused failures corrected: the first affected matrix reached 100% with one failure in the new
  email metric test because earlier email suites had intentionally committed durable outbox rows;
  it claimed ten rows instead of its one fixture. The test now transactionally deletes/rolls back
  the shared outbox exactly like the existing email suite. The exact case passed isolated, then the
  authoritative matrix passed 236/236. No product rule, timeout or assertion was weakened.
Known environmental failure: during the attempted complete backend run, unchanged test
  test_auth_repository_is_importable_before_the_services_package had its subprocess exceed its
  fixed ten-second timeout while host load averages were 38.57 / 49.31 / 51.76. The run was stopped
  after preserving its exact result rather than spending the remaining aggregate after red. The
  exact probe then passed 1/1 isolated with its timeout unchanged. Phase 12A's 7,506/exit-0 run is the
  latest complete green backend baseline; Phase 13 owes all 7,520 on a quiet host.
Known external failures: no hosted log aggregation, metric retention/query, alert route or tracing
  provider was configured or tested. No real Redis package/server was available, so its telemetry
  used a protocol-faithful fake for allowed/rejected/unavailable paths; RATE-001 still owns the live
  atomicity/outage/recovery gate. No live provider, credential or paid endpoint was used.
Remaining risks: OPS-005 must turn these signals and owned no-cost journeys into actionable alerts
  without invented traffic/capacity thresholds. CERT-002 must validate the chosen production log
  drain, retention/access and alert delivery. Whole-backend Ruff still has 67 pre-existing findings
  in files outside this slice. The canonical full backend and browser aggregates remain Phase 13.
Next phase: Phase 12C / OPS-005 alerts and synthetics. Reuse the canonical QA scenario system and
  actual health/error/metric contracts; do not create a competing seed/scenario registry or call a
  paid provider. Thresholds without an evidence-backed operational basis remain an explicit decision.
Important commands:
  git status --short && git branch --show-current && git rev-parse HEAD
  cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_operational_metrics.py -q
  cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_health_contracts.py \
    tests/test_email_outbox_worker.py tests/test_realtime_bus.py \
    tests/test_job_import_processing_lease.py tests/test_operational_metrics.py -q
  cd backend && .venv/bin/ruff check app/core/operational_metrics.py \
    app/middleware/operational_metrics.py app/middleware/request_id.py \
    tests/test_operational_metrics.py
  cd backend && .venv/bin/python -m alembic heads && APP_ENV=test .venv/bin/python -m alembic current
```

WHY STRUCTURED STDOUT, NOT A SCRAPE REGISTRY: the API, standalone email worker and standalone import
sweeper all already emit captured structured stdout, while only the API hosts HTTP. An in-process
registry would make worker metrics unreachable or require a second server in each worker, and would
lose all counters on every restart. The log stream gives each process one transport and lets OPS-005
choose a real production consumer without making that vendor a local dependency. This phase claims
safe producers and schema, not aggregation that has not been configured.

WHY REQUEST IDS CHANGED: RequestIDMiddleware previously copied X-Request-ID verbatim into every log
and response. That made a caller-supplied email, token, URL or oversized value look like a trusted
correlation field. Accepting canonical UUIDs preserves ordinary upstream correlation; replacing all
other input with a generated UUID removes arbitrary content without losing the response-to-log join.

WHY THERE IS NO IDLE EMAIL HEARTBEAT: the worker polls every five seconds. Emitting one metric for an
empty pass creates 17,280 events per worker per day and still does not prove the queue is empty. The
runner already logs start/stop/failure; success metrics describe claimed work and delivery outcomes.
A real depth/oldest-age alert belongs with an actual consumer in OPS-005, not a noisy proxy for one.

## Phase 12A checkpoint (OPS-003 — know that it broke without collecting the customer)

```text
Phase: 12A — privacy-bounded error reporting and private source-map release artifacts
Status: COMPLETE
Initial HEAD: de85565efba8d8550fc822de22d2831141e3b809
Final HEAD: resolve `git rev-parse HEAD`; this handoff is committed with the implementation
Commit(s): `ops(errors): add privacy-bounded failure reporting`
Files materially changed:
  backend/app/core/logging.py; backend/app/core/error_reporting.py; backend/app/core/errors.py
  backend/app/core/rate_limit.py; backend/app/schemas/telemetry.py
  backend/app/api/v1/routers/telemetry.py; backend/app/api/v1/api.py; backend/app/main.py
  backend/tests/test_error_reporting.py; backend/tests/test_brand_enrichment.py
  lib/clientErrorReporter.ts; components/ClientErrorReporter.tsx
  app/error.tsx; app/global-error.tsx; app/layout.tsx
  scripts/collect-private-source-maps.mjs; tests/errorReporting.test.mjs
  next.config.ts; package.json; .github/workflows/ci.yml; .github/workflows/README.md; .gitignore
  .env.example; DEPLOYMENT.md
  docs/PRODUCTION_READINESS_EXECUTION.md; docs/PRODUCTION_READINESS_HANDOFF.md
Migrations: none. Alembic remains 0070_activity_page_indexes, one head.
Behavior changed: React route/global boundaries plus window error and unhandled-rejection listeners
  report failures best-effort. The anonymous backend intake is limited to 30 events per client per
  five minutes by the accepted rate-limit backend. Browser failure reports deliberately contain no
  message, page/profile URL, identity, authentication context, headers or arbitrary stack text.
  Backend unhandled responses remain the same safe 500 with request correlation. Release builds
  archive source maps under an immutable release and strip public maps/hints before completing.
  Plain local `npm run build` and backend boot require no observability vendor.
Security assumptions: the structured stdout stream is the vendor-neutral ingestion boundary and
  remains access-controlled by deployment infrastructure. JsonFormatter serializes the raw static
  log template rather than interpolating LogRecord arguments; pre-interpolated email/URL/token/DSN
  shapes are redacted and bounded. Exceptions contribute type plus module-relative coordinates,
  never their message, source line or absolute host path. The browser DTO is extra-forbid and its
  frame files must be canonical Next static chunks. The endpoint is anonymous because auth itself
  must be reportable; abuse is Redis-atomic in production and payload/body size remains bounded.
  CI source-map artifacts contain source and need repository-artifact access controls; no map is
  placed in `.next/static` after collection and no map directory is copied into a runtime.
Tests run: listed below.
Exact results:
  backend focused error-reporting pytest                 5/5
  frontend focused error/source-map node                6/6
  frontend complete node aggregate                      1,276/1,276
  npx tsc --noEmit                                      exit 0
  changed backend Ruff                                  exit 0
  npm run build:release                                 exit 0
  real release map collection                           454 maps archived; 73 public maps stripped
  post-build public map/hint inspection                 0 maps; 0 sourceMappingURL hints
  first full backend aggregate                          reached 100%; two clock-fixture failures only
  exact two aggregate failures fresh                    2/2
  complete brand-enrichment eligibility class           11/11 after deterministic clock correction
  authoritative full backend rerun                      7,506 collected; exit 0; 0 failed
  complete ESLint after task-warning correction         exit 0; 0 errors / 32 existing warnings
  complete backend Ruff baseline                        exit 1; 67 pre-existing findings in untouched files
  git diff --check                                      exit 0 before documentation finalization
Known external failures: this workflow has not run on a GitHub-hosted runner; source-map artifact
  access/retention has not been exercised remotely; production stdout aggregation, retention and
  alert delivery are not configured or tested here. Those are OPS-005/CERT-002 external gates, not
  claims hidden inside OPS-003. No live provider, production credential or paid endpoint was used.
Remaining risks: OPS-004 still needs bounded-cardinality operational telemetry for HTTP/errors and
  the ledger-named DB, Redis, outbox, realtime, upload, auth and AI seams. OPS-005 must consume real
  failure/metric signals into actionable alerts and local synthetics. Logs cannot compensate for
  missing production retention/access policy, and private maps are useful only while their release
  artifact remains retrievable. Phase 13 still owes the canonical browser aggregates on a quiet host
  and resolution of the 67 whole-backend Ruff findings; none is in a file touched by this slice.
Next phase: Phase 12B / OPS-004 bounded operational telemetry. Survey producer/consumer seams first;
  if a metric registry is introduced, mutation-prove that every registered metric has a producer
  and a consumer. Keep tracing optional and never label with email, username, message, job/AI text,
  arbitrary URL or another unbounded customer value.
Important commands:
  git status --short && git branch --show-current && git rev-parse HEAD
  cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_error_reporting.py -q
  cd backend && .venv/bin/python -m alembic heads && APP_ENV=test .venv/bin/python -m alembic current
  node --test --experimental-strip-types tests/errorReporting.test.mjs
  CREATORJOBS_RELEASE=<immutable-release> npm run build:release
  find .next/static -type f -name '*.map'
```

WHY STDOUT, NOT A PRETEND PROVIDER: both deployed processes already have a structured, captured
stdout stream. A local adapter that imitated one vendor's HTTP schema without credentials or a real
consumer would add a second failure path and still prove no ingestion. This slice makes the emitted
event safe and stable; Phase 12C owns the actual aggregation/alert consumer and must validate it in
the target platform. A broken sink is explicitly tested to leave both the backend 500 and browser
error boundary intact.

WHY THE LOG TEMPLATE IS NOT FORMATTED: Python logging arguments commonly hold provider errors,
email addresses, URLs and credentials. Calling `getMessage()` merges those values into one string
that no later field allowlist can reason about. Product events therefore use static labels plus
finite structured dimensions. This intentionally trades ad-hoc interpolated prose for a privacy
boundary; OPS-004 supplies the request/status/dependency dimensions operators actually need.

WHY THE BRAND-ENRICHMENT TEST CHANGED: its class already defined one NOW and the production seam
already accepted `now=`, but `_decide` forgot to connect them. In a full run lasting longer than the
180-second liveness window, fixtures called “recent” became stale between collection and assertion.
The correction supplies that existing clock to all 11 cases; no duration, assertion or production
rule was weakened. The original aggregate failures and their fresh 2/2 rerun remain recorded above.

## Phase 11L checkpoint (A11Y-001 — fail closed on the surfaces customers use)

```text
Phase: 11L — automated accessibility and cross-browser gate
Status: COMPLETE
Initial HEAD: 5180f6b707fe34fc094f61126092e8e5e15bebc0
Final HEAD: resolve `git rev-parse HEAD`; this handoff is committed with the implementation
Commit(s): `fix(a11y): gate customer surfaces across browsers`
Files materially changed:
  package.json; package-lock.json
  playwright.a11y.config.ts
  tests/e2e/axeAudit.ts; tests/e2e/accessibility-matrix.spec.ts
  tests/e2e/qa/workspace-accessibility.spec.ts
  .github/workflows/ci.yml; .github/workflows/README.md
  tests/ciWorkflowContract.test.mjs
  components/AuthPage.tsx; components/Header.tsx; components/Sidebar.tsx
  components/JobCard.tsx; components/TalentCard.tsx; components/PostJobPage.tsx
  components/jobs/ChannelAttribution.tsx
  components/profile/ProfileExperienceList.tsx; components/profile/ProfileReviews.tsx
  components/you/ApplicationsWorkspace.tsx; components/you/PipelineBoard.tsx
  components/you/WorkspaceNavigation.tsx
  backend/app/api/v1/routers/marketplace.py; backend/app/schemas/marketplace.py
  backend/tests/test_activity_summary_query_bound.py
  lib/backendClient.ts; lib/ownerInteractions.ts
  tests/interactionTimeline.test.mjs
  tests/e2e/dev-data-source.spec.ts; tests/e2e/messaging-hierarchy.spec.ts
  tests/e2e/review-progress.spec.ts; tests/e2e/you-applications.spec.ts
  README.md; docs/PRODUCTION_READINESS_EXECUTION.md
  docs/PRODUCTION_READINESS_HANDOFF.md
Migrations: none. Alembic remains 0070_activity_page_indexes, one head.
Behavior changed: customer-facing cards and inline controls have real minimum hit areas;
  review rails are keyboard-focusable; profile experience links have explicit names; the
  mobile navigation button now controls the labelled main navigation; Post Job exposes its
  hiring-state graphic semantically; status/count contrast and row-state layout are stable.
  Interview scheduling now explicitly resolves a legacy missing conversation before the
  mutation, so a cancelled background detail read cannot turn Save into a silent no-op.
Security assumptions: axe runs against the whole document with WCAG 2.0/2.1/2.2 A/AA tags
  and fails on every selected violation. `resultTypes: ["violations"]` only bounds result
  serialization; it does not filter severity. The route matrix uses bounded local fixtures
  and no live provider. The already-authorized activity query may return a conversation id;
  it does not broaden ownership, and the fallback conversation endpoint repeats authorization.
Tests run: listed below.
Exact results:
  npx tsc --noEmit                                      exit 0
  npm run lint                                          exit 0, 0 errors / 32 existing warnings
  node --test tests/*.test.mjs                          1,270/1,270, 0 failed/skipped
  npm run build                                         exit 0, production build complete
  npm run audit:production                              0 analyzed/unanalysed high/critical
  focused backend activity-summary pytest              2/2
  changed backend Ruff                                  exit 0
  focused CI/mapping node                               19/19
  real-backend interview scheduling workflow           1/1
  complete real-backend accessibility QA               8/8
  accessibility Chromium                               29/29
  accessibility WebKit                                 29/29
  accessibility Firefox aggregate                      27/29; two host timeouts
  exact timed-out Firefox cases                        1/1 Pipeline; 1/1 mobile
  earlier unsplit cross-browser matrix                 78/78
  standard browser aggregate before corrections       497/504
  three host-sensitive standard failures isolated      3/3
  surrounding corrected standard files                 39/41, then remaining 2/2
  final exact standard regression set                  6/6
Known external failures: A11Y-002 remains BLOCKED_EXTERNAL. Automation cannot certify a
  real screen-reader session, human focus-order/keyboard review, browser-native 200% zoom,
  physical touch behavior, or production assistive-technology combinations. The host ran at
  load 50–95 from unrelated editor processes; two Firefox navigation timeouts are retained as
  evidence and were not erased by rerunning. No canonical 504/504 standard aggregate is claimed.
Remaining risks: Phase 13 must rerun the complete standard browser suite and cross-browser
  gate on a quieter host. SEO-002 still needs the separately recorded real-backend sitemap
  pagination/error-behavior check. Manual accessibility review remains a release gate.
Next phase: Phase 12A, OPS-003 error reporting, after a bounded existing-seam survey.
Important commands:
  git status --short
  cd backend && .venv/bin/python -m alembic heads && .venv/bin/python -m alembic current
  npm run test:e2e:a11y
  npm run test:e2e:qa
  node --test tests/*.test.mjs
```

WHY THE MATRIX IS SEPARATE: standard, real-backend QA and the three-browser accessibility
gate all write/read `.next`. CI therefore runs them serially. Parallelizing them would test
artifact corruption and server races, not accessibility.

WHY THE STANDARD TEST CONTRACTS CHANGED: the mock job title was retitled in the canonical fixture,
and deliberate-open auto-review intentionally advances New to Reviewing after 800 ms. Tests
that expected the retired title or raced `Move to Reviewing` contradicted current product
truth. The row/card test now switches the same mounted workspace instead of re-seeding a fresh
copy after the Inbox record progresses. The deliberate-review test previously selected every
row with the always-true predicate `preview.length >= 0`; it now uses the product's own
Not-opened queue. No sleep was increased and no accessibility violation was filtered out.

## Phase 11K checkpoint (PERF-002/CORRECT-007 — page the activity, not merely its DOM)

```text
Phase: 11K — activity-summary payload pagination
Status: COMPLETE
Initial HEAD: 837329fad9ea39652bcd84ed6cad1691660bab00
Final HEAD: resolve `git rev-parse HEAD`; this handoff is committed with the implementation
Commit(s): `perf(activity): paginate the workspace timeline`
Files materially changed:
  backend/app/services/activity_pagination.py
  backend/app/api/v1/routers/marketplace.py
  backend/app/schemas/marketplace.py
  backend/app/models/marketplace.py
  backend/alembic/versions/0070_activity_page_indexes.py
  backend/tests/test_activity_summary_query_bound.py
  lib/backendClient.ts
  lib/ownerInteractions.ts
  components/you/ApplicationsWorkspace.tsx
  components/you/PipelineBoard.tsx
  tests/activityPagination.test.mjs
  tests/e2e/applications-pipeline.spec.ts (test setup only; assertions unchanged)
  docs/PRODUCTION_READINESS_EXECUTION.md
  docs/PRODUCTION_READINESS_HANDOFF.md
Migrations: 0070_activity_page_indexes, parent 0069_support_tickets, single head. Four
  composites match the four viewer filters followed by updated_at/id. Fresh upgrade,
  downgrade to 0059 and re-upgrade all passed against disposable PostgreSQL.
Behavior changed: authenticated Applications requests only the active talent/hiring feed,
  100 interactions initially (server maximum 200), then exposes an explicit Load older
  control. Exact mode/direction totals come from the server. Search, queues, archive and
  stage filters say they cover loaded activity while more exists; false all-caught-up and
  reminder claims are suppressed. An owned deep-linked interaction may be added to page one.
Security assumptions: the cursor is deliberately opaque but unsigned. It is strict/versioned,
  mode-bound and timestamp/UUID validated; modifying it can move only within the caller's own
  feed because every UNION branch and the anchor query repeat the authenticated ownership scope.
  A foreign include is ignored. No cursor field is accepted as an authorization decision.
Tests run: listed below.
Exact results: frontend 1,268/1,268; backend risk-focused 65/65; PostgreSQL 29/29 after
  migration cycle; TypeScript 0 errors; lint 0 errors/32 existing warnings; activity client
  3/3; workspace paging browser 11/11; complete Pipeline browser 31/31; build green.
Known external failures: none introduced. No managed datastore or production capacity claim was
  made. One first local PostgreSQL harness pass hit its existing hard 10-second concurrency-test
  timeout on a contended host; isolated and complete reruns passed.
Remaining risks: production Postgres query plans/latency and multi-instance capacity still need
  staging evidence. The cursor's timestamp ceiling excludes a relationship that is modified
  after traversal begins; that newer activity appears on the next refresh. This is an activity
  feed traversal, not a historical MVCC snapshot. Frontend-first is the supported rollout order.
Next phase: Phase 11 A11Y-001 automated accessibility matrix.
Important commands:
  git status --short
  cd backend && .venv/bin/python -m alembic heads && .venv/bin/python -m alembic current
  node --test tests/*.test.mjs
  npx playwright test tests/e2e/workspace-paging.spec.ts tests/e2e/applications-pipeline.spec.ts
```

THE BOUNDARY: pagination happens before the wide relationships are loaded. Four key-only source
queries are unioned:

```text
talent = sent applications + received hiring requests
hiring = received applications + sent hiring requests
all    = all four (legacy/default compatibility contract)

ORDER BY updated_at DESC, source_rank ASC, id DESC
```

The cursor carries version, mode, first-page timestamp ceiling, last timestamp, source and UUID.
Timestamp alone is not enough: this slice's fixture puts twelve records at the exact same instant
and reaches all twelve across 5/5/2 pages with no duplicate or omission. Source rank deliberately
matches the legacy frontend array order, so equal timestamps do not reshuffle during rollout.

COUNTS AND CONTEXT: one SQL round trip returns all four exact viewer counts as of the traversal
ceiling. A mode-specific page fetches only owned jobs/listings referenced by its rows; the default
`all` response retains at most 100 recent owned jobs and 100 recent owned listings for the older
combined-response contract, plus every context referenced by the page. Related counterparty
contexts, users, conversations, engagements, reviews and status histories remain batched. The
existing query-count invariant remains below 18 SELECTs as row count grows.

DEEP LINKS: `include=<uuid>` is first-page-only and additive. If that UUID belongs to the current
viewer in the requested mode and lies beyond page one, it is returned as an anchor without moving
the chronological cursor. When ordinary paging reaches it again, the client deduplicates it and
keeps the existing item, preserving local unread/star/stage state. Another account's UUID returns
no anchor and no existence signal.

CLIENT RACES CLOSED:

  - every first-page/full refresh increments a generation; an older-page response from the prior
    generation cannot append into a new mode or realtime refresh;
  - an accepted older page reconciles through a functional state update, so a stage move, star or
    realtime mutation completed during the request cannot be rolled back by a render-time snapshot;
  - false exhaustive states are hidden until `has_more` is false;
  - a backend predating pagination is treated as one complete legacy page. DEPLOY FRONTEND FIRST,
    THEN MIGRATION/BACKEND. Backend-first would bound an old client without giving it Load older.

THE BROWSER FAILURE WAS A TEST-CONTRACT BUG, NOT A COUNT PATCH. The first combined run had all
11 workspace-paging cases pass and five old Pipeline count checks differ by exactly one: the helper
opened Inbox long enough for intentional Auto-Reviewing (800 ms) to move the selected New record,
then compared the live board to the untouched manifest. Serial reproduced it. The helper now enters
the canonical Pipeline deep link and waits for a seeded row rather than the empty loading shell.
Inbox -> Pipeline navigation remains covered by its dedicated test. No expected count, timeout or
product assertion was weakened. Focused rerun passed, then the complete file passed 31/31.

VALIDATION DETAIL:

  - `APP_ENV=test pytest -q tests/test_activity_summary_query_bound.py
     tests/test_applicant_management.py tests/test_messaging.py tests/test_marketplace_core.py
     tests/test_creator_scenario_parity_dump.py --maxfail=1`: 65 passed; existing framework warnings.
  - cursor/static-tie/ownership/deep-link/context tests: passed; malformed and wrong-mode cursors 422.
  - `./scripts/test_interaction_status_postgres.sh`: first run had one unrelated hard-timeout;
    exact isolated auth-concurrency rerun passed; complete rerun passed all 29 and the migration cycle.
  - `node --test tests/*.test.mjs`: 1,268 passed, 0 failed.
  - `npx tsc --noEmit`: passed.
  - `npm run lint`: exit 0, 0 errors, 32 pre-existing warnings.
  - `node --test tests/activityPagination.test.mjs`: 3 passed.
  - Playwright workspace paging: 11 passed; Applications Pipeline final: 31 passed.
  - production builds started by Playwright web servers: passed.
  - Docker Desktop was started only for the disposable harness, which removed its container/volume;
    Docker Desktop was then stopped again. No hosted Neon, Vercel or Render resource was touched.

NOT DONE HERE: no timing percentile or capacity number is inferred from this workstation; no
production query plan was sampled; A11Y-001/002 remain. PERF-002 and CORRECT-007 are VALIDATED for
their local engineering contract, while live platform validation remains an external release gate.

## Phase 11J checkpoint (PERF-002/CORRECT-007 — 100 identities, never one shared context)

```text
STATUS: IMPLEMENTED AND FOCUSED-VALIDATED. Migration: none. Dependency: none.
INITIAL HEAD: 38fc1c704c41643c6fbc7b8fa6481679eeebc920
COMMIT: `perf(sessions): verify 100 concurrent identities`

CONTRACT: `npm run check:concurrent-sessions` creates 100 distinct encrypted NextAuth JWT cookies, then
starts all 100 reads before awaiting any. It validates each response's allowlisted user fields and backend
identity exactly, rejects any crossed identity, and proves provider credential sentinels from legacy cookie
state are stripped. It then repeats the isolation proof through 100 simultaneous authenticated renders of
the real dynamic `/applications` route, using the same URL so any unsafe route cache/request-context reuse
is observable. The route response must carry exactly that cookie's user/access identity and no anonymous
state or provider sentinel. One mismatch fails the whole exercise; it is never averaged away.

SAFETY: target parsing accepts only literal 127.0.0.1 or [::1] origins (not localhost DNS, credentials,
paths or remote hosts). The signing secret is accepted only through SESSION_CHECK_NEXTAUTH_SECRET and is
never printed. Sensitive mismatches are redacted. The exercise performs no application/database write,
does not call the backend, and cannot target a hosted deployment. It measures correctness/security only:
no latency, throughput, multi-instance, database or load-balancer capacity claim is made.

FILES: scripts/check-concurrent-sessions.mjs; tests/concurrentSessionCheck.test.mjs; package.json; ledger;
handoff. EXPECTED_CURRENT_COLLECTION (frontend): 1,265, +4 focused tests. Backend remains 7,499.

VALIDATION:
  node --test tests/concurrentSessionCheck.test.mjs             -> 4 passed
  npx eslint scripts/check-concurrent-sessions.mjs
    tests/concurrentSessionCheck.test.mjs                       -> exit 0
  SESSION_CHECK_NEXTAUTH_SECRET=<local build secret>
    npm run check:concurrent-sessions --
      --base-url http://127.0.0.1:3100 --sessions 100            -> 100/100 session API,
                                                                    100/100 workspace,
                                                                    100 identities
  owned next start process output                               -> no application error
  git diff --check                                              -> exit 0

NOT COMPLETE: activity-summary payload pagination is the remaining PERF-002/CORRECT-007 implementation.
```

## Phase 11I checkpoint (PERF-002 — a bundle report that measures this build)

```text
STATUS: IMPLEMENTED AND FOCUSED-VALIDATED. Migration: none. Dependency: none.
INITIAL HEAD: 1be4bcc8d1a064203cdf01bd3adf1380ec38f04e
COMMIT: `perf(bundles): add reproducible route payload report`

CONTRACT: `npm run report:bundle` reads the completed Next 16 App Router client-reference manifests and
the bytes they actually name. For each route it unions layout/page JavaScript and CSS entries, deduplicates
shared files inside that cold route, and reports raw plus gzip-level-9 sizes. It also reports the union of
client entry artifacts and how many routes use each large file. Stable sort order and `--json` make the
same artifact reproducibly comparable. Missing artifacts, malformed manifests and paths escaping `.next`
fail closed. No analyzer package was added and no arbitrary release budget was invented.

PRODUCTION-LIKE BASELINE: a clean build with local mocks, dev switch and QA persona switch disabled gave:
  /you             212.3 KiB JS + 42.2 KiB CSS = 254.6 KiB gzip
  /applications    205.3 KiB JS + 42.2 KiB CSS = 247.5 KiB gzip
  /jobs/[id]       194.0 KiB JS + 42.2 KiB CSS = 236.2 KiB gzip
  unique union     56 client entry files, 2,407.2 KiB raw / 638.9 KiB gzip
The preceding E2E build with dev switches enabled produced materially identical totals, so these are not
QA-only measurements. They establish where future work should look; they do not by themselves prove a
customer regression or authorize speculative code splitting.

FILES: scripts/report-client-bundles.mjs; tests/bundleReport.test.mjs; package.json; execution ledger;
handoff. EXPECTED_CURRENT_COLLECTION (frontend): 1,261, +4 focused tests. Backend remains 7,499.

VALIDATION:
  node --test tests/bundleReport.test.mjs                       -> 4 passed
  npx eslint scripts/report-client-bundles.mjs
    tests/bundleReport.test.mjs                                 -> exit 0
  production-like npm run build                                 -> exit 0, 32 generated entries
  npm run report:bundle                                         -> exit 0, 52 normal/special page rows
  git diff --check                                              -> exit 0

NOT COMPLETE: PERF-002/CORRECT-007 still require the 100-concurrent-session correctness exercise and
activity-summary payload pagination. No latency claim is made under the contended host.
```

## Phase 11H checkpoint (PERF-001 — optimize owned media without creating an open proxy)

```text
STATUS: VALIDATED LOCALLY. Migration: none. Dependency: none.
INITIAL HEAD: 16192bff9b7048187192f37d1aad480a8cbe9c0e
COMMIT: `perf(images): optimize only owned media`

CONTRACT: Next's image optimizer is a server-side network boundary. In production the frontend now
requires the same server-only MEDIA_PUBLIC_BASE_URL and MEDIA_BASE_PATH as the backend. Only URLs that
match both that exact origin and the backend's actual stored object shape are eligible:
  avatars|banners / 32-hex owner / 16-hex token / gif|jpg|png|webp
The emitted config has eight extension-specific, two-segment remote patterns. It allows no wildcard
hostname, no redirect, no local IP, no SVG, and no response above 10 MiB. Arbitrary creator/channel/
portfolio URLs remain ordinary browser requests; they never become attacker-directed `/_next/image`
fetches. The classifier also refuses credentials, query, fragment and encoded separator/dot forms.

PERFORMANCE DECISION: the Phase 11F production-artifact inventory established that all six sampled LCPs
were text, so no image was blindly preloaded. CreatorJobs-owned public-profile hero media uses responsive
Next Image sizing and eager async decode; every raw image in app/components now states a literal eager or
lazy decision and async decode. Repeated/below-fold images are lazy; shell, visible hero, preview and
editor images remain eager. This is classification, not a timing claim under host load >50.

DEFECT CAUGHT BY BEHAVIORAL TEST: the first implementation allowed the owned prefix without restricting
the extension. A same-origin SVG reached the network path and failed only at DNS (HTTP 500). The live
test was kept; remote patterns were narrowed to the eight raster extensions, after which that SVG and
all other out-of-contract inputs return 400 before fetch.

MATERIALLY CHANGED: lib/trustedMedia.ts; next.config.ts; app/u/[slug]/page.tsx; raw image loading/decoding
attributes across app components; .env.example; DEPLOYMENT.md; tests/imageDeliverySecurity.test.mjs;
tests/e2e/image-delivery.spec.ts; tests/securityHeaders.test.mjs. The security-header test changed because
its old structural assertion required a duplicated inline production predicate; the intended contract is
now one shared predicate used by both HSTS and media classification, while all behavior assertions remain.

VALIDATION:
  node --test tests/imageDeliverySecurity.test.mjs tests/securityHeaders.test.mjs -> 28 passed
  node --test tests/*.test.mjs                                                    -> 1,257 passed
  npx tsc --noEmit                                                               -> exit 0
  focused ESLint                                                                 -> exit 0, 27 warnings
    (26 deliberate browser-only raw-image warnings; 1 pre-existing hook warning)
  final production npm run build                                                 -> exit 0, 32 routes
  emitted .next config inspection                                                -> 8 exact patterns,
    redirects 0, body cap 10,485,760, local IP false, SVG false
  Playwright production artifact tests/e2e/image-delivery.spec.ts --workers=1    -> 2 passed (9.3s)
  git diff --check                                                               -> exit 0

LAST_FULL_SUITE_OBSERVED (frontend): 1,257 passed, 0 failed, 0 skipped.
EXPECTED_CURRENT_COLLECTION (backend): unchanged at 7,499; no backend test was added.
EXTERNAL: production media origin/storage provisioning and live-origin delivery remain under MEDIA-004.
NEXT: PERF-002/CORRECT-007 — bundle report, 100-session correctness and activity payload pagination.
```

## Phase 11G checkpoint (PERF-002/CORRECT-007 — one workspace summary, not hundreds of reads)

```text
STATUS: IMPLEMENTED AND FOCUSED-VALIDATED. Migration: none. Dependency: none.
INITIAL HEAD: 0e9e7220e7371443789dcf88b7c7f8f4d929614c
COMMIT: `perf(activity): batch workspace summary reads`

PROVEN DEFECT: a non-vacuous query listener around the real activity-summary function measured:
  1 received application + 1 received hiring request   -> 22 SELECTs
  24 received applications + 24 received requests      -> 298 SELECTs
The old path expanded each record through separate user, conversation, engagement, engagement-lock,
review-state and history reads. This was database round-trip growth, not a wall-clock benchmark.

CHANGE: activity summary now loads each relation class in a bounded query: participant users (also reused
for talent-listing owners), conversations, interaction histories, engagement rows and engagement reviews.
Engagement locks are acquired in deterministic ID order. `review_service.engagement_summaries` preserves
the existing reconcile-before-read behavior but preloads review rows once. The ordinary/stable read path
therefore stays within the 18-SELECT contract as record count grows.

BOUNDARY: a deadline-triggered engagement transition is a write event. It still performs the messages,
notifications and flushes that transition requires; claiming those writes are query-free would be false.
The stable read path is bounded, while actual due state changes remain durable and idempotent under the
same row locks as before.

SECURITY/PARITY: sender views still blank manager_note and legacy archive state, and receive only
participant-audience history. Manager views still receive private history. A record that somehow appears
in both roles is filtered again during serialization, so the broad bulk history query cannot leak a
manager-only event through its sender representation. Archive timestamps, deleted-user snapshots,
counterpart names, review actions and payment passthrough retain their existing contracts. Single-record
serializers remain callable and now delegate only the engagement-summary portion to the compatible bulk
primitive.

VALIDATION:
  pre-fix query regression                                      -> FAIL (22 SELECTs -> 298)
  ruff check changed Python + new test                          -> all checks passed
  APP_ENV=test pytest tests/test_activity_summary_query_bound.py -> 1 passed, 4 known warnings
  APP_ENV=test pytest test_marketplace_core.py test_applicant_management.py
    test_engagement_reviews.py test_engagement_payment_state.py
    test_interaction_transitions.py test_messaging.py            -> exit 0, 100%
The six-file numeric total is deliberately not stated: explicit `-q` combined with pyproject's existing
`-q` into `-qq`, which suppressed it. Subsequent commands should not add `-q`.

NOT COMPLETE: CORRECT-007/PERF-002 remain IN_PROGRESS because the activity payload itself is still
unpaginated, and the bundle report plus 100-session correctness exercise remain. No timing claim was
made under the contended host. Next bounded slice is PERF-001's safe image trust split.
```

## Phase 11F checkpoint (PERF-002/CORRECT-007 — stop rendering every visible destination in the background)

```text
STATUS: IMPLEMENTED AND FOCUSED-VALIDATED. Migration: none. External service: none.
INITIAL HEAD: 5d0273117d279a53c32911128c58116a5b11d5ab
COMMIT: `perf(navigation): stop dynamic route prefetch fan-out`

CAUSE: the nonce-bearing CSP intentionally makes every HTML route dynamic. Next Link prefetch therefore
does not merely download a static route artifact here: each visible destination can cause a server render.
A browser request inventory proved the amplification before editing: `/` issued 8 automatic RSC
prefetches, `/jobs` issued 22, and `/u/aarav-mehta` issued 10. The jobs count included the full filter
chip row; talent additionally rendered each visible profile destination.

CHANGE: high-fan-out marketplace/filter/profile links and the global shell now set `prefetch={false}`.
This changes only speculative background work; click navigation remains the same. The rule is narrow:
it is not a ban on every Link, and it does not introduce a cache that could accidentally reuse a nonce.

REGRESSION TEST: `tests/e2e/navigation-prefetch.spec.ts` observes requests with the actual
`next-router-prefetch: 1` header on `/`, `/jobs` and `/talent`, strips only Next's `_rsc` cache-buster,
and asserts that no automatic destination render occurred. It waits for the browser's real intersection
and idle scheduling rather than an arbitrary sleep. The first focused run correctly FAILED on `/talent`
because TalentCard and ChannelAttribution still prefetched card destinations; those call sites were fixed,
not the assertion weakened.

ACTUAL LCP-ELEMENT INVENTORY (production artifact, 1440x900, mock data): all sampled routes had a TEXT
LCP, not an image: `/` hero H1; `/jobs` job-title H3; `/jobs/1` description paragraph; `/talent` card
title H2; `/talent/mock-talent-retention-editor` H1; `/u/aarav-mehta` H1. This is an element finding,
not a performance timing claim: unrelated host load was 48–61, so numeric timings would be misleading.
It means below-fold/list media can be lazy while public-profile hero media must still be treated
deliberately; there is no evidence for blindly marking an image `preload`.

VALIDATION:
  npx eslint <11 changed components> tests/e2e/navigation-prefetch.spec.ts  -> exit 0
  npx tsc --noEmit                                                      -> exit 0
  git diff --check                                                      -> exit 0
  PLAYWRIGHT_BASE_URL=http://127.0.0.1:3100 npx playwright test
    tests/e2e/navigation-prefetch.spec.ts --workers=1                   -> 3 passed (26.7s)
The green browser run used the exact completed production build through `next start`. One earlier config-
managed run timed out waiting 120 seconds for startup under host load >60; that was infrastructure
contention, not a test or application failure, and the completed artifact passed when started manually.

NOT COMPLETE: CORRECT-007 and PERF-002 stay IN_PROGRESS. The UI already bounds inbox/pipeline/focused
pages, but `/me/activity/summary` still expands records through per-item reads; bundle measurement and
the 100-session correctness exercise also remain. Next slice is the activity-summary bounded-query fix.
```

## Phase 11E checkpoint (PERF-001 — analysed, and deliberately not "fixed")

```text
COMMIT: "docs: record why the obvious image-optimization fix must not be applied"
No production code changed. All gates unchanged: backend 7,499, node 1,251, tsc/build exit 0.

WHY THIS ROW IS NOT IMPLEMENTED, and why that is the correct outcome rather than a shortfall:

All 38 raw `<img>` tags bypass Next's image optimizer, and next.config.ts has no `images` block at
all — which means `next/image` on a remote URL would throw "hostname not configured" at runtime.
That is WHY the raw tags exist; it is not an oversight.

The tempting fix is a `remotePatterns` wildcard. IT MUST NOT BE DONE. Creators link work from
arbitrary hosts — the CSP allows `img-src https:` for exactly that reason and a test pins the
allowance to that one directive — and pointing the optimizer at arbitrary hosts turns `/_next/image`
into an OPEN IMAGE PROXY: an SSRF surface and a bandwidth-abuse surface, fetching whatever a URL
parameter names. It is also a wildcard, which is out of bounds by standing instruction.

THE DEFENSIBLE SPLIT for whoever implements this: media on OUR OWN origin
(MEDIA_PUBLIC_BASE_URL avatars and banners) may go through the optimizer behind an EXACT host
pattern; arbitrary creator-linked images stay raw `<img>` forever. Those are two different trust
classes and one config key, which is precisely how the mistake gets made.

THE CHEAP WIN NOT TAKEN, and why: none of the 38 declares `loading` or `decoding`, so every
below-the-fold avatar and thumbnail loads eagerly. Fixing that is per-image rather than global,
because `loading="lazy"` on the actual LCP element makes LCP WORSE — and identifying the LCP element
on each route needs a browser. Applying it blindly would trade a measured problem for an unmeasured
one. Explicit width/height is largely moot here: these images carry fixed Tailwind boxes, so missing
intrinsic dimensions are not the CLS source they usually are.

NOT DONE, stated plainly: no LCP has been measured. That is a browser task.

REMAINING IN PHASE 11: PERF-001 implementation (needs a browser and the trust-class decision above),
PERF-002 workspace scale, A11Y-001 axe sweep — axe-core 4.11.1 is present in node_modules but is an
UNDECLARED transitive dependency, so that suite should declare it before relying on it. A11Y-002 is
BLOCKED_EXTERNAL (manual review by a person).
```

## Phase 11D checkpoint (SEO-004 — the same lifecycle hole on the talent side)

```text
COMMIT: "fix(seo): withdraw a closed talent listing from search, but not a busy creator"
MIGRATION: none. BACKEND: untouched, EXPECTED_CURRENT_COLLECTION stays 7,499.
FRONTEND: tsc exit 0, next build exit 0, node tests 1,242 -> 1,251 (+9).

Talent listings share the job status vocabulary — draft|published|paused|closed|archived|featured —
and had NO lifecycle check at all. A recruiter could search, find a listing, and reach a creator who
had taken it down. The talent-side twin of SEO-003, minus the structured-data half: talent pages emit
no JobPosting, so nothing was making a false machine-readable claim; only the indexing was wrong.

THE DISTINCTION THAT MATTERS, and the reason this is a separate function rather than reusing the job
rule: `availability_status` is NOT consulted. "Unavailable" means busy, not gone. The creator exists,
the listing is still theirs, and a recruiter planning next quarter's work has every reason to find
them and open a conversation. Delisting on availability would hide real people over a field they flip
weekly. A behavioural test covers all three availability values, and a structural test asserts the
rule's body never reads the field at all — because the behavioural one can only cover today's values.

The project half of SEO-004 was already done as a side finding in SEO-001: /u/[slug]/projects/
[projectId] had no metadata whatsoever, so every public portfolio project presented the site-wide
title with no description and no canonical of its own.

NON-VACUITY PROVEN BY MUTATION: made the talent rule return not-indexable for
availability_status === "unavailable" — exactly the 2 cases guarding that distinction failed.
Restored and re-verified.

PHASE 11 SO FAR: SEO-001 VALIDATED, SEO-002 IMPLEMENTED (source-level; pagination against a real API
needs a backend), SEO-003 VALIDATED, SEO-004 VALIDATED.
REMAINING IN PHASE 11: PERF-001 (images/LCP), PERF-002 (workspace scale), A11Y-001 (axe across
routes and viewports), A11Y-002 (BLOCKED_EXTERNAL — manual review).
```

## Phase 11C checkpoint (SEO-003 — a closed job was still telling aggregators it was open)

```text
COMMIT: "fix(seo): stop closed jobs advertising themselves as open"
MIGRATION: none. BACKEND: untouched, EXPECTED_CURRENT_COLLECTION stays 7,499.
FRONTEND: tsc exit 0, next build exit 0, node tests 1,226 -> 1,242 (+16).

THE DEFECT: app/jobs/[id]/page.tsx emitted a full `JobPosting` block for EVERY job it could load,
whatever its status. `JobPosting` is not decoration — it is a machine-readable claim that a role
exists and can be applied to, and aggregators act on it. A closed, archived, paused or draft job kept
advertising itself indefinitely, with no expiry to contradict it. This is precisely what Google's
"remove the posting when it closes" requirement exists for, and what manual actions get issued over.

THE SECOND DEFECT, subtler: `validThrough` came from `deadlineAt`, so a published job PAST its own
deadline still published as open. Status alone does not decide this — the database says open while
the posting says otherwise, and an applicant relies on the posting.

lib/seo/jobPostingLifecycle.ts holds one rule, consulted from BOTH `generateMetadata` and the page
body. That co-location is the point: they are separate functions in a Next route, and duplicating
the condition eventually yields a page that noindexes itself while still emitting an open
JobPosting — worse than either mistake alone, because search drops the page while the aggregator
keeps the listing. A test asserts both call sites use the shared rule and that no hand-rolled status
check exists beside it.

DECISIONS INSIDE THE RULE, each with a test:
  - `featured` counts as open — it is a promoted published job, not a lifecycle state, and treating
    it as unrecognised would delist every promoted role.
  - `paused` does NOT. It means "not accepting applications right now", and the vocabulary cannot
    express a pause: an aggregator reads a JobPosting as open or reads nothing.
  - An unknown or missing status fails CLOSED, so a status added later by someone who has not read
    this file cannot default to advertising a role that may not exist.
  - An UNPARSEABLE deadline does not delist an open job. A bad date is a data problem, not a
    closure, and reading it as expiry would remove a live job over a formatting error.
  - The clock is a parameter, so expiry is testable rather than only observable on the day.

ALSO ADDED: `directApply: true`, which is a statement of fact here — an application never leaves for
an external form — and stops an aggregator advertising an apply-elsewhere flow that does not exist.

DELIBERATELY NOT ADDED, and a test enforces the absence: `baseSalary`. Publishing compensation into
a machine-readable contract requires exact source amount and currency, and the rules for presenting
compensation truthfully are TRUST-001, which is NOT_STARTED. A guessed or converted figure would be
worst in exactly this place.

NON-VACUITY PROVEN BY MUTATION: OPEN_STATUSES widened to include every status, restoring the
original behaviour — 5 cases failed. Restored from a scratch copy and re-verified.

BEHAVIOURAL, not source-reading: 13 of the 16 cases call the rule directly with real inputs, because
the module is importable TypeScript (CI already runs node --test --experimental-strip-types). Only
the three wiring assertions read the page source.

NEXT READY: SEO-004 profile/project metadata — partly done already by the SEO-001 work on
/u/[slug]/projects/[projectId]; then PERF-001, A11Y-001.
```

## Phase 11B checkpoint (SEO-002 — a sitemap that was valid, well-formed and wrong)

```text
COMMIT: "fix(seo): stop the sitemap lying about what exists and when it changed"
MIGRATION: none. BACKEND: untouched, EXPECTED_CURRENT_COLLECTION stays 7,499.
FRONTEND: tsc exit 0, next build exit 0, node tests 1,214 -> 1,226 (+12).

FOUR DEFECTS, and every one of them produced a valid file, which is why none was noticed:

  1. TRUNCATION. The whole listing was ONE request for 100 records. With four hundred open jobs,
     three hundred were absent — valid XML describing a smaller site than the one being served.
     Now walked to the end, with three separate stopping conditions (short page, reported total
     reached, protocol ceiling) because a server that ignored `offset` would otherwise return the
     same first page forever. Bounded at the sitemap protocol's own 50,000-URL limit.
  2. FABRICATED TIMESTAMPS. Every job carried `lastModified: new Date()` — a claim that every job
     on the platform changed at the instant the crawler asked. This is worse than omitting the
     field: `lastmod` exists so a crawler can skip what has not changed, so a file where everything
     changed one second ago teaches it to disregard `lastmod` for this site entirely. Now read from
     `updated_at`/`created_at`, and an unparseable value yields NOTHING rather than today, because
     "I do not know" is true and costs nothing.
  3. AN OUTAGE PUBLISHED AS A FACT. `.catch(() => [])` meant an unreachable backend produced a
     sitemap of six static pages, served with 200. A crawler is entitled to read that as
     authoritative — the site has six pages now — which is how an afternoon of downtime empties an
     index. The error now propagates, Next answers 500, and the crawler keeps what it has.
  4. FOUND BY FIXING (3): THE SITEMAP WAS PRERENDERED AT BUILD TIME. Removing the swallowed error
     broke `npm run build`, which is how this surfaced — the fetch failure had been happening at
     BUILD time all along and being absorbed. Prerendering is wrong twice over: a sitemap of live
     jobs frozen at deploy misses everything posted afterwards, and a build without a reachable
     backend shipped a permanently-empty sitemap as an artifact. Now `force-dynamic`; the build
     output confirms it (`ƒ /sitemap.xml`, server-rendered on demand).
  Also: /faq was PUBLIC_INDEXABLE and absent from the sitemap. Coverage is now compared against
  lib/seo/routeIndexing.ts, so an indexable route missing from the sitemap fails a test — as does
  the reverse contradiction, submitting a URL that has been told not to index itself.

A TESTING LESSON, TWICE, IN OPPOSITE DIRECTIONS — worth carrying forward:
  In SEO-001 a comment naming /you/ and /admin/ (while explaining they are NOT disallowed) made a
  source-reading test PASS with the defect live: a false negative.
  Here, a comment quoting `.catch(() => [])` (while explaining its removal) made a test FAIL with
  the code correct: a false positive.
  Prose that documents a rule is textually indistinguishable from code that breaks it. Every
  assertion about code now runs against a comment-stripped copy, and the helper says why.

NON-VACUITY PROVEN BY MUTATION: all three original defects reintroduced simultaneously — clock
timestamps, the swallowed catch, /faq removed — and exactly the 3 corresponding cases failed.
Restored from a scratch copy and re-verified.

WHAT THESE TESTS DO NOT PROVE, stated because a green run implies more than it should: they read the
source rather than executing the route. Reaching the behaviour needs a running backend and a
populated database, so nothing here demonstrates that pagination actually retrieves a fourth page
from a real API, or that a live crawler sees a 500. The properties asserted are structural.

NEXT READY: SEO-003 JobPosting lifecycle (schema validity, expiry, closure, removal).
```

## Phase 11A checkpoint (SEO-001 — robots.txt and noindex were cancelling each other out)

```text
COMMIT: "fix(seo): stop robots.txt from hiding the noindex it was meant to reinforce"
MIGRATION: none. BACKEND: untouched, EXPECTED_CURRENT_COLLECTION stays 7,499.
FRONTEND: tsc exit 0, next build exit 0, eslint 0 errors / 1 pre-existing warning,
          node tests 1,204 -> 1,214 (+10 from tests/routeIndexing.test.mjs).

THE DEFECT, and it is the opposite of what it looks like: robots.txt disallowed /auth/, /you/,
/admin/, /dev/ and /smart-typing-test, and NONE of those routes carried a noindex. Disallow and
noindex do not stack — disallow says do not fetch, noindex says do not index, and a crawler has to
FETCH a page to read its noindex. So the disallow actively guaranteed the directive could never be
read, while a URL linked from anywhere could still be listed as a bare link with no title and no way
to remove it. The careful-looking configuration was the weaker one.

WHAT CHANGED: robots.txt now disallows only /api/, which is the one surface that cannot carry a
directive at all (it serves JSON — there is no meta tag to put one in), so Disallow is the only tool
available and its weakness is accepted knowingly rather than by default. Every authenticated surface
is now crawlable and carries `noindex, nofollow` in its own metadata, which is the instruction that
actually gets honoured. Letting a crawler fetch them costs nothing: they require a session.

lib/seo/routeIndexing.ts classifies all 45 routes as PUBLIC_INDEXABLE / PUBLIC_NOINDEX /
PRIVATE_NOINDEX / ROBOTS_DISALLOW / DEVELOPMENT_ONLY, each with a reason. Same shape as the config
contract, for the same reason: the DEFAULT IS INDEXABLE, so an authenticated page added on a Tuesday
is publicly indexable on Tuesday and nothing in the pull request says so. A page.tsx with no entry
now fails a test, and so does an entry naming a route that no longer exists.

MECHANICS, because a client component cannot export `metadata`: 31 server pages got a page-level
`noindexPage(...)`, and /auth, /post-job and /post-talent got a layout that exists only to carry the
directive (Next merges metadata down, so /auth/reset and /post-job/import inherit it). The test reads
the page AND its ancestor layouts, so either mechanism satisfies it.

A SECOND REAL GAP FOUND WHILE CLASSIFYING: /u/[slug]/projects/[projectId] — a public portfolio
project, the kind of page people paste into a message — had NO metadata whatsoever. Every project on
the platform presented itself with the site-wide title, no description, and no canonical of its own.
It now derives title, description, canonical, OpenGraph and Twitter cards from the project, and
NOINDEXES the not-found/moved/missing cases rather than titling them optimistically: a page reading
"Project not found" must not be offered to a searcher as a project.
Also added self-canonicals to /faq, /support, /terms and /privacy, which had none.

NON-VACUITY, and this one is worth reading: the mutation (re-adding /you/ and /admin/ to the
disallow list) initially failed only ONE of the two tests. The other extracted disallowed paths by
scanning app/robots.ts for quoted paths — and the explanatory comment above the array NAMES /you/
and /admin/ while saying they are deliberately not disallowed, so the looser match read the prose as
configuration and the test passed while the defect was present. Rewritten to parse the array literal
only, with a guard test asserting the parse returns real paths. Both now fail on the mutation.
The lesson generalises: a source-reading test can be defeated by the comment that explains it.

NEXT READY: SEO-002 sitemap (pagination, real timestamps, coverage), SEO-003 JobPosting lifecycle.
```

## Phase 10 certification — LOCALLY COMPLETE

```text
Scope: CI gates, supply chain, container, configuration contract, migration release, pool, health.

FINAL GATE RUN, all in one pass, nothing inferred:
  backend    APP_ENV=test pytest tests/ -q     exit 0 — 7,499 tests, 0 failures, 0 errors, 65 skipped
                                               (junitxml parsed; zero FAILED/ERROR lines)
  frontend   node --test tests/*.test.mjs      exit 0 — 1,204 pass, 0 fail
  types      npx tsc --noEmit                  exit 0
  build      npm run build                     exit 0
  audit      scripts/audit-production-dependencies.mjs  exit 0 — 0 analysed, 0 unanalysed
  alembic    single head, 0069_support_tickets
  ruff       clean on every file this phase touched; 67 pre-existing findings elsewhere, untouched
  workflows  ci.yml and security.yml both parse

  CI-001       IMPLEMENTED  5 jobs. Locally validated as a workflow — YAML parses, every npm script
                            and backend path exists, the Postgres image and the alembic downgrade
                            target are PINNED to the local harness by tests, so CI cannot drift from
                            it. NOT elevated: the tests-required column asks for runs in CI, and no
                            GitHub runner has executed any of it.
  CI-002       IMPLEMENTED  Gitleaks on full history, pip-audit on the --no-dev locked set, SBOM,
                            container source assertions. Found a REAL misclassification — see below.
  PLATFORM-001 IMPLEMENTED  non-root uid 10001, prod-only install, bounded HEALTHCHECK, asserted
                            from source. The image has never been BUILT: Docker unavailable here.
  PLATFORM-002 VALIDATED    all 71 settings classified; 33 CORE_REQUIRED each proven by mutation.
  PLATFORM-003 IMPLEMENTED  local half validated; a fresh PostgreSQL upgrade and real two-process
                            lock contention have run NOWHERE. Not elevated for that reason.
  PLATFORM-004 IMPLEMENTED  bounded pool, capacity supplied by the deployment. Predates this pass
                            and was not re-verified in it, so its status is left where it was.
  PLATFORM-005 VALIDATED    liveness / readiness / feature health separated, redaction proven.
  RELEASE-001  BLOCKED_EXTERNAL  no push, no remote, no protected main. Genuinely blocked, not
                            pending — nothing in this environment can advance it.

FOUR REAL DEFECTS, none of which was a ledger item, all found by reading code or by running a gate
rather than by a failing test:
  1. The three HIGH Prisma-chain advisories were recorded as not reachable on a MANIFEST argument.
     A clean `npm ci --omit=dev` install contains all three: npm installs the peer dependencies of
     production packages, and @prisma/client declares `prisma` as a peer. Remediated with an
     override to the fixed major of deepmerge-ts — NOT the semver-major Prisma downgrade npm
     proposes, and not by suppressing anything. The allowlist is now empty, which is correct: the
     advisories are fixed rather than excepted, and a stale exception is a standing permission the
     next advisory in that package would inherit.
  2. REALTIME_BUS documented a startup refusal that nothing called. Its only caller was the health
     probe, which catches it; the delivery path builds the process-local bus directly. A second
     production instance would have served half of every conversation with no error anywhere.
  3. SMTP_USE_TLS could be false in production. The line after the STARTTLS check logs in with the
     mail password, so it and every reset link in the body went in the clear.
  4. LOG_LEVEL could be DEBUG, which enables SQLAlchemy's engine logger — statements WITH bound
     parameters: addresses, tokens, password hashes — into stdout for the life of the log sink.
  And one test-integrity defect: the new readiness probe opened its own session against
  settings.database_url, which under APP_ENV=test is the developer's dev.db. Same shape as the
  earlier webhook/dev.db escape, invisible from a green run, fixed with an overridable factory and
  verified by md5 of dev.db before and after.

THE PATTERN WORTH CARRYING FORWARD: three of the four were documented requirements with nothing
behind them. They were not found by writing more tests about behaviour — they were found by writing
down a claim per field and then demanding that something refuse. "CORE_REQUIRED implies BOOT or
SCHEMA enforcement" is a one-line rule, and it is what turned prose into failures.

WHAT PHASE 10 DOES NOT CLAIM, stated once and plainly: no workflow has run on GitHub. No container
image has been built or scanned. No migration has been applied to a PostgreSQL database in this
environment. No advisory lock has ever been contended. Everything above is local evidence, and the
gap between it and a release is RELEASE-001.

NEXT: Phase 11 — metadata, SEO, performance, accessibility.
```

## Phase 10H checkpoint (PLATFORM-005 — three probes, three questions, and none of them talking)

```text
COMMIT: "feat(health): separate readiness from liveness, and keep both quiet"
MIGRATION: none.
BACKEND: LAST_FULL_SUITE_OBSERVED 7,499 tests / 0 failures / 0 errors / 65 skipped, exit 0.
         EXPECTED_CURRENT_COLLECTION 7,499 (was 7,471; +28 from tests/test_health_contracts.py).
         ruff clean on every touched file.

THE THREE QUESTIONS, and conflating any two causes an outage rather than preventing one:
  LIVENESS  GET /health        is this process alive? Consults NOTHING.
  READINESS GET /health/ready  would a request succeed? Only what EVERY request needs.
  FEATURE   GET /health/{job-import,realtime}  what can one optional feature promise? Always 200.

WHAT WAS MISSING: there was no readiness probe at all. `/health/db` was the closest thing and is
the wrong shape — it takes the request-scoped session via Depends(get_db), so an unreachable
database fails during DEPENDENCY RESOLUTION, the handler never runs, and the answer is 500
"internal server error" when the true answer is 503 "not ready". A load balancer treats those
differently and so does whoever is paged. `/health/db` is kept as a dependency probe.

WHY THE SEPARATION IS NOT PEDANTRY: a liveness probe that consults the database reports every
container unhealthy during a database blip, the orchestrator restarts all of them, and the restarts
add connection load to the thing already struggling — a recoverable dependency outage becomes a
total one, caused by the monitoring. A readiness probe that consults an OPTIONAL feature drops every
instance out of rotation because AI job import is unconfigured. Both are asserted behaviourally AND
structurally, the latter because a `Depends` added to liveness later would break no behavioural
test: in a test, the database is up.

THE REDACTION CONTRACT: every probe is unauthenticated, so anything it says is public — and the
natural way to write a useful health endpoint is to report what went wrong. The test stuffs
recognisably-shaped secrets into settings (a DSN with a password, SMTP credentials, a Redis URL with
inline auth) and asserts none of them, nor their host fragments, appears in ANY probe's body.
Parametrised over a list of probes, so one added later is covered without anyone remembering to.
Guarded by a twin that proves the leak check could actually fire.

A REAL BUG FOUND WHILE WRITING IT, and the reason the factory is injectable: the readiness probe
opens its own session, and `settings.database_url` under APP_ENV=test is the DEVELOPER'S dev.db —
so the probe connected to it from inside the suite. Identical in shape to the webhook router that
once wrote a row to dev.db, and equally invisible from a green run. Fixed with a dependency that
returns a session FACTORY rather than a session: it cannot fail, so an outage still reaches the
handler and still answers 503, while remaining overridable — conftest points it at TestSessionLocal
for the whole suite. Two tests pin both sides (the suite overrides it; production uses the
application's own sessionmaker, not a second engine with its own pool). Verified by md5 of dev.db
before and after the module: UNCHANGED.

CONTAINER PROBE UNCHANGED, deliberately, and now asserted: the Dockerfile HEALTHCHECK still points
at liveness. A healthcheck decides whether to RESTART, so aiming it at readiness would reintroduce
exactly the restart storm readiness exists to avoid.

NON-VACUITY PROVEN BY MUTATION: readiness was made to consult job import and to echo the exception
text; 4 cases failed (503-not-500, no-exception-echo, unconfigured-provider-stays-ready, and the
structural no-feature check). Restored from a scratch copy and re-verified green.

NEXT READY: remaining Phase 10 items, then Phase 10 certification.
```

## Phase 10G checkpoint (PLATFORM-003 — migrations stop being something every instance races to do)

```text
COMMIT: "feat(release): make migrations a release step instead of a race"
MIGRATION: none — this changes HOW migrations are applied, not the schema.
BACKEND: LAST_FULL_SUITE_OBSERVED 7,471 tests / 0 failures / 0 errors / 65 skipped, exit 0.
         EXPECTED_CURRENT_COLLECTION 7,471 (was 7,458; +13 from tests/test_release_migration.py).
FRONTEND: node tests 1,203 -> 1,204 (+1 CI contract case). ci.yml still parses. ruff clean.

THE DEFECT, and it does not look like a migration bug when it happens: migrations ran from the
container start command (`scripts/start_render.sh`, gated by RUN_DB_MIGRATIONS), so EVERY instance
executed `alembic upgrade head` on boot. Alembic takes no lock of its own, so two instances applying
the same DDL concurrently either deadlock or one errors — and the script is `set -e`, so the loser
CRASH-LOOPS. What an operator sees is one instance failing with a migration error while another has
already succeeded, on a deploy where nothing was wrong with the migration.

scripts/release_migrate.py does three things in an order that is itself the design:
  1. SOLE-HEAD CHECK FIRST, touching no database. Two heads is a merge accident; `upgrade head`
     would fail with an ambiguity error after opening a connection to production. A test asserts
     the check precedes create_async_engine, because a passing ordering has no visible effect.
  2. POSTGRESQL ADVISORY LOCK, so concurrent runs serialise. Polled with a deadline rather than
     blocking: a blocking pg_advisory_lock behind a process that died holding it waits as long as
     the connection lives, turning one bad migration into a deploy that never finishes and never
     says why. Released in a `finally`, so a failed migration does not block every later attempt.
  3. THE UPGRADE, reporting the revision before and after — including the boring case, "already at
     head, nothing applied", which is what every instance after the first one does.
It never seeds, never starts the app, and exits non-zero on anything unexpected without dumping a
traceback: a deploy log is read under pressure.

WIRED SO THE FIXED PATH IS THE PATH TAKEN: start_render.sh now calls the release step, and the
backend-postgres CI job migrates through it too — twice, so the no-op path is covered. If CI proved
`alembic upgrade head` while production ran the release step, the head check, the lock and the
already-at-head branch would be untested on the only engine where they do anything. Asserted from
both sides (tests/test_release_migration.py and tests/ciWorkflowContract.test.mjs).

WHAT IS AND IS NOT PROVEN LOCALLY, precisely:
  VERIFIED LOCALLY   — the already-at-head no-op exits 0 and never invokes alembic (real subprocess,
                       real SQLite database seeded with the head revision); a failing upgrade exits
                       1 with a one-line reason and no traceback; single head today; two heads
                       refused (monkeypatched get_heads, so non-vacuous); the ordering, lock-key
                       symmetry, finally-release and dialect gating.
  NOT VERIFIABLE HERE — the full chain needs PostgreSQL (migration 0001 declares JSONB, which SQLite
                       cannot render) and `docker` is permission-denied in this environment. So a
                       genuine fresh-database upgrade, the downgrade/seed/upgrade sequence, and REAL
                       two-process lock contention are exercised only by the backend-postgres CI
                       job — which has never run on a GitHub runner. BLOCKED_ENVIRONMENT for the
                       local half, BLOCKED_EXTERNAL (RELEASE-001) for the remote half. Do not read
                       the green local suite as evidence the advisory lock has ever been contended.

STILL OPEN, and it is the better shape: a genuine PRE-DEPLOY step, where a failed migration stops
the release before any traffic moves. The start-command path exists because Render Free has no
pre-deploy hook. The release step is now a single idempotent command, so adopting a pre-deploy hook
is a platform configuration change rather than a code change.

NEXT READY: PLATFORM-005 health contracts (liveness vs readiness vs optional feature health).
```

## Phase 10F checkpoint (PLATFORM-002 — every setting classified, and three promises that were not kept)

```text
COMMIT: "feat(config): classify every setting for production, and enforce what that claims"
MIGRATION: none.
BACKEND: LAST_FULL_SUITE_OBSERVED 7,458 tests / 0 failures / 0 errors / 65 skipped, exit 0.
         EXPECTED_CURRENT_COLLECTION 7,458 (was 7,369; +89 from tests/test_config_contract.py).
         Predicted 7,369 + 89 and observed exactly that. ruff clean on every touched file.

WHAT THIS IS: app/core/config_contract.py classifies all 71 Settings fields as CORE_REQUIRED /
FEATURE_CONDITIONAL / OPTIONAL_DEVELOPMENT / TEST_ONLY, each with the enforcement that backs it and
a reason written for whoever is deciding at 2am whether they may change it. A test fails when a
field is added without a classification, and when an entry names a field that no longer exists.

THE LOAD-BEARING RULE, and the only reason this found anything: CORE_REQUIRED implies enforcement
is BOOT or SCHEMA. Declaring a field required is therefore not sufficient to make the test pass —
each entry names a value that must be REFUSED, the test sets that value on top of a configuration
that otherwise boots, and demands a RuntimeError naming the env var. A comment saying production
must set X is not enforcement, and the registry cannot be used to claim otherwise.

THREE REAL GAPS FOUND BY APPLYING IT. All were documented requirements with nothing behind them:

  1. REALTIME_BUS. `build_realtime_bus()` carried the docstring "Refusing at startup is the point"
     and had exactly ONE caller — the health probe, which catches the refusal and reports it.
     Startup never called it, and the delivery path (`realtime/manager.py:313`) constructs
     `InProcessRealtimeBus()` directly. So a multi-instance production deployment ran process-local
     realtime with no acknowledgement and no error anywhere: each instance delivering only to its
     own connections, presenting as "messaging is flaky". Fixed by asking the bus during
     validate_production_settings(), keeping the rule in the module that owns it.
  2. SMTP_USE_TLS could be false in production. The line after the STARTTLS check calls
     `smtp.login(username, password)` — so the mail password, and every password-reset link in the
     body, travel in the clear. Now refused; there is no production case for it.
  3. LOG_LEVEL could be DEBUG. Root-level DEBUG enables SQLAlchemy's engine logger, which logs
     statements WITH their bound parameters — addresses, tokens, password hashes — to stdout for
     as long as the sink retains anything. Now refused in production, and the level name is
     schema-validated: `LOG_LEVEL=WARN` previously resolved to INFO via a getattr default, so an
     operator who turned the volume down had not.

Also fixed: the JWT lifetime failure said "refresh-token lifetime must exceed the access-token
lifetime" without naming either variable, so an operator could not grep for what to change.

NON-VACUITY PROVEN BY MUTATION: all three new refusals were disabled simultaneously, and 4 cases
failed (log_level, realtime_bus, smtp_use_tls, plus the dedicated realtime boot-path test). Config
restored from a scratch copy and re-verified green.

ENFORCEMENT VOCABULARY, because "required" alone hides the distinction that matters:
  BOOT (33) validate_production_settings raises · SCHEMA the value cannot be represented at all,
  which is stronger since no later code path can reintroduce it · ACKNOWLEDGEMENT an explicit
  opt-in to a documented risk, asserted to default false and to name the field it unblocks — an
  acknowledgement defaulting true acknowledges nothing · FEATURE_GATE absent means the feature
  refuses, never degrades · BOUNDED safe default plus schema bounds · INERT_IN_PRODUCTION cannot
  take effect there by construction, proven by configuring it as an attacker would want AND by the
  non-vacuity twin showing the same configuration works in staging · DEPLOYMENT_CHOICE topology
  or naming, must never block a boot.

BASELINE GUARD: `TestTheBaselineItselfBoots` exists because every parametrised case starts from
_safe_production_settings(). If that baseline stopped booting, all 33 would pass for the wrong
reason — the RuntimeError would be there and the alias would appear in it by coincidence.

OPERATOR SURFACE: `python -m scripts.print_config_contract` renders the checklist from the
registry, so it cannot fall behind. A test asserts it lists every CORE_REQUIRED alias, and that it
reads NO values — `model_fields` metadata only, never `settings`, never get_secret_value, never
os.environ, so it is safe to run and paste while holding real production configuration.

NOT DONE, and deliberately: backend/.env.example is permission-denied in this environment (.env*
is blocked), so the operator-facing env template still does not mention SMTP_USE_TLS's production
requirement, the LOG_LEVEL restriction, or ALLOW_PROCESS_LOCAL_REALTIME_IN_PRODUCTION. The
registry and the printer are the authoritative record until someone with access adds them.

UNSUBSCRIBE_TOKEN_SECRET is classified FEATURE_CONDITIONAL rather than CORE_REQUIRED on a finding
worth carrying forward: `issue_unsubscribe_token` has NO caller. No outbound template embeds an
unsubscribe link yet, so the secret is not required at boot today — and it becomes CORE_REQUIRED
the moment one does. The consent machinery is built and not yet wired into mail.

NEXT READY: PLATFORM-003 migration release step, PLATFORM-005 health contracts.
```

## Phase 10E-2 checkpoint (SEC-010 — the artifact disagreed with the manifest, so the exception died)

```text
COMMIT: "fix(deps): remediate the Prisma-chain advisories instead of excepting them"
MIGRATION: none. FRONTEND: tsc clean, next build exit 0, eslint 0 errors / 33 pre-existing warnings,
node tests 1,198 -> 1,203 (+5 artifact-contract tests).
EXPECTED_CURRENT_COLLECTION (backend) UNCHANGED at 7,369 — this slice adds no backend tests.

THIS SUPERSEDES the reachability paragraph in the Phase 10E checkpoint below. That paragraph is
left standing rather than edited, because the wrong reasoning is the useful part of this record.

WHAT WAS CLAIMED: the three HIGH advisories (prisma -> @prisma/config -> deepmerge-ts) were
recorded as NOT reachable in the deployed runtime, argued from the manifest — `prisma` is a
devDependency, `@prisma/client` declares no runtime dependencies, therefore the CLI's config chain
does not ship.

WHAT THE ARTIFACT SAID: a clean `npm ci --omit=dev --ignore-scripts` into a scratch directory
physically contained all three packages. The manifest argument was WRONG, and wrong for a specific
reason worth remembering: npm 7+ installs the PEER dependencies of production packages, and
`@prisma/client` declares `prisma` as a peer. Dependency classification in package.json does not
decide what a production install contains. Only the install does.

Per the standing instruction — do not preserve an exception contrary to artifact evidence — the
finding was RECLASSIFIED as actionable and remediated. It was not excepted, and it was not
re-argued.

REMEDIATION, and what was refused: the advisory covers deepmerge-ts <8.0.0; @prisma/config pins
7.1.5; the published fix path npm proposes is a semver-major DOWNGRADE of prisma to 6.12.0. That
downgrade was NOT performed — it is a data-layer decision and was explicitly unauthorized. Instead
package.json declares `"overrides": { "deepmerge-ts": "^8.0.0" }`, resolving 8.0.1, which is the
fixed major of the actually-vulnerable package and touches no Prisma version.
  Compatibility verified, not assumed: `npx prisma validate` exits 0 ("The schema at
  prisma/schema.prisma is valid"), `npx prisma generate` succeeds, `next build` exits 0.

OUTCOME, stated precisely: after remediation, `npm audit --omit=dev` reports zero vulnerabilities,
and a fresh production-only install resolves deepmerge-ts to 8.0.1. This is not "the advisories
were false positives" — they were real, they were reachable in the artifact, and they are fixed.
The earlier reading of them as non-reachable was the error.

THE ALLOWLIST IS NOW EMPTY, and empty is the correct state. Three entries were removed because the
advisories they described no longer exist, not because they were forgiven. A stale exception is
worse than no exception: it is a standing permission that the NEXT advisory in the same package
would silently inherit. security/npm-audit-allowlist.json keeps its schema and its comment
explaining why it is empty; the gate keeps failing on anything unanalysed, which is its whole job.
  Still deliberately NOT `--audit-level`. Unchanged, and asserted by a test.

GUARDED SO IT CANNOT SILENTLY REGRESS: tests/productionDependencyArtifact.test.mjs (5 cases) fails
if the override is removed, if the lockfile resolves deepmerge-ts below 8, if the Prisma CLI drifts
into `dependencies`, if `@prisma/client` drifts out of them, or if a Prisma-chain exception
reappears in the allowlist.

NEXT READY: PLATFORM-002 config contract, PLATFORM-003 migration release step, PLATFORM-005 health.
```

## Phase 10E checkpoint (CI-001 + CI-002 — workflows written, locally validated, never remotely run)

```text
COMMIT: "ci: define the release gates, and be exact about what that proves"
MIGRATION: none. FRONTEND: tsc clean, node tests 1,188 -> 1,198 (+10 workflow-contract tests).
EXPECTED_CURRENT_COLLECTION (backend) UNCHANGED at 7,369 — no backend tests added by this slice.

EVIDENCE STATUS, and the distinction is the point:
  IMPLEMENTED        — ci.yml (5 jobs) + security.yml (4 jobs) encode the gates.
  LOCALLY VALIDATED  — YAML parses; every npm script exists in package.json; every backend test
                       path exists; the postgres image and the alembic downgrade target MATCH the
                       local harness (tests assert both, so CI cannot drift from it); each gate has
                       been run locally where the environment allows.
  NOT REMOTELY RUN   — no GitHub runner has executed any of it. BLOCKED_EXTERNAL under RELEASE-001.
  Do NOT describe these as passing. A workflow can be valid, call real commands, and still fail on
  a fresh runner. NOT locally validated: the `uv`-based steps — uv is not installed on this
  machine (the repo uses .venv/bin/python directly), so setup-uv's behaviour is unverified here.

JOB BOUNDARIES FOLLOW STATE: backend and backend-postgres are separate runners with separate
disposable databases, so parallel is safe. Inside `browser`, standard then QA run SEQUENTIALLY —
they build from the same .next and QA binds fixed ports; running them together is faster and the
evidence is worthless. A test asserts the ordering and that the job does not fan out.

A REAL PRODUCTION SECURITY FINDING, found by running the audit rather than assuming the recorded
"zero findings" still held: `npm audit --omit=dev` reports THREE HIGH advisories —
prisma -> @prisma/config -> deepmerge-ts.
  >> THE REACHABILITY ARGUMENT BELOW IS WRONG AND WAS SUPERSEDED BY PHASE 10E-2. It is kept
  >> verbatim because the mistake is instructive: it reasons from the manifest, and a production
  >> install contains the chain anyway. Do not act on this paragraph.
  Reachability: @prisma/client declares NO runtime dependencies and lists `prisma` as a PEER
  dependency (verified in node_modules/@prisma/client/package.json), which is why npm counts the
  CLI's tree as production. The vulnerable code is CLI config parsing at build/generate time, not
  on a request path.
  The published fix is a semver-major DOWNGRADE to prisma 6.12.0 — a data-layer decision, so
  remediation is BLOCKED_PRODUCT_DECISION rather than quietly accepted.
  NOT SUPPRESSED. scripts/audit-production-dependencies.mjs compares reported advisories against
  security/npm-audit-allowlist.json, where each entry records WHY it does not apply; anything NOT
  analysed FAILS the gate. It also reports stale exceptions, because an allowlist entry for an
  advisory npm no longer reports is how a real finding gets waved through later.
  Deliberately NOT `--audit-level`: raising a threshold stops whole classes of finding being
  reported at all, which is suppression wearing a threshold's clothes. A test asserts the flag is
  absent.
  Mutation-proven: removing one allowlist entry fails the gate (exit 1).

NEXT READY: PLATFORM-002 config contract, PLATFORM-003 migration release step, PLATFORM-005 health.
```

## Phase 10D checkpoint (legal archive routing — provenance complete)

```text
COMMIT: "feat(legal): let a superseded version still be read"
MIGRATION: none. FRONTEND: tsc clean, eslint clean, node tests 1,185 -> 1,188 (+3).
Unblocked by a resolved product decision: superseded versions SHOULD stay reader-retrievable.

ROUTES: /terms/{version} and /privacy/{version} render exactly the named immutable version.
  - the UNVERSIONED pages remain the canonical reader surface, and now link the permalink for the
    active version, so an acceptance record naming it stays readable after the wording changes;
  - an UNKNOWN version is a 404, never a fallback to current wording. Showing one text while
    claiming to be another is worse than showing nothing, and is exactly the confusion the archive
    exists to remove;
  - noindex + canonical back to the unversioned page: a provenance surface, not an acquisition one.
    Indexed old terms would compete with the current ones in search results;
  - ABSENT from the sitemap, asserted by a test that also checks the unversioned pages are present.

No wording was written or altered. Retention policy untouched.

STILL OPEN and unchanged: LEGAL-002 (counsel), retention duration.
NEXT READY: CI-001/CI-002 workflows.
```

## Phase 10C checkpoint (PLATFORM-004 — bounded pool, explicit capacity)

```text
COMMIT: "feat(db): bound the connection pool in code, and make production state its capacity"
MIGRATION: none. VERIFICATION: pytest exit 0, zero ^FAILED/^ERROR, junitxml 7,369 tests /
  0 failures / 0 errors / 64 skipped.
COLLECTION 7,335 -> 7,369 (+34), fully accounted for: +22 test_container_hardening.py (added in
  PLATFORM-001 and never present in a full run, since source-level container assertions cannot
  affect application behaviour) and +12 test_db_pool_bounds.py.

THE SPLIT, per explicit decision: the CODE enforces BOUNDEDNESS, the DEPLOYMENT supplies CAPACITY.
No production default exists for pool size, and that is the point — "20 connections, that seems
normal" is fine for one process and exhausts a small managed Postgres plan the moment eight of
them run against it. The failure is not an error: the pool blocks, requests queue, and the
application is merely slow. Nobody checks a connection limit when the symptom is latency.
  Code guarantees: finite pool_size, finite max_overflow, bounded pool_timeout (without it,
  exhaustion becomes requests hanging until their client gives up — an outage with no error
  anywhere), and pool_recycle so a connection is replaced by us rather than found dead.
  Production requires DB_POOL_SIZE and DB_MAX_OVERFLOW or refuses to start, and the refusal says
  what the number depends on — an operator forced to set a variable with no explanation picks
  something as arbitrary as the default would have been.
  Schema bounds the bound: 0 or 500 are both refused.
SQLite gets NO pool options: the driver serialises access, so pool arguments either error or mean
nothing.
Mutation-proven: removing pool_timeout or making max_overflow unbounded fails two tests.

REMINDER for future production settings: tests/test_config.py::_safe_production_settings must gain
any new production requirement, or every production-validation test fails at once. That is the
intended signal, and it has now fired twice.

NEXT READY: CI-001/CI-002 workflows (.github/workflows does not exist), PLATFORM-002 config
contract, PLATFORM-005 health contracts.
```

## Phase 10B checkpoint (legal version provenance — the gap LEGAL-001 found, closed)

```text
COMMIT: "feat(legal): make a published legal version an immutable snapshot"
MIGRATION: none. FRONTEND: tsc clean, eslint clean, node tests 1,181 -> 1,185 (+4).
Unblocked by an explicit decision: the architecture only needs to make 2026-06-01 an immutable
retrievable snapshot NOW, and preserve each later version when it is actually introduced. That
closes provenance without inventing any future wording or policy.

THE GAP: acceptance records store a version; nothing could turn that version back into the wording
it named. The pages held their text inline and showed no version, so "they accepted 2026-06-01"
pointed at nothing retrievable — and editing a page silently changed what every earlier acceptance
appeared to mean.

NOW: lib/legal/versions/2026-06-01.ts holds the wording, moved VERBATIM out of the two pages —
nothing was reworded, because writing wording is LEGAL-002 and not a side effect of relocating a
constant. lib/legal/index.ts registers published versions (never removed) and names the current
one. Both pages render from the registry and display the version to the reader.

ENFORCED BY CHECKSUM, not by asking people to be careful: an edited archive still renders and
still passes every other test while quietly rewriting history. Changing wording means ADDING a
version file — more work than editing one, deliberately, because the extra step is where somebody
notices that existing acceptances no longer cover what is shown.
The test also pins the backend's declared version against the archived set: a backend accepting
against wording nobody can produce is the exact failure its own module warns about.
The checksum test proved itself on first run by rejecting a placeholder value.

STILL OPEN, and not answered here: whether superseded versions must be REACHABLE TO A READER (a
public archive, a permalink). That is product and counsel. The bytes now survive to answer it.

NEXT READY: PLATFORM-004 (pool bounds — explicit production configuration, no baked-in capacity
numbers), then CI-001/CI-002 workflows, PLATFORM-002, PLATFORM-005.
```

## Phase 10A checkpoint (PLATFORM-001 — container hardening)

```text
COMMIT: "harden(container): stop the image running as root and shipping the working directory"
MIGRATION: none. FOCUSED: tests/test_container_hardening.py (22). No full suite: source-level
  container assertions cannot affect application behaviour.

TWO REAL GAPS in an otherwise good Dockerfile (locked prod-only deps already existed):
  1. IT RAN AS ROOT. A remote-code-execution bug becomes root inside the container, and from there
     the distance to the host is one runtime vulnerability. Nothing the API does needs root.
     Now: uid 10001, nologin shell, USER before CMD (a USER after CMD is ignored — a test asserts
     the ordering, because creating a user and never switching to it looks hardened and runs as
     root).
  2. `COPY . .` SHIPPED THE BUILD CONTEXT — a developer's working directory: the test suite, the
     local SQLite databases with real dev data, and any .env. A secret baked into a layer survives
     its own deletion in a later layer, so .dockerignore is the only place to stop it. Secrets are
     listed first so a reader meets the reason first.

HEALTHCHECK IS LIVENESS, NOT READINESS, and a test pins that: consulting the database would
restart a healthy container during a blip and turn a partial outage into a crash loop. Bounded
timeout/retries plus a start-period, because an unbounded check hangs against the wedged process
it exists to detect, and no start-period kills a container for being slow to boot.

BLOCKED_ENVIRONMENT: the actual image build and vulnerability scan. Docker is unavailable, so
these 22 assertions are source-level only — recorded as such rather than described as a scan.

NEXT READY: CI-001/CI-002 workflows (none exist — .github/workflows is absent), PLATFORM-002
config contract, PLATFORM-005 health contracts.
```

## Phase 9 certification — LOCALLY COMPLETE

```text
Scope: privacy, legal mechanics, support, moderation. Two live security defects were found and
fixed during this phase, neither of which was a ledger item — both were found by reading the code.

  PRIV-001  IMPLEMENTED  versioned legal acceptance (0065): rows, not a boolean; server owns the
                         version; a superseded acceptance counts for nothing.
  PRIV-002  IN_PROGRESS  export content rule done (their messages only, no credentials, every
                         field named by hand). Delivery — reauth, expiring link, async archive —
                         not built.
  PRIV-003  IN_PROGRESS  request/hide/revoke/cancel done (0067, 0068). ERASURE needs a retention
                         period: BLOCKED_PRODUCT_DECISION.
  PRIV-006  IMPLEMENTED  consent (0066) + signed POST-only unsubscribe with no expiry by design.
  MOD-001   IMPLEMENTED  enforcement hardening: both blocking states, everywhere, one helper.
  MOD-002   IN_PROGRESS  append-only enforced structurally. Retention/export of audit open.
  SUPPORT-001 IMPLEMENTED internal queue (0069). No customer-facing intake by design.
  LEGAL-001 INVENTORY_COMPLETE  docs/LEGAL_SURFACE_INVENTORY.md.
  LEGAL-002 BLOCKED_EXTERNAL  counsel.
  PRIV-004/005  NOT_STARTED  both depend on the retention decision.

THE TWO DEFECTS, stated plainly because they were real:
  1. A deletion request wrote `suspended_at`, and the suspend endpoint refuses an already-suspended
     account — so requesting deletion made an account IMPOSSIBLE TO SUSPEND, and cancelling
     restored a clean account. Fixed by separating the states (0068).
  2. Three enforcement points read suspension alone, so a deletion-hidden account could still LOG
     IN, keep a PUBLIC PROFILE, and keep a public TALENT LISTING.
  Both are the same class: two independent lifecycles sharing one column, or one column being
  checked where two should be.

Evidence, uncontended and local, in the mandated order:
  pytest exit code   0
  FAILED / ERROR     0 / 0
  junitxml           7,335 tests / 7,271 passed / 64 skipped / 0 failed / 0 errors
  collection         7,282 -> 7,294 -> 7,308 -> 7,335, every delta accounted for
  alembic            single head 0069_support_tickets (0065, 0066, 0067, 0068, 0069)
  frontend           untouched by this phase after the acceptance API; not re-run for backend-only
                     support/legal work (risk-based, per the phase instruction)

Every protection added in this phase was mutation-tested: the escape itself, the enforcement door,
the audit append-only guard, the assignee validation, the resolve guard, the message-ownership
filter in export, the unsubscribe signature, and the consent check.
```

## Phase 8 certification — LOCALLY COMPLETE

```text
Scope: realtime and shared state. The important finding is what did NOT need building.
app/realtime/events.py already emitted only after the database commit, decided authorization per
recipient (including the blocking check), and sent hints rather than records. The phase's target
principle was already the implementation, so the work was a seam and its guarantees.

  REALTIME-001  IMPLEMENTED  RealtimeBus seam, event envelope with a REQUIRED id, per-connection
                             at-least-once dedupe, publish that can never fail a write, and a
                             production refusal of the process-local bus.
  REALTIME-002  VALIDATED    typing expiry/disconnect/multi-tab already existed and is now
                             pinned. PRESENCE HAS NO PRODUCT SURFACE — nothing to give TTL to.
  REALTIME-003  IMPLEMENTED  canonical state proven to survive a total realtime outage through
                             the real route; /api/v1/health/realtime separates "configured" from
                             "cross_instance".

Evidence, uncontended and local:
  backend      7,121 passed / 64 skipped / 0 failed   (Phase 8 start: 7,096)
  frontend     1,181 passed / 0 failed;  tsc --noEmit exit 0
  ruff         clean on every changed file (app/realtime/events.py carries a pre-existing
               import-order finding, untouched by this phase and part of the known baseline)
  alembic      single head 0064; Phase 8 added no migration
  collection   7,160 -> 7,178 -> 7,185, every delta accounted for

NOT PROVEN, and not claimed: real cross-process delivery. No broker is available, so the bus
contract is implemented and tested while multi-instance delivery is unverified. The refusal in
build_realtime_bus() is what stops that gap being discovered in production instead of here.

Three decisions worth carrying:
  - dedupe is PER CONNECTION. Two tabs are two audiences; per-user dedupe would silence the
    second tab, and per-process dedupe would silence a reconnect.
  - a publish that fails is logged and swallowed. The message is already committed and the client
    reconciles over HTTP, so raising would report a failed send for a message that was sent.
  - configuring a bus that is not implemented REFUSES rather than falling back. Silent
    process-local delivery wearing the name "redis" is the same failure in disguise.
```

## Phase 7 certification — LOCALLY COMPLETE

```text
Scope: durable media. Two real defects were found and fixed here, neither of which was on the
ledger as a known bug — they were found by reading the upload path.

  MEDIA-001  IMPLEMENTED   MediaStorage seam + LocalMediaStorage + owner-scoped unguessable keys
                           validated at every entry point. Object-store adapter BLOCKED_EXTERNAL.
  MEDIA-002  DEFERRED_WITH_RATIONALE  grants/quarantine protect a direct-to-bucket architecture
                           that does not exist here; every byte is validated before storage.put.
  MEDIA-003  IMPLEMENTED   format decided by BYTES, mismatch refused, pixel caps, EXIF/XMP/text
                           stripped. Re-encoding not done: needs an imaging library.
  MEDIA-004  IMPLEMENTED   stored URLs come from MEDIA_PUBLIC_BASE_URL; production will not boot
                           without it.
  MEDIA-005  IN_PROGRESS   replacement no longer orphans. Account-deletion cascade and an orphan
                           sweep remain, and want a stored key column.

THE TWO DEFECTS, stated plainly because they were live:
  1. The stored file's extension came from the caller's declared content_type, so anything could
     be uploaded as image/png and served from this application's own origin at a .png path.
  2. Stored media URLs were built from the request Host header, so a poisoned Host was PERSISTED
     into a profile and served to every later visitor. Stored, not reflected.
  A third, smaller: an avatar taken on a phone published its GPS coordinates. Now stripped.

Evidence, uncontended and local:
  backend      7,096 passed / 64 skipped / 0 failed   (Phase 7 start: 7,034)
  frontend     1,181 passed / 0 failed;  tsc --noEmit exit 0
  ruff         clean on every changed file
  alembic      single head 0064; Phase 7 added no migration
  collection   7,098 -> 7,123 -> 7,148 -> 7,157 -> 7,160, every delta accounted for

Found on the way, worth knowing: a test fixture PNG was CORRUPT — its IDAT length field disagreed
with the chunk by two bytes (CRC-verified). Nothing had ever parsed it, so it passed for as long
as it existed. If an image fixture starts failing after a parser change, check the file first.
```

## Phase 6 certification — LOCALLY COMPLETE

```text
Scope: AI Job Import production hardening. The feature is unchanged as a product — source text,
interpretation, a canonical draft, the SAME Post Job flow, human review, publication. Nothing was
made "safe" by making it useless: no inference was removed, no second review surface added, and
no route can publish.

  AI-001  IMPLEMENTED  durable execution: lease, atomic claim, bounded attempts, retry schedule,
                       sweep. Live multi-worker race NOT proven (no PostgreSQL harness).
  AI-002  VALIDATED    creation idempotency predates this work; the expensive half now asserted
                       as a call count — a repeat buys no second draft and spends no attempt.
  AI-003  IMPLEMENTED  per-user quota consumed in one statement, window reset inside it.
                       Migration 0064. Same concurrency caveat as AI-001.
  AI-004  IN_PROGRESS  allowlist + output cap done; spend bounded in ATTEMPTS. A budget in
                       CURRENCY is BLOCKED_PRODUCT_DECISION — needs real per-model prices.
  AI-005  VALIDATED    by survey: measured 90s timeout, one transient-only retry, retry-after.
  AI-006  VALIDATED    /api/v1/health/job-import: credential, model, queue recovery. No provider
                       call — a probe that asked the provider would bill a load balancer.
  AI-007  VALIDATED    by survey: no route publishes; can_publish_directly asserted False in
                       three suites; injection cannot write publication state.
  AI-008  VALIDATED    by survey: URL import inherits SafeOutboundFetcher from Phase 2.
  AI-009  VALIDATED    payload minimization PINNED — permitted fields enumerated so the payload
                       fails when it grows; extra="forbid" proven; store=False asserted.
  AI-010  IMPLEMENTED  large corpus predates this phase, including prompt injection.
  AI-011  VALIDATED    real server-side kill switch (JOB_IMPORT_ENABLED).

Evidence, uncontended and local:
  backend      7,034 passed / 64 skipped / 0 failed   (Phase 6 start: 6,913 / 64)
  frontend     1,181 passed / 0 failed;  tsc --noEmit exit 0
  ruff         clean on every changed file
  alembic      single head 0064_job_import_quota_counters; 0063 and 0064 render both ways offline

Collection movement across the phase was checked at EVERY broad run and every delta accounted
for: 6,977 -> 7,018 -> 7,048 -> 7,065 -> 7,086 -> 7,098. A drop is treated as a failure even at
zero reported failures — that rule exists because a file overwrite once removed 47 tests silently.

Three design decisions worth carrying forward:
  - the sweep NEVER calls the provider. Unattended retries spend money for someone who is not
    there to see the result, and it is what makes the sweep safe to run while the kill switch is
    off — which is exactly when someone is trying to stop provider work.
  - backoff restrains the machine, not the person. A recruiter pressing "try again" does not wait
    out a delay the system invented for itself.
  - ownership (lease) and lifecycle (status) are separate axes. Conflating them made the very
    next state transition illegal and broke every import; the tests caught it immediately.

Two structural lessons: on SQLite a read-then-write rewrite passes EVERY behavioural test for
both the claim and the quota. Structure is the only witness there, which is why those tests
exist and why they are mutation-checked.
```

## Phase 5 certification — LOCALLY COMPLETE

```text
Scope: invite-only beta and durable transactional email.
Status: every row VALIDATED except EMAIL-005, which is BLOCKED_EXTERNAL and cannot be closed from
        this machine. Certifying the rest does not certify EMAIL-005 and must not be read that way.

  INVITE-001  VALIDATED  invitation bound to one address and one use; single use enforced by the
                         write (redeemed_at IS NULL), not by a read
  INVITE-002  VALIDATED  one gate, called before create_user on BOTH the password and Google
                         paths; redemption in the same transaction as the account
  EMAIL-001   VALIDATED  lease/claim in one statement, bounded retries, provider seam, worker
  EMAIL-002   VALIDATED  auth mail queued inside the transaction; runner.py drains the queue
  EMAIL-003   VALIDATED  event mail proven queued-to-sent and retried; second delivery path removed
  EMAIL-004   VALIDATED  asymmetric bounce/complaint suppression; signed, replay-resistant webhook
  EMAIL-005   BLOCKED_EXTERNAL  sending domain, SPF, DKIM, DMARC, bounce domain, provider staging
                         send. Needs DNS and a paid provider; both are outside the mandate.

Evidence, all uncontended, all local:
  backend      6,903 passed / 64 skipped / 0 failed   (Phase 5 start: 6,845 / 64)
  frontend     1,181 passed / 0 failed  (node --test)
  typescript   tsc --noEmit, exit 0
  ruff         clean on every changed file; whole-tree findings remain the known baseline
  alembic      single head 0062_email_suppressions; 0060, 0061, 0062 upgrade AND downgrade render
               offline. No PostgreSQL harness was run: Docker is unavailable here, and that is an
               environment limitation, not a passing result.

Non-vacuity was proven by mutation for every protection added in this phase, not assumed:
  gate removed from both signup paths      -> uninvited signup returns 200, test fails
  redemption returned to read-then-write   -> the same invitation is redeemed twice, test fails
  inline send restored                     -> the two provider-call-counting tests fail
  runner error guard and event wait removed-> survive-a-bad-pass and shutdown-latency tests fail
  signature and suppression checks removed -> 6 tests fail, including every forgery case

What is deliberately NOT built, so nobody mistakes it for an oversight:
  - the invitation EMAIL. Nothing issues invitations over HTTP yet, so there is no place to send
    it from; the event key auth.invitation is reserved and the queue is ready.
  - an operator view of failed/suppressed rows. EMAIL-002 removed a 503 that made a provider
    outage loud in the request; a misconfigured provider is now visible only in worker logs and
    in rows reaching MAX_ATTEMPTS. That view belongs with the admin panel.
  - anything that would need a real provider, a real domain, or DNS.

Posture on deploy: every new switch is off by default. INVITE_ONLY_BETA unset preserves open
registration exactly; EMAIL_WORKER_IN_PROCESS unset means the API hosts no worker; an unset
EMAIL_WEBHOOK_SECRET refuses every delivery report rather than accepting unsigned ones. Deploying
this phase changes no behaviour until someone turns something on, which is the point.
```

## Phase 4 certification — LOCALLY COMPLETE

```text
Certified at: Phase 4 certification commit (self-resolve with `git log -1 --format=%H`)
TypeScript: PASS. ESLint: 0 errors / 33 known warnings.
Frontend unit: 1,181 passed / 0 failed.
Standard browser (parallel): 466 passed / 4 failed  (baseline was 447 / 23)
QA browser (parallel):       289 passed / 1 failed / 2 skipped  (baseline was 285 / 5)
Serial re-run of all 5:      32 passed / 0 failed  -> every one is parallel-load flake.

DETERMINISTIC FAILURES: 23 -> 0.

Contract reconciliation worth knowing about: `tests/jobCreationUiPolish.test.mjs` pins
PostJobPage source and asserts "remote geography survives hydration", which reads as a
contradiction of the QA contract that a remote job must drop its city. It is not. The polish test
governs hydration and save; the QA test governs a work-mode change. Clearing lives in
`onWorkModeChange` and fires only when the mode crosses the Remote boundary, and hydration strips
only the bare "Remote" sentinel — a deliberately typed "Remote, India" survives both. The source
assertions now state that reconciliation instead of either side being loosened.

Known flaky under parallel load (pass serially, do not chase without reproducing serially first):
  dev-tools.spec.ts:64, post-job-languages.spec.ts:30, settings.spec.ts:428,
  talent-browse.spec.ts:73, qa/workspace-performance.spec.ts:108
```

## Phase 4 progress log (families resolved)

```text
adaptive-profile-overview (3 failures) — FIXED, commit "test(profile): point the recruiter views at identities that exist"
  Cause: the demo marketplace fixture was rewritten. `finance-creator`/"Finance Channel" and
  `example-agency`/"Example Creator Agency" no longer exist in fixtures/demo_job_marketplace.json;
  the current identities are anika_demo/"Money & Mindset" (creator-led) and
  northstar_demo/"Northstar Creator Agency" (agency, carries managed_by_agency_name).
  Product contract was correct throughout — only the entities were stale.
  Verified against the running mock server rather than inferred: /jobs/1 renders
  /u/anika_demo?view=hiring and NO external channel link, because JobHero passes
  channelExternalUrl only for agency posts. Job 1 used to be agency-posted, which is why the
  old test asserted a YouTube href.
  Coverage improved rather than reduced: the entry-point test now checks both branches —
  a creator post (profile link only) and an agency post (/jobs/2: agency profile link plus
  the channel's external page).
  7/7 pass serially.
```

candidate-job-experience (3 failures) — FIXED, commit "test(jobs): assert the application contract the product actually has"
  Three separate causes, none a product defect:
  (a) :118 expected "9 requested details"; the rewritten fixture gives job 1 eleven. Count updated.
  (b) :168 asserted job 4 opens https://example.com/... in a new tab. That contract was
      RETIRED on purpose — `applicationPreflightForJob` pins `mode: "internal"` and nulls
      `externalUrl`, commenting that a stored external mode "belongs to some other hiring
      process the platform never saw and cannot record" and that honouring it "let an old
      record send candidates off the platform". The fixture still carries the old field, so
      job 4 is the exact regression case; the test now asserts the stored URL never becomes a
      link and no popup occurs. Safety property preserved, correctly aimed.
  (c) :208 used `getByText(/^Apply by /)`. The deadline is now folded into the application
      instructions by design ("a deadline is part of the instructions, not a row of its own"),
      so the element starts with the how-to-apply sentence. Now asserts the deadline is visible
      and has not lapsed, which is stricter than the anchor was.
  A disclosure I briefly added to JobActionsPanel was reverted once the code showed external
  apply is a removed feature rather than a missing disclosure.
  7/7 pass serially.

beta-review-safety (3) + phase3b-detail-post (1) — FIXED, commit "test(trust): stop treating a real price as a fake trust signal"
  beta-review-safety: all three failures matched ONLY the `USD|\$[0-9]` clause — no fake-review or
  retired-copy hits. That clause dates from a rupees-only demo corpus; the corpus now carries
  genuinely USD/EUR jobs and TRUST-001 requires showing the posted amount and currency, so
  suppressing "$450–$700 per video" would be the fabrication. Clause dropped, everything else kept.
  Whether the correct currency is shown per job is TRUST-001's contract and remains NOT_STARTED.
  phase3b :27: "About the opportunity" became `aboutBrandLabel` → "About {brand}". Asserting the
  brand-named heading is stronger: it proves the job is attributed to a real hiring identity.

  FINDING FOR TRUST-003 (marketplace metrics, NOT_STARTED) — not actioned here, deliberately.
  `JobActionsPanel` renders StatTiles for Applicants / Views / Response rate, and listing cards
  show "284 Views · 11 Applicants · 86% Response rate" plus talent-side "Currently viewing /
  Interested recruiters / Response rate". These are fixture-seeded demo numbers. Two existing
  tests actively assert they stay visible (phase3b :168 "keeping activity stats", :184 "persisted
  job stats remain visible"), so removing them is a product-policy decision that belongs to
  TRUST-003 with its own slice — not something to smuggle into a browser-test repair. Whoever
  takes TRUST-003 should expect to change those two tests as part of it.

smoke (2) + phase3a-polish (1) + post-job-languages (1) — FIXED, commit "test(phase4): follow the screens and titles the product moved to"
  smoke /jobs/1 route text: job 1 was retitled by the fixture rewrite ("Video editor for YouTube"
  -> "Long-form YouTube editor for evidence-led finance stories").
  smoke :452 and phase3a :31: the same two retirements already handled elsewhere — external apply
  is pinned internal, and the currency clause is stale under TRUST-001.
  post-job-languages :30: screening questions moved from the EVALUATION screen to APPLICATION
  REQUIREMENTS (they sit beside the materials an applicant must include). The test now asserts the
  separation in both directions: absent on Evaluation, present on Applications.
  Noted, not fixed: the APPLICATION REQUIREMENTS heading renders twice on that screen, so the
  assertion uses .first(). Whether that duplication should exist is CORRECT-006 (Duplicate UI
  identity), which is NOT_STARTED and owns it.

mobile-overflow (2) + applications-pipeline (1) — FIXED, commit "test(phase4): measure overflow on a form that still exists, and click the row"
  mobile-overflow: both viewports failed on SETUP, not on overflow — the test grew the form by
  adding a Language requirement, and language requirements were deliberately removed from
  post-job (a sibling test asserts their absence). Re-based on the tools tag input, which grows
  the form the same way and exercises a long unbroken token, the harder overflow case at 320px.
  The footer button is labelled "Continue" now, not "Continue to step N". The overflow assertions
  themselves were never the problem and now actually run at both widths.
  applications-pipeline :286: a genuine locator defect. The card is not a button — its profile
  link, checkbox and stage menu all stopPropagation by design — so Playwright's default centre
  click lands on a child and the row handler never fires. Verified by probe: clicking the labelled
  Message button opens the dock, clicking the card centre does not. Switching the test to the
  button would have made it a duplicate of :486 and hidden the row behaviour, so it clicks the
  card's own surface at an offset instead.

PHASE 4 STANDARD BASELINE NOW: 18 deterministic failures -> 0.

QA: craft-ambiguity (1) + post-job-later-steps (1) — FIXED, commit "fix(post-job): stop a remote job from claiming a city"
  craft-ambiguity :76 answered the baseline's open question (did presentation leak into selection,
  or is the test stale?): neither exactly — the TEST read the option chip's whole innerText, which
  now carries a "Likely match" badge on a second line, and compared it to
  primary_role_name_snapshot. The product correctly stores "Video Editor". Expectation now takes
  the label line.
  post-job-later-steps :669 was a GENUINE PRODUCT DEFECT with two layers:
    (1) onWorkModeChange never cleared the city when the mode crossed the Remote boundary, where
        the field changes meaning — office location vs optional candidate restriction. A job moved
        from Hybrid-in-Kolkata to Remote kept advertising Kolkata. Now cleared on crossing, and
        deliberately NOT between On-site and Hybrid where the meaning is unchanged.
    (2) Fixing (1) revealed the value becoming "Remote": the payload writes `location: "Remote"` as
        a sentinel for "remote, no restriction", and rehydration copied it into the
        candidate-location input — storage bookkeeping displayed as recruiter input, and persisted
        as a real restriction on the next save. Rehydration now refuses the bare sentinel.
  31/31 post-job-later-steps pass; craft-ambiguity passes.

QA: qa-personas (2) + draft-assistant (1) — FIXED, commit "test(qa): measure the bubble once it has landed"
  qa-personas :488 was a strict-mode violation, not a product bug: job-apply-button renders twice
  (desktop panel + mobile sticky bar) with exactly one visible per viewport, and every other spec
  already scopes to `:visible`. 29/29 now, including :602 which the baseline had called flaky.
  draft-assistant :581 was a measurement race, not a layout defect. `ui-bubble-in` animates
  translateY(6px) -> 0 over 240ms; the test measured the typing bubble mid-flight while still
  lifted, so the gap read -1.6px. Replaced the instantaneous read with expect.poll on the gap —
  identical bounds, taken once the animation settles. Not a sleep: a deterministic wait for a
  defined end state. 34/34.

QA: applicant-requirements (1) — FIXED, commit "test(qa): give the resume field a link, because it asks for one"
  Diagnosis chain worth keeping: the ARIA snapshot showed no error (it does not render input
  values), so instrumenting the network was decisive — NO POST fired at all, which ruled out the
  server and pointed at client validation. Dumping the modal text showed "Resume or CV link —
  Enter a valid link." Job 1's requirements grew 9 -> 11 in the fixture rewrite, adding `resume`,
  and the test filler only treated `relevant_portfolio` as a URL field, so it typed prose into a
  link input. The product was correct the whole time.
  3/3 pass.

PHASE 4 DETERMINISTIC FAILURES: 18 standard + 5 QA (23 total) -> 0.
Of those 23, exactly ONE was a product defect (the remote-city bug, two layers). Two were real
test-harness defects (pipeline centre click hitting a stopPropagation child; apply-button strict
mode). One was a measurement race against the ui-bubble-in entry animation. The rest were
expectations that had drifted from a rewritten demo fixture or from deliberate product decisions.

## Phase 4 browser baseline — ESTABLISHED (this replaces the stale 17/6 numbers)

Measured after RATE-004, at commit `d3036da`. Both matrices run in full, then the
standard failures re-run serially with `--workers=1` to separate real defects
from parallel-load flake. **Use this, not the Phase 0 numbers.**

```text
QA (real backend)        285 passed /  5 failed / 2 skipped   (19.1m)
Standard (parallel)      447 passed / 23 failed               ( 7.0m)
Standard (serial re-run) 214 passed / 18 failed               ( 6.4m)  <- the baseline
```

**QA — 5 deterministic failures, and this set is trustworthy.** Every one is
from the original recorded Phase 0 list, and no new failure appeared even though
host load reached 19 during the run, which is what makes it credible rather than
lucky:

```text
applicant-requirements.spec.ts:173   submitted application modal never closes
craft-ambiguity.spec.ts:76           persisted role snapshot lacks "Likely match"
draft-assistant.spec.ts:581          typing indicator overlaps the submitted reply
post-job-later-steps.spec.ts:669     onsite→remote retains the city instead of clearing
qa-personas.spec.ts:488              duplicate job-apply-button test IDs
```

The historical sixth item, `workspace-performance.spec.ts:108`, **passes** —
confirmed twice now. The recorded "6 QA failures" is genuinely 5.

**Standard — 18 deterministic failures.** Five of the 23 parallel failures did
not reproduce serially (`settings`, `listing-card-actions`, `seo-filter-routes`,
`workspace-ia`, `you-applications`) and are parallel-load flake. One failure
appeared only in the serial pass (`phase3b-detail-post.spec.ts:164`), which is
the same family as `:27`. Grouped by what they are actually about:

```text
adaptive-profile-overview  :86 :134 :180   recruiter/agency profile views + entry links
applications-pipeline      :286           pipeline row → chat dock handoff
beta-review-safety         / /jobs /jobs/1  beta trust copy on three surfaces
candidate-job-experience   :118 :168 :208  internal/external application behaviour
mobile-overflow            390px 320px    /post-job horizontal overflow
phase3a-polish             :31            search empty/results states
phase3b-detail-post        :27 :164       job detail + card activity stats
post-job-languages         :30            multi-screen Post Job
smoke                      :69 :452       /jobs/1, external apply semantics
```

Failure types: 17 are assertion failures (`toBeVisible`, `element(s) not found`,
`not.toContainText`) — genuine product contracts, not timing. Exactly one is a
`page.goto` timeout and may be contention; re-check that one first.

Two historical items no longer reproduce at all (`dev-data-source`,
`talent-browse`), so the stale list was wrong in both directions.

**Method note for whoever continues.** Host load moved from 3.8 at launch to 19
during the QA run and was still ~14 during the serial pass. The serial numbers
are usable anyway because `--workers=1` removes the contention sensitivity and
because the failures are assertions rather than timeouts — but a genuinely quiet
host would still be better before fixing the one timeout.

**Note on `beta-review-safety` and `phase3b-detail-post`:** several of these
concern *fabricated marketplace metrics* (response rates, activity stats). The
standing product-truth rule says never invent job views, response rates or
demand. Read those tests before "fixing" them — the correct fix may be removing
a metric rather than making one appear.

## Phase 3I atomic checkpoint (RATE-004 — request-body bounds)

```text
Phase: Phase 3, atomic slice 3I / RATE-004 — request-body safety at the ASGI boundary
Status: COMPLETE for the body-size half of RATE-004. Timeout/concurrency ceilings remain, and the concurrency parts still depend on RATE-001
Initial HEAD: c08dd043444ca9c336791b49e61b035a64859cae
Final HEAD: Phase 3I checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(http): bound a request body before it is anything but bytes
Files materially changed: new `backend/app/middleware/request_body_limit.py`; new `backend/tests/test_request_body_limit.py`; `backend/app/core/config.py` (two settings); `backend/app/main.py` (middleware registration)
Migrations: None. Dependency changes: none
DEFECT FIXED: nothing bounded an inbound request body. The nearest thing was `MAX_AVATAR_UPLOAD_BYTES`/`MAX_BANNER_UPLOAD_BYTES` in `profile_service`, which are honest about intent but run at `len(image_bytes)` — after the body has been received, buffered, JSON-parsed and base64-decoded. Every one of those steps allocates, so a few hundred megabytes of JSON was fully in memory before anything objected
ARCHITECTURE: pure ASGI middleware, deliberately not `BaseHTTPMiddleware`, because the guarantee depends on controlling `receive` directly. Two independent rules: (1) a declared `Content-Length` over the ceiling is refused without reading a byte; (2) bytes are counted as each `http.request` message arrives, so omitting `Content-Length` and streaming buys nothing. Rule 2 is the one that matters — treating the declared length as the whole defence means anyone willing to drop the header faces no limit at all. It never buffers: a limiter that reads the body to measure it has moved the unbounded allocation rather than prevented it
PLACEMENT: registered first, so it runs innermost — inside CORS, QA audit and request-id. Nothing outside it reads the body, so the memory guarantee is identical wherever it sits, but from here the 413 travels back out through those layers and therefore carries CORS headers and `X-Request-ID`. A browser cannot read a 413 that CORS never touched
LIMITS, derived rather than chosen: the largest legitimate payload is the **banner**, not the avatar — 8 MiB decoded, which is roughly 10.7 MiB once base64's 4/3 expansion, the data-URL prefix and JSON quoting are counted. Media ceiling is 12 MiB (`MAX_MEDIA_REQUEST_BODY_BYTES`); everything else gets 2 MiB (`MAX_REQUEST_BODY_BYTES`), comfortably above job-import source text at 100,000 characters. A test asserts the media ceiling can still fit a real banner, so a future tightening cannot silently break uploads. Both settings have a floor of 64 KiB so they cannot be configured into uselessness
ROUTE POLICY: exact path equality only, against `{api_v1_prefix}/me/avatar` and `/me/banner`. Prefix or substring matching would let a caller claim the larger allowance with a crafted path; `/me/avatarx` is tested and gets the default. Unrecognized paths fail toward the smaller ceiling
LAYERING: this does not replace the decoded checks in `profile_service` and must not be made to. The outer bound protects the process and cannot know that 9 MiB of base64 decodes to something too large to be an avatar; the inner bound protects product meaning and cannot run before the allocation it is trying to bound
Tests: 25 focused middleware cases covering empty/at-limit/over-limit, declared-length refusal, streamed and many-small-chunk bypass attempts, an under-limit stream arriving intact, malformed `Content-Length` (`-1`, `abc`, empty, 22-digit) never becoming a 500, the media allowance and its ceiling, prefix-match rejection, WebSocket connect, GET, and that the refusal does not echo the body back
NON-VACUITY, proven: removing only the streaming byte count — leaving the `Content-Length` path intact — made both streaming tests return 200 OK. That is exactly the bypass a declared-length-only limiter has. Restored afterwards
ONE ASSERTION CORRECTED, not weakened: the first draft asserted the handler is never entered for a streamed oversize body. That is wrong about ASGI — the application is called when the request starts and the body arrives afterwards. The real guarantee, now asserted, is `bytes_seen == 0`: the handler never completes the read, so no full body is ever assembled. For the declared-length path the handler genuinely is never entered, and that is still asserted
Exact results: middleware suite 25 passed; focused dependent matrix 161 passed (profile, creator profile, realtime blocking, messaging, auth/channels, config, job URL import); complete uncontended backend 6,759 passed / 64 skipped / 0 failed in 310.01s; Ruff clean
Count reconciliation: 6,731 (pre-RATE-004 baseline) + 3 `TestSecurityFloorsHold` cases added after DEP-002E's suite run + 25 new middleware cases = 6,759. No unexplained movement
Manual security review: no Content-Length-only path; no chunked bypass; arbitrary-precision integer parse handles a 22-digit declared length correctly; no buffering or chunk duplication; messages pass through unmodified so nothing is truncated; non-HTTP scopes bypass entirely; exact route matching; the error carries only the limit number and never any body content; response-start is tracked so a late overflow re-raises rather than fails open
Next slice: the remaining RATE-004 surface is timeouts and concurrency ceilings — read the ledger for what it actually asks. Then Phase 4, which needs a fresh browser baseline on a quiet host
```

## RATE-004 request-body bounds — the original finding (spent in Phase 3I; kept for the reasoning)

Investigated at the end of Phase 3H and left deliberately unstarted, because a
global ASGI middleware sits in front of all 6,731 tests and wanted more budget
than remained. The finding is specific and the fix is well-shaped.

```text
Nothing bounds an inbound request body. `rg -n "max_body|content-length" backend/app`
returns only `safe_outbound_fetch.py`, which bounds *outbound* responses (Phase 2A).
There is no inbound equivalent.
```

The reachable path is avatar and banner upload. There are no `UploadFile`
endpoints — the browser sends a base64 **data URL inside a JSON body**
(`readFileAsDataUrl` in `components/you/YouHubClient.tsx` →
`AvatarUploadRequest`). And:

- `backend/app/schemas/profile.py:213` declares `data_url: str` with **no `max_length`**;
- `backend/app/services/profile_service.py:1963` does check `MAX_AVATAR_UPLOAD_BYTES`
  (5 MiB) — but only **after** `len(image_bytes)`, i.e. after the whole body has
  been read, the JSON parsed, and the base64 decoded.

So the size limit exists and is honest about intent, but it runs too late to
protect memory: a multi-hundred-megabyte JSON body is fully materialised before
anything rejects it. That is a denial-of-service surface on an authenticated but
ordinary endpoint.

**Shape of the fix.** An ASGI middleware that bounds the body *before* it is
read: reject on `Content-Length` over the limit as a fast path, and also count
bytes while streaming so a chunked request with no `Content-Length` cannot walk
past it. Answer 413 in this application's canonical `{"error": {code, message}}`
envelope, not FastAPI's default shape. Make the limit configuration with a
server-side default.

**Sizing it.** The largest legitimate body is an avatar/banner upload: 5 MiB
decoded, roughly 6.7 MiB as base64, plus JSON overhead. Job-import source text is
capped at 100,000 characters (`MAX_IMPORT_SOURCE_TEXT_LENGTH`), so ~100 KB. A
10 MiB ceiling is generous for real traffic and still bounds the surface. Verify
against the avatar tests before settling on a number.

**Why it needs the full backend suite:** it is global middleware, so it is in
front of every request every test makes. Expect to run the complete suite, and
check the multipart-free assumption still holds first.

## Phase 3H atomic checkpoint (DEP-002E — the FastAPI/Starlette migration)

```text
Phase: Phase 3, atomic slice 3H / DEP-002E — the framework pair
Status: COMPLETE. DEP-002 is VALIDATED
Initial HEAD: 2f77ef9e084b96748c2417051cce49534ded9d2c
Final HEAD: Phase 3H checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): deps(backend): move the framework pair past the host-header and UNC flaws
Files materially changed: `backend/pyproject.toml`, `backend/uv.lock`, `backend/tests/test_packaging_contract.py`
Migrations: None
Dependency changes: fastapi 0.129.0 → 0.141.1; starlette 0.52.1 → 1.6.0. Manifest floor `fastapi>=0.115.0` → `>=0.141.1`
Lockfile changes: 14 lines. Only those two packages moved — anyio 4.12.1, pydantic 2.12.5, httpx 0.28.1, websockets 16.0 and uvicorn 0.40.0 are all unchanged. A framework major with no transitive drift is the outcome to expect here; a large unexplained lock diff would have meant something else was happening
Advisories resolved (10): GHSA-86qp-5c8j-p5mr and PYSEC-2026-161 (missing Host-header validation poisoning `request.url.path`); GHSA-jp82-jpqv-5vv3 (unvalidated request path concatenated into the authority); GHSA-wqp7-x3pw-xc5r (SSRF and NTLM credential theft via UNC paths in StaticFiles); GHSA-x746-7m8f-x49c (arbitrary HTTP method dispatched to `HTTPEndpoint` attributes); GHSA-82w8-qh3p-5jfq (`request.form()` limits silently ignored); plus PYSEC duplicates
REACHABILITY NOTE: `app/main.py:66` mounts `StaticFiles(directory=media_root)` at `settings.media_base_path`, so the UNC-path advisory was directly reachable in production rather than theoretical. That is the strongest single reason this migration was worth its risk
METHOD — framework primitives proved before the suite ran. A major like this can break one thing every test touches and present as thousands of unrelated product failures, so "does the framework work" was answered separately from "does the product work" using a scratch harness covering: application import, router registration, OpenAPI generation, the StaticFiles mount, TestClient construction and lifespan, header round-trip, the `{"error": {code, message}}` envelope on both validation and not-found, CORS accepting the configured origin and refusing an unlisted one, the middleware stack, an authenticated dependency chain refusing an anonymous caller, and the realtime WebSocket refusing an unauthenticated connection cleanly. All thirteen passed
FRAMEWORK BEHAVIOUR CHANGE FOUND, and worth knowing: Starlette 1.x no longer flattens `include_router` into `app.routes`; included routers nest under a `_IncludedRouter`, so top-level `app.routes` is 7 while `app.openapi()["paths"]` correctly reports 202. Nothing in `backend/app`, `backend/tests` or `backend/scripts` iterates `app.routes`, so no compatibility shim was needed — but code that did would have failed in a way that looked nothing like a dependency problem
Tests run: 13-check framework primitive harness; focused matrix of 155 real tests across realtime/websockets, messaging, interaction transitions, config, packaging, trusted identity, auth, sessions, administrator strong auth and marketplace; complete uncontended backend suite; production-set re-audit; Ruff
Exact results: framework primitives 13/13; focused matrix 91 + 64 = 155 passed; complete backend 6,731 passed / 64 skipped / 0 failed in 318.11s — byte-identical to the pre-migration baseline, so a twelve-minor FastAPI jump plus a Starlette major required no test changes at all; Ruff clean
Vulnerabilities before/after against the locked production set (52 packages): 1 vulnerable package → 1. The remaining entry is ecdsa's Minerva timing attack, which has no fix and none planned upstream, is already classified NOT_REACHABLE_WITH_EVIDENCE, and was made structurally unreachable in Phase 3G by narrowing `jwt_algorithm` to the HMAC family. Every actionable backend advisory is now closed: the programme went 9 vulnerable packages → 0 actionable
New guards: `TestSecurityFloorsHold` asserts the FastAPI and cryptography floors in the manifest and that the lock honours them. Both were verified non-vacuous by lowering the floors to their pre-remediation values, which failed exactly those two assertions; restored afterwards. These exist because a floor is easy to lower while resolving an unrelated conflict, and lowering either silently reintroduces a known vulnerable package
Next slice: DEP-003 (production dependency set — SBOM inspection remains; the clean production sync is done and the Docker image build stays BLOCKED_ENVIRONMENT), then the remaining Phase 3 ledger items, then Phase 4
```

## DEP-002E — starlette: the compatibility research (spent in Phase 3H; kept for the reasoning)

The last vulnerable production package, and the only one left open. Do not
attempt `uv lock --upgrade-package starlette`; it cannot move on its own.

```text
Current:  fastapi 0.129.0  requires  starlette<1.0.0,>=0.40.0   <- the actual blocker
          starlette 0.52.1
Target:   starlette 1.x    (10 advisories)
Requires: fastapi 0.141.1  requires  starlette>=0.46.0          <- no upper bound
```

So this is a twelve-minor FastAPI jump (0.129 → 0.141) taken together with a
Starlette major (0.52 → 1.x). It is a framework migration and deserves its own
session, not the tail of another one.

The advisories it closes are worth the work — they are the most serious findings
left in the backend: `GHSA-86qp-5c8j-p5mr` and `PYSEC-2026-161`, missing Host
header validation that poisons `request.url.path` and can bypass path-based
checks; `GHSA-jp82-jpqv-5vv3`, unvalidated request path concatenated into the
authority; `GHSA-wqp7-x3pw-xc5r`, SSRF and NTLM credential theft via UNC paths
in StaticFiles; `GHSA-x746-7m8f-x49c`, arbitrary HTTP method dispatched to
`HTTPEndpoint` attributes; `GHSA-82w8-qh3p-5jfq`, `request.form()` limits
silently ignored.

Before upgrading, read the FastAPI release notes across 0.129 → 0.141 and the
Starlette 1.0 notes for breaking changes. This application's exposed surface is
wide, so validate at least: dependency injection and `Depends` defaults; the
custom error envelope `{"error": {...}}` and exception handlers; middleware
ordering; CORS; lifespan/startup; WebSockets (`/ws/conversations` — realtime
messaging is a live consumer); streaming responses; file upload; background
tasks; and `TestClient` behaviour, since the whole 6,731-case suite runs through
it and a TestClient change would look like mass product failure rather than a
harness change.

## Phase 3G atomic checkpoint (DEP-002D — ecdsa, and making it unreachable)

```text
Phase: Phase 3, atomic slice 3G / DEP-002D — ecdsa
Status: COMPLETE (DEP-002 remains IN_PROGRESS; starlette is the last vulnerable production package)
Initial HEAD: cfacdd61dfaf03838c564f11e503b60eedc8650e
Final HEAD: Phase 3G checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): deps(backend): patch ecdsa, then make the unpatchable part unreachable
Files materially changed: `backend/uv.lock`, `backend/app/core/config.py`, `backend/tests/test_config.py`
Migrations: None
Version: ecdsa 0.19.1 → 0.19.2 (transitive, via python-jose)
Advisories resolved: GHSA-9f5j-8jwj-x28g and PYSEC-2026-2467 — improper DER length validation, a denial of service
RESIDUAL, and this is the important part: GHSA-wj6h-64fc-37mp / PYSEC-2026-1325, the Minerva timing attack on P-256, is NOT fixed in 0.19.2 and never will be. The OSV record carries `introduced: 0` with no fixed event, and the advisory text states plainly that "the python-ecdsa project considers side channel attacks out of scope for the project and there is no planned fix". Upgrading was therefore never going to clear this one, and no amount of version-chasing will
Classification: NOT_REACHABLE_WITH_EVIDENCE, and the evidence is four-part. (1) The advisory itself scopes the flaw to `SigningKey.sign_digest()`, key generation and ECDH, and says "ECDSA signature verification is unaffected". (2) `jwt_algorithm` defaults to `HS256` and nothing in `backend/app` references ES256/ES384/ES512, EllipticCurve, SECP or ecdsa. (3) Empirically, `ecdsa` is absent from `sys.modules` after a complete python-jose HS256 encode-and-decode cycle — python-jose imports it lazily, so the module is not merely unused, it is not loaded. (4) The one hole in that argument was that `JWT_ALGORITHM` is environment-configurable, so a deployment could have selected ES256 and made the package reachable
That hole is now closed structurally rather than documented: `jwt_algorithm` is a `Literal["HS256", "HS384", "HS512"]`, so the asymmetric families are rejected at configuration parse time. This is not a functional restriction — tokens are signed with `jwt_secret`, a shared secret, and an asymmetric algorithm with a shared secret is a misconfiguration rather than a choice. It converts "not reachable today" into "cannot become reachable", which is the difference between an exception and a guarantee
Tests run: focused config suite; auth/session/strong-auth/OAuth-refresh/session-migration suites; complete uncontended backend suite; Ruff on both changed files; production-set re-audit
Exact results: config 17 passed (including a new case asserting ES256/ES384/ES512/RS256/EdDSA/none/"" are all refused); focused auth 58 passed; complete backend 6,731 passed / 64 skipped / 0 failed in 319.78s — the 6,730 baseline plus the new case; Ruff clean
Vulnerabilities before/after against the real production set: 2 vulnerable packages → 2, but ecdsa's open advisories drop from 4 to 2 and both survivors are now classified with evidence rather than outstanding
Next slice: DEP-002E — starlette, the last one. 0.52.1 → 1.x, 10 issues including missing Host-header validation that poisons `request.url.path` and SSRF/NTLM via UNC paths in StaticFiles. It is a major gated behind FastAPI's supported Starlette range, so FastAPI and Starlette move together; validate middleware, auth, exception handlers, CORS, lifespan, streaming and TestClient behaviour before trusting the full suite
```

## Phase 3F atomic checkpoint (DEP-002C — cryptography)

```text
Phase: Phase 3, atomic slice 3F / DEP-002C — the credential-encryption library
Status: COMPLETE (DEP-002 remains IN_PROGRESS; ecdsa and starlette remain)
Initial HEAD: 3c61a18b6f410472947af44ab2964844f2c66e71
Final HEAD: Phase 3F checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): deps(backend): raise the cryptography floor past the oracle
Files materially changed: `backend/pyproject.toml`, `backend/uv.lock`
Migrations: None
Version: cryptography 46.0.5 → 50.0.0; the declared constraint moves from `>=46.0.5,<47.0.0` to `>=50.0.0,<51.0.0`
Advisories resolved (11, all of them): GHSA-g6cj-pr64-35w5 PKCS#7 EnvelopedData Bleichenbacher oracle (fixed only in 50.0.0); GHSA-jwv3-5hgf-82ww exponential X.509 path building via duplicate self-signed intermediates and GHSA-m2h6-j472-rp4c wildcard DNS escape from permittedSubtrees (both 49.0.0); GHSA-537c-gmf6-5ccf vulnerable OpenSSL bundled in wheels (48.0.1); GHSA-m959-cc7f-wv43, GHSA-p423-j2cm-9vmq and the PYSEC duplicates
WHY THE PIN WAS RAISED RATHER THAN RESPECTED — this was the judgement call of the slice, and the evidence is: (1) `git log -S` shows `<47.0.0` arrived in e18f580 "security(auth): encrypt stored OAuth credentials", i.e. as a conservative major-version guard introduced alongside the feature, not in response to a known incompatibility; (2) nothing downstream caps it — `python-jose[cryptography]` asks only for `>=3.4.0` and google-auth does not bound it either, so the pin was the sole constraint; (3) this codebase touches exactly two symbols from the library, `AESGCM` and `InvalidTag`, in `app/core/oauth_credentials.py` and `app/core/strong_auth_secrets.py`, and that API has been stable since cryptography 2.x. A within-pin bump to 46.0.7 would have closed only 4 of 11 and left the Bleichenbacher oracle, both X.509 escapes and the OpenSSL issue in place. The `<51.0.0` bound is kept deliberately so the *next* major remains an explicit decision rather than a resolver's
Validation appropriate to a security-critical library: the AESGCM round trip and InvalidTag-on-tampered-AAD were exercised directly before any suite ran; then OAuth credential encryption/decryption, the credential migration, the rotation CLI, strong-auth TOTP secrets, strong-auth lifecycle, administrator strong auth and session tests; then the complete uncontended backend suite
Exact results: direct AESGCM/InvalidTag smoke passed; focused crypto/credential/session 58 passed; complete backend 6,730 passed / 64 skipped / 0 failed in 314.60s — identical to the pre-upgrade run, so the major bump changed no observable behaviour
Vulnerabilities before/after against the real production set: 3 vulnerable packages → 2
Remaining and why: ecdsa 0.19.1 → 0.19.2 (DER length DoS and a Minerva timing attack on P-256), which arrives through python-jose and should be a small lock-only slice; starlette 0.52.1 → 1.x (10 issues incl. missing Host-header validation poisoning `request.url.path`, and SSRF/NTLM via UNC paths in StaticFiles), which is a major gated behind FastAPI's supported range and must move as a FastAPI+Starlette pair
Next slice: DEP-002D — ecdsa (small), then DEP-002E — the FastAPI/Starlette pair (framework, needs the full suite plus attention to middleware, auth, exception handlers, CORS, lifespan and TestClient behaviour)
```

## Phase 3E atomic checkpoint (DEP-002B — the low-risk vulnerable group)

```text
Phase: Phase 3, atomic slice 3E / DEP-002B — six transitive/leaf packages with straightforward fixes
Status: COMPLETE (DEP-002 remains IN_PROGRESS; cryptography, ecdsa and starlette remain)
Initial HEAD: ee50d0938bee3f41a516d2d1c7174758001997ec
Final HEAD: Phase 3E checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): deps(backend): close six advisories the lock can fix on its own
Files materially changed: `backend/uv.lock` only
Migrations: None
Versions: click 8.3.1 → 8.4.2; idna 3.11 → 3.18; mako 1.3.10 → 1.4.1; pyasn1 0.6.2 → 0.6.4; pydantic-settings 2.13.0 → 2.15.0; python-dotenv 1.2.1 → 1.2.2. Every one is at or above its earliest fixed version
Advisories resolved (16): click PYSEC-2026-2132; idna GHSA-65pc-fj4g-8rjx + PYSEC-2026-215; mako GHSA-2h4p-vjrc-8xpq and GHSA-v92g-xgxw-vvmm (TemplateLookup path traversal) + 2; pyasn1 GHSA-8ppf-4f7h-5ppj, GHSA-hm4w-wwcw-mr6r, GHSA-jr27-m4p2-rc6r, GHSA-m4p7-r5rc-7g4j (quadratic OID parsing, unbounded recursion, long-form tag DoS) + 4; pydantic-settings GHSA-4xgf-cpjx-pc3j (NestedSecretsSettingsSource symlink escape); python-dotenv GHSA-mf9w-mj56-hr94 (symlink following in set_key) + 1
Why these six together: none of them is constrained by `pyproject.toml`, so the existing ranges already permitted the fixed versions and the lock alone could move them. No manifest edit was needed, which is what makes this group low-risk and coherent as one slice
Method: `uv lock --upgrade-package <name>` six times in one invocation, then `uv lock --check`, then `uv sync --all-groups` to bring `backend/.venv` in line with the lock. That sync also retired the pre-existing drift between the developer venv and the lock: uv reported exactly six removals and six additions, which confirms the venv was otherwise already consistent
Lock delta: 18 insertions / 18 deletions — the six versions and their hashes, no collateral churn
Vulnerabilities before/after, measured against the real production set (`uv sync --locked --no-dev` into a scratch environment, 52 packages): 9 vulnerable packages → 3. Remaining are cryptography, ecdsa and starlette, each of which needs its own slice
Tests run: alembic heads (mako drives migration templates); focused config/auth/session/strong-auth/OAuth-refresh/trusted-identity/packaging suites; complete uncontended backend suite; production-set re-audit
Exact results: alembic single head 0059_oauth_connection_events; focused 101 passed; complete backend 6,730 passed / 64 skipped / 0 failed in 319s — the expected 6,723 baseline plus the 7 packaging-contract tests, with skips unchanged; production audit 9 → 3 vulnerable packages
Risk notes: mako 1.3 → 1.4 is a minor bump on the template engine alembic uses for migration scaffolding, so `alembic heads` was checked explicitly. pydantic-settings 2.13 → 2.15 is the highest-risk item, since the whole configuration system depends on it; the 16-case config suite and the full backend run cover it
Next slice: DEP-002C — cryptography. Then DEP-002D — the FastAPI/Starlette pair
```

## Phase 3D atomic checkpoint (DEP-002A — the packaging contract)

```text
Phase: Phase 3, atomic slice 3D / DEP-002A — make the committed lock the thing production installs
Status: COMPLETE (DEP-002 remains IN_PROGRESS; the version remediation itself is DEP-002B onward)
Initial HEAD: f07ee415dfb23ee1e43f1da0a5a0a40499fbb3d4
Final HEAD: Phase 3D checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): build(backend): install production from the lock, not from whatever resolves
Files materially changed: `backend/Dockerfile`; new `backend/tests/test_packaging_contract.py`; `backend/README.md`; `PROJECT_STATUS.md`
Migrations: None. Dependencies: no version changed in this slice — it changes which artifact decides versions
DEFECT FIXED — production builds were not reproducible: the Dockerfile ran `COPY pyproject.toml README.md ./` followed by `uv sync --all-groups`. `uv.lock` was never copied, so every image build re-resolved the loose ranges in `pyproject.toml` from scratch. Two images built a week apart could ship different versions of every transitive dependency, and — the reason this blocks DEP-002 — pinning a security fix in the committed lock would have had no effect whatsoever on what shipped. This is almost certainly how the running environment drifted to `starlette 0.52.1` and `cryptography 46.0.5`
SECOND DEFECT FIXED — `--all-groups` installed the dev group into the runtime image, so pytest, ruff and aiosqlite shipped to production
Now: `COPY pyproject.toml uv.lock README.md ./` then `uv sync --locked --no-dev`. `--locked` (not `--frozen`) is deliberate: it fails the build when the lock disagrees with the manifest, turning "edited pyproject without relocking" into a build error instead of a silent re-resolution. `UV_NO_SYNC=1` is set so the entrypoint's `uv run` uses the environment baked at build time rather than trying to reconcile it — without that, `--no-dev` would make `uv run` attempt to install the missing dev group over the network during container start
Packaging contract, now explicit and documented in `backend/README.md`: `pyproject.toml` declares, `uv.lock` resolves, production installs from the lock. To change a production dependency: edit `pyproject.toml`, then `uv lock --upgrade-package <name>`, then `uv lock --check`, then `uv sync --all-groups` locally. Never hand-edit the lock; never add `requirements.txt`. `PROJECT_STATUS.md` was pointing at a `requirements.txt` that does not exist and a `make run` target the Makefile does not define — both corrected, because a doc describing a second contract is how the first one gets ignored
TOOLING: `uv` is obtainable here after all. `python3 -m venv <scratch> && <scratch>/bin/pip install uv` produced uv 0.12.5 in an isolated scratch venv that touches neither the project nor `backend/.venv`. Use `UV_CACHE_DIR` and `UV_PROJECT_ENVIRONMENT` pointed at scratch paths to keep it that way. This unblocks DEP-002 remediation — the previous session's blocker is resolved
Verification performed: `uv lock --check` passes against the committed lock (62 packages resolved, exit 0), so the lock was already consistent with the manifest and is trustworthy as the authoritative resolution. `uv sync --locked --no-dev` was then run against a scratch environment and succeeded, installing 52 packages — that is the real production dependency set, and it is what the Dockerfile change now reproduces
Tests: `tests/test_packaging_contract.py` 7 passed; `tests/test_config.py` 16 passed; Ruff clean on the new file
Non-vacuity: proven. Reverting the Dockerfile to its previous three instructions failed exactly the four contract assertions and passed the three that are about file existence. Restored afterwards
BLOCKED_ENVIRONMENT: the image itself was not built. Docker invocation is not permitted here, so these tests assert the build *instructions* rather than a successful build. The instruction correctness was verified out-of-band by running the equivalent `uv sync --locked --no-dev` locally, which is the strongest available substitute but is not the same as a green `docker build`
Next slice: DEP-002B — begin version remediation now that the lock is authoritative and uv is available. Take the low-risk independent group first (click, idna, Mako, pyasn1, pydantic-settings, python-dotenv), then cryptography, then the FastAPI/Starlette pair
```

## DEP-002 production dependency inventory (52-package production-only set)

Re-established against the true production set produced by
`uv sync --locked --no-dev`, rather than the developer venv which mixes dev
tooling in. Nine of 52 production packages carry advisories — the same nine the
previous session identified, now confirmed as genuinely production-reachable
(pytest, pip, Pygments and iniconfig correctly drop out as dev-only).

## DEP-002 Python vulnerability inventory (gathered, not yet remediated — reuse it)

Established by querying the OSV batch API directly against the 62 installed
packages, rather than installing a scanner into the backend virtualenv, which
would have changed the environment the test suite runs in. The script used is
reproducible: POST `https://api.osv.dev/v1/querybatch` with
`{"package":{"name":N,"ecosystem":"PyPI"},"version":V}` per package.

```text
PRODUCTION-REACHABLE (9 packages, current version -> earliest fixed version)
  click             8.3.1   -> 8.3.3     1 issue                       (uvicorn)
  cryptography     46.0.5   -> 46.0.7    8 distinct issues, PARTIAL    (direct)
                                          Bleichenbacher oracle in PKCS#7 EnvelopedData,
                                          wildcard-DNS verifier escape, incomplete DNS name
                                          constraints, buffer overflow on non-contiguous
                                          buffers, vulnerable OpenSSL in wheels.
                                          46.0.6/46.0.7 fix some; others are only fixed in
                                          48.0.1 / 49.0.0 / 50.0.0, which are OUTSIDE the
                                          declared `cryptography>=46.0.5,<47.0.0` pin.
                                          Splitting "fixed within 46.x" from "needs a major"
                                          is the first real task here.
  ecdsa            0.19.1   -> 0.19.2    2 issues (DER length DoS; Minerva timing attack on
                                          P-256). Arrives via python-jose.
  idna              3.11    -> 3.15      2 issues                      (httpx/anyio)
  Mako             1.3.10   -> 1.3.12    3 issues (path traversal in TemplateLookup) (alembic)
  pyasn1            0.6.2   -> 0.6.4     8 issues (quadratic OID parsing, unbounded recursion,
                                          long-form tag DoS)           (google-auth, python-jose)
  pydantic-settings 2.13.0  -> 2.14.2    1 issue (NestedSecretsSettingsSource symlink escape)
  python-dotenv     1.2.1   -> 1.2.2     2 issues (symlink following in set_key)
  starlette        0.52.1   -> 1.3.1     10 issues, MAJOR BUMP         (fastapi)
                                          Host-header validation missing (poisons
                                          request.url.path), SSRF/NTLM via UNC paths in
                                          StaticFiles, arbitrary method dispatch to
                                          HTTPEndpoint attributes, form() limits ignored.
                                          Gated behind a FastAPI upgrade that accepts
                                          starlette 1.x — this is a framework migration and
                                          deserves its own slice with the full backend suite.

DEV-ONLY (lower priority, not shipped): pytest 9.0.2, pip 24.2, Pygments 2.19.2
```

**Why no remediation was attempted, and what must be decided first.** The
repository declares `backend/uv.lock`, but `backend/.venv/pyvenv.cfg` shows the
environment was built by `/opt/anaconda3/bin/python3 -m venv` at
`/tmp/creatorjobs-backend-venv` — a plain pip venv, not a uv-managed one. So the
lock and the environment the tests actually run against are already two
different things, and there is no `uv` binary anywhere on this machine to
regenerate the lock surgically. Changing `pyproject.toml` alone would leave the
lock inconsistent; `pip install`-ing into `.venv` would fix nothing the
repository records, because the venv is untracked. Either action would look like
remediation while changing nothing a deployment would use.

The next agent should resolve the tooling contract first — install `uv` and
confirm `uv lock --check` reproduces the current lock, or decide the project is
pip/requirements-based and make that explicit — and only then remediate, one
`uv lock --upgrade-package <name>` at a time, installing the same version into
the venv so the tests genuinely exercise it. Do not mass-upgrade.

## Phase 3C atomic checkpoint (DEP-001B)

```text
Phase: Phase 3, atomic slice 3C / DEP-001B — the framework and everything it carries
Status: COMPLETE (DEP-001 is VALIDATED — production audit reports zero findings)
Initial HEAD: Phase 3B checkpoint commit
Final HEAD: Phase 3C checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): deps(next): move to the minor that carries patched postcss and sharp
Files materially changed: `package.json`, `package-lock.json`
Migrations: None
Advisories resolved: nine `next` advisories (middleware/proxy bypass on Turbopack, DoS in Server Actions, SSRF in Server Actions on custom servers, SSRF in rewrites via attacker-controlled destination host, two cache-confusion issues, unbounded Server Action payload on Edge, image-optimization DoS via SVG, unauthenticated disclosure of internal Server Function endpoints); four `postcss` advisories (`</style>` XSS and three sourceMappingURL path-traversal/arbitrary-.map-read issues); the `sharp`/libvips group (CVE-2026-33327/33328/35590/35591); and two `nanoid` infinite-loop advisories
Why 16.3.1 and not 16.2.12: every direct `next` advisory ends at `<16.2.11`, so a patch bump would have silenced them — but `16.2.11` and `16.2.12` still pin `postcss 8.4.31` and `sharp ^0.34.5`, both of which are themselves vulnerable and reach production. `16.3.1` pins `postcss 8.5.23` and `sharp ^0.35.3`, and `postcss@8.5.23`'s `nanoid ^3.3.16` resolves to the patched 3.3.18. One minor bump therefore closes four packages at once, which is why this is a single coherent group rather than four slices. It stays inside the declared `^16.2.6` range
Framework-internals risk, checked explicitly: the WEB-008B nonce architecture depends on Next reading the request CSP header, so `app-render/get-script-nonce-from-header.js` and the `proxy` file convention were both confirmed present in 16.3.1 before any test ran, and the CSP browser suite was then run against it
Audit movement: production findings 4 → 0. `npm audit --omit=dev` reports "found 0 vulnerabilities"
Tests run: TypeScript; ESLint; complete frontend unit suite; production build; CSP browser suite; complete standard browser matrix; complete real-backend QA browser matrix
Exact results: TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,181 passed / 0 failed; build passed; CSP browser 6 passed with the policy enforcing; standard browser 448 passed / 22 failed (was 444 / 26 on 16.2.6 — four fewer failures); QA browser 280 passed / 10 failed / 2 skipped on a heavily contended machine, then the affected specs re-run clean at 35 passed / 0 failed in 1.6 minutes
Standard-matrix churn, investigated not assumed: two specs failed that had not failed before (`visual-theme.spec.ts:52`, `seo-filter-routes.spec.ts:139`) and several that had failed before stopped failing. Both new ones were re-run in isolation and passed 16/16, so they are parallel-execution flakes rather than regressions. `visual-theme:52` was worth checking carefully because it exercises the theme bootstrap script that WEB-008B attaches a nonce to — its passing is direct evidence that the nonce'd inline script still executes on 16.3.1
MACHINE CONTENTION — read this before trusting any browser run: the QA matrix reported 10 failures and took 1.1 hours against 15.5 minutes previously. That was not the framework. Load average during the run was 15.8 / 18.3 / 19.5, from the host's own browsers, editors and concurrent agent processes, plus a stray `next-server (v16.2.6)` left running for nine hours by an earlier inspection step. Three tests consumed roughly 46 of the 64 minutes hanging in Playwright teardown *after* hitting their 45-second timeout. Once the stray was killed and load fell to about 4.7, all five specs that had newly failed passed 35/35 in 1.6 minutes. Two independent facts point the same way: the standard matrix on the same 16.3.1 got *faster* (4.4m vs 7.7m), and `workspace-performance.spec.ts:108` — an item in the original Phase 0 recorded baseline — now passes. Before recording any browser failure as real, check `uptime` and `ps -ax | grep next-server`, and kill leftovers
Backend: untouched by this slice
Next slice: reassess remaining Phase 3 items, then Phase 4. This run is strong evidence that the historical 17/6 browser baseline is stale and must be re-established serially on a quiet machine rather than trusted
```

## Phase 3B atomic checkpoint (DEP-001A)

```text
Phase: Phase 3, atomic slice 3B / DEP-001A — the critical authentication dependency
Status: COMPLETE (DEP-001 remains IN_PROGRESS; `next` itself is DEP-001B)
Initial HEAD: 85dc4e6c36b8408963ee40272e2c2027169c9c00
Final HEAD: Phase 3B checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): deps(auth): take the next-auth patch that closes three advisories
Files materially changed: `package.json`, `package-lock.json`
Migrations: None
Advisories resolved: GHSA-7rqj-j65f-68wh (critical — email normalizer validated before Unicode normalization, homoglyph `@` bypass); GHSA-xmf8-cvqr-rfgj (high — `getToken()` throws on a malformed Bearer header); GHSA-x445-f3h2-j279 (moderate — OAuth state/nonce/PKCE cookies not bound to the provider that set them); GHSA-w5hq-g745-h8pq (moderate — `uuid` missing buffer bounds check, transitive, fixed by next-auth's bump to `uuid ^11.1.1`)
Why these matter here rather than in the abstract: `app/api/security/strong-auth/route.ts` calls `getToken` on a caller-supplied request, which is exactly the malformed-Bearer surface; and `lib/auth.ts` configures Google plus Credentials providers, which is the OAuth cookie-binding surface. The email-normalizer advisory is fixed but less relevant — no Email provider is configured
Scope discipline: 4.24.14 → 4.24.15 is a patch inside the existing `^4.24.14` range. next-auth v5 (Auth.js) is a beta major and a migration, not a remediation, so it was not considered
Audit movement: production findings 6 → 4 (critical 1 → 0, moderate 1 → 0)
Tests run: TypeScript; ESLint; complete frontend unit suite; production build (via the QA harness); browser verification of the credentialed login path
Exact results: TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,181 passed / 0 failed; build passed; QA browser 12 passed (CSP suite 6 + organization resolver 6, both of which sign in)
Backend: untouched by this slice
Next slice: DEP-001B — `next` 16.2.6 → 16.3.1
```

## Phase 3A atomic checkpoint (RATE-002)

```text
Phase: Phase 3 — Dependencies, rate limiting, and request safety, atomic slice 3A / RATE-002
Status: COMPLETE (RATE-002 is VALIDATED)
Initial HEAD: 4ad511766f423fa54adc4e648f6729e495b63176
Final HEAD: Phase 3A checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(rate): stop letting a header choose who is being counted
Files materially changed: `backend/app/core/rate_limit.py` (`client_identity` replaces `_client_key`); `backend/app/core/config.py` (two settings plus a production decision); new `backend/tests/test_trusted_client_identity.py`; `backend/tests/test_config.py`
Migrations: None
Defect fixed (live before this slice): `_client_key` returned the leftmost `X-Forwarded-For` entry from any caller, so every rate limit in the product could be bypassed by varying one header — a different value produced a different bucket. That covered login, registration, password reset, strong-authentication challenge and enrollment, marketplace actions, reports and checkout. A test now sends 24 invented values from one caller and asserts they collapse to a single identity
Architecture: a forwarded header is evidence only when the peer that delivered it is inside a configured proxy network, and the chain is then read right to left — entries are appended by each hop, so the rightmost were written by our own infrastructure and anything further left could have come from the client. The first hop that is not one of our proxies is the answer. A malformed hop stops the walk rather than allowing it to reach further left. IPv4-mapped IPv6 is normalized so one caller cannot hold two buckets. An unparseable configuration entry is dropped, which narrows trust rather than widening it
Ordering note: taken before RATE-001 on purpose. The ledger listed RATE-002 as depending on RATE-001, but identity derivation is independent of where the counters live, and the defect is live under today's in-memory backend
New environment variables: TRUSTED_PROXY_IPS (comma-separated IPs/CIDRs of the proxies actually in front of the deployment; empty means forwarded headers are ignored entirely); ALLOW_DIRECT_CLIENT_IPS_IN_PRODUCTION (explicit acknowledgement that there is no proxy). Production boot now fails unless one of the two is stated, because both wrong answers are bad in different directions: behind an unlisted proxy every caller shares one bucket, in front of none an unlisted header forges one. `backend/.env.example` was NOT updated — this environment refuses commands that reference `.env*` paths, so the variables are recorded here instead and that file still needs the two entries
Security assumptions: `request.client.host` is the socket peer and is the only thing believed by default; the trusted set is server configuration and never request data; the parsed network list is cached per process, so a test that needs a different set must patch `rate_limit._trusted_proxies` rather than mutate settings
Tests run: 22 focused identity cases; the rate-limit backend suite; the configuration suite; the complete backend suite uncontended; Ruff on every changed Python file
Exact results: `test_trusted_client_identity.py` 22 passed; `test_config.py` 16 passed; complete backend 6,723 passed / 64 skipped / 0 failed in 335s, one uncontended run; Ruff clean on all four changed files
Reading the totals: `pyproject.toml` already sets `addopts = "-q"`, so passing `-q` again makes `-qq` and pytest prints no summary line at all. Count the progress characters if that happens, but do not count the summary line itself — "passed"/"skipped"/"335.42s" contain the same characters and will inflate the result. The Phase 2 certification figure of 6,700 passed / 64 skipped was character-counted from such a run and is consistent with this one: 6,700 + 23 new tests = 6,723
Known limitation carried forward: RATE-001 moves to BLOCKED_EXTERNAL for this environment — no redis-server binary, no redis/fakeredis package, Docker not permitted. `RedisRateLimitBackend.hit` still reads the count and writes in separate round trips, so concurrent callers can each see a count below the limit and all be admitted. That is a real defect and it is recorded rather than fixed blind, because a check-then-act fix cannot be validated without a server to race against
Next phase: DEP-001/DEP-002 (dependency audits) are the next fully-completable slice in this environment; RATE-003/004/005 depend on the limiter primitive and should follow RATE-001 once Redis is available
```

## Phase 2 certification (local)

```text
Phase: Phase 2 — Core web security boundaries
Status: LOCALLY COMPLETE. Every Phase 2 ledger row (WEB-001 … WEB-008) is VALIDATED
Certified at: Phase 2J checkpoint commit (self-resolve with `git log -1 --format=%H`)
Boundaries exercised: SafeOutboundFetcher and its per-hop destination predicates; job URL fetching; portfolio and oEmbed previews; hiring identity verification; organization page resolution; the YouTube custom-path resolver; safe internal redirects; inline JSON-LD serialization; stored external URL validation; render-safe external hrefs; response headers; the content security policy
Backend: 6,700 passed / 64 skipped / 0 failed, one uncontended run, no overlapping pytest at any point
Frontend unit: 1,181 passed / 0 failed
TypeScript: passed. ESLint: 0 errors / 33 known warnings. Production build: passed
Real-backend QA browser: 283 passed / 7 failed / 2 skipped, then differing specs re-run serially. Five of the seven are recorded baseline items; two (`qa-personas.spec.ts:602`, `workspace-interviews.spec.ts:246`) passed on serial re-run and are flakes. Two recorded baseline items (`draft-assistant.spec.ts:581`, `workspace-performance.spec.ts:108`) passed in this run, so the recorded six-item QA baseline is itself partly non-deterministic and should be re-established rather than trusted as a fixed list
Standard browser: 444 passed / 26 failed. The recorded baseline for this suite is "26 failures on the initial parallel run, 17 reproduced serially", so the count matches exactly. Every failure is a locator or copy assertion in the recorded categories; the log contains zero occurrences of "Content Security Policy", "Refused to execute/load/connect", "BLOCKED_BY_CSP" or "nonce", and no hydration failure. No failure is attributable to Phase 2
Alembic heads: 0059_oauth_connection_events (single head). Alembic current: local configured SQLite is unversioned, unchanged from the recorded state
PostgreSQL migration harness: NOT RE-RUN this session. `docker` invocation is not permitted in this environment, and Phase 2 introduced no migration, so the harness would exercise nothing this phase changed. The last recorded run reached 0059 through upgrade/downgrade/re-upgrade on disposable PostgreSQL. This is an environment limitation, not a passing result — do not read it as one
External gates still open: HSTS preload eligibility and real deployed-domain HSTS behaviour; live Google consent/reconnect/refresh/revoke drill; hosted credential backfill. No domain was submitted to any preload list
```

## Phase 2J atomic checkpoint (WEB-008B)

```text
Phase: Phase 2 — Core web security boundaries, atomic slice 2J / WEB-008B
Status: COMPLETE (WEB-008 is VALIDATED)
Initial HEAD: 99e17d9b439e3377161215dbddc0ca74a56d37d5
Final HEAD: Phase 2J checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(web): authorize scripts per request rather than by category
Files materially changed: new `lib/contentSecurityPolicy.ts`; new `proxy.ts`; `app/layout.tsx` reads the request nonce; `next.config.ts` gives up ownership of the CSP header; header contract suite expanded from 7 to 22 cases; new browser suite `tests/e2e/qa/content-security-policy.spec.ts`; one console-noise pattern added to `tests/e2e/qa/workspace-exploratory.spec.ts`; execution ledger and handoff
Migrations: None
Behavior changed: every HTML response now carries a complete Content-Security-Policy whose `script-src` is `'self' 'nonce-<per request>' 'strict-dynamic'`. Next 16 reads that nonce off the *request* header (`app-render/get-script-nonce-from-header.js`) and stamps it onto its own inline bootstrap and flight-data scripts, so no inline script executes unless the server authorized it. Also `default-src 'self'`, `base-uri 'self'`, `object-src 'none'`, `form-action 'self'`, `frame-src 'none'`, `frame-ancestors 'none'`, `font-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob: https:`, and `connect-src 'self'` plus the parsed backend origin and its ws/wss form
Architecture: `lib/contentSecurityPolicy.ts` is a pure builder — nonce plus configuration in, header string out — so the entire policy is asserted in unit tests instead of only observed in a browser. `proxy.ts` (Next 16's replacement for the deprecated `middleware.ts`; the old name still builds but warns and the two may not coexist) generates 128 bits from `crypto.getRandomValues` per request, overwrites the inbound `content-security-policy` and `x-nonce` request headers, and sets the response header. It matches documents only — `/api/*`, `/_next/static` and `/_next/image` are excluded, because a document policy on a JSON response buys nothing. `app/layout.tsx` reads `x-nonce` through `headers()` and applies it to the theme bootstrap script
Static-rendering consequence (measured, proven necessary, NOT a mistake): prerendered routes went from 21 to 3 (`/_global-error`, `/favicon.ico`, `/robots.txt`). This was verified by experiment, not assumed — with `headers()` removed from the layout the build prerenders 21 routes again, and those pages are then served with build-time HTML whose inline scripts carry no nonce, so the client runtime never starts and the browser suite fails on hydration. A nonce policy therefore requires every HTML response to be rendered per request. The SEO-critical surfaces (`/jobs`, `/jobs/[id]`, `/talent`, `/talent/[id]`, `/u/[slug]`) were already dynamic and lost nothing; what became dynamic is `/faq`, `/privacy`, `/terms`, `/support`, `/auth*`, `/post*`, `/smart-typing-test` and the `/you/*` workspace pages
Performance follow-up for Phase 11 (PERF-002): because every route is now dynamic, every `<Link>` prefetch in the header is a server render. That is a real cost and it is the reason one existing test changed. Consider `prefetch={false}` on navigation links, or a cached shell, when PERF-002 is worked
Security assumptions: the nonce is server-generated, unique per response, never read from the request, never persisted; a client-supplied `content-security-policy` or `x-nonce` request header is overwritten before Next sees it. Configured origins are parsed by `new URL` and re-checked against an origin pattern, never interpolated — `https://api.example.com; script-src *` yields no source at all and `connect-src` falls back to `'self'`, which breaks the application loudly rather than widening the policy. Control characters are rejected before parsing, because the URL parser *deletes* tabs and newlines and would otherwise authorize a host nobody configured. `style-src 'unsafe-inline'` is a real, documented exception: a nonce cannot authorize a `style` attribute and this codebase sets `style={{…}}` in about three dozen components, so the alternative is no style policy rather than a stricter one — `script-src` gets no such exception, and a test asserts that. `img-src https:` is deliberate and confined: creators link work from arbitrary hosts, images cannot execute, and a test asserts that allowance appears in no other directive. Report-only is unreachable when `isStrictProductionEnv()` is true, by construction rather than by remembering
Tests run: 22-case header/policy contract suite; six-case browser CSP suite; complete frontend unit suite; TypeScript; ESLint; production build; complete real-backend QA browser suite; targeted repeat runs of the affected spec. Backend untouched by this slice
Exact results: header/policy contract 22 passed; browser CSP 6 passed with the policy enforcing; frontend unit 1,181 passed / 0 failed; TypeScript passed; ESLint 0 errors / 33 known warnings; production build passed; full QA suite 283 passed / 7 failed / 2 skipped, then the differing specs re-run serially; `workspace-exploratory.spec.ts` 12/12 across three repeats after the fix
Non-vacuity: proven by two mutations, both reverted. Replacing `script-src` with `'self' 'unsafe-inline'` let an injected inline script execute and failed both the browser refusal test and the unit guard. Removing `'unsafe-inline'` from `style-src` produced real violations on public surfaces and failed the collector test. A third experiment (removing `headers()` from the layout) failed the hydration assertion, which is what proves the client-runtime check is not decoration
Task-caused failures resolved: one. `workspace-exploratory.spec.ts:78` began failing about half the time. Diagnosed rather than assumed: an instrumented run showed `GET /api/auth/session :: net::ERR_ABORTED` immediately before the next-auth `CLIENT_FETCH_ERROR`, with a 200 on the very next poll. Per-request rendering makes pages slower to go idle, so a scripted four-navigation sequence now interrupts the session poll more often. The abort is the browser's, not the product's, so it joined that spec's existing environmental-noise list with the reason written down. Verified against the parent behaviour first: with the change neutralized the test passed 4/4, with it in place it failed 2/4 and then 4/4 — which is why this is recorded as task-caused rather than dismissed as flake
Known flakes observed (not task-caused, passed on serial re-run): `qa-personas.spec.ts:602`, `workspace-interviews.spec.ts:246`. Two recorded baseline failures (`draft-assistant.spec.ts:581`, `workspace-performance.spec.ts:108`) passed in this run, so the recorded six-item QA baseline is itself partly non-deterministic
Known limitation: `/_global-error` stays prerendered because `global-error.tsx` replaces the root layout and cannot read request headers, so its inline scripts carry no nonce and that page renders without hydrating. It is the last-resort error screen and no product flow depends on its interactivity
Remaining risks: none in Phase 2 local scope; HSTS preload eligibility remains BLOCKED_EXTERNAL
Next phase: Phase 2 certification, then Phase 3 (RATE-001)
Important commands: `node --test --experimental-strip-types tests/securityHeaders.test.mjs`; `npx playwright test -c playwright.qa.config.ts tests/e2e/qa/content-security-policy.spec.ts`; `CSP_REPORT_ONLY=1 npx playwright test -c playwright.qa.config.ts …` to observe a policy change without enforcing it outside strict production
```

## Phase 2I atomic checkpoint (WEB-008A)

```text
Phase: Phase 2 — Core web security boundaries, atomic slice 2I / WEB-008A
Status: COMPLETE (WEB-008 remains IN_PROGRESS; the CSP itself is WEB-008B)
Initial HEAD: c278f8dfe9d1366680d0dcea421f978b84d566d9
Final HEAD: Phase 2I checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(web): say who may frame and reach into these pages
Files materially changed: `next.config.ts` response headers; new seven-case header contract suite; execution ledger and handoff
Migrations: None
Behavior changed: every response now also carries `Content-Security-Policy: frame-ancestors 'none'`, `Cross-Origin-Opener-Policy: same-origin-allow-popups` and `Cross-Origin-Resource-Policy: same-origin`. The existing nosniff, Referrer-Policy, X-Frame-Options, Permissions-Policy and production-gated HSTS headers are unchanged. `frame-ancestors` is the only directive shipped, deliberately: a `script-src` chosen without an inline-script decision breaks the application rather than protecting it
Security assumptions: `X-Frame-Options: DENY` and `frame-ancestors 'none'` must keep agreeing, or the answer depends on the browser; COOP is `same-origin-allow-popups` rather than `same-origin` because strict isolation severs the opener a popup sign-in flow depends on, and Google auth is one configuration change away from being one; HSTS stays gated on server-side `isStrictProductionEnv()` and must never be decided by a `NEXT_PUBLIC_` value; no header value may be built by interpolating configuration, because a stray semicolon in an origin rewrites the directive list
Tests run: header contract suite; TypeScript; ESLint; complete frontend unit suite; production build; QA browser suite covering the authenticated resolver and paste surfaces; git diff checks. Backend untouched
Exact results: security headers 7 passed and verified non-vacuous by introducing a wildcard, which failed two guards; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,166 passed / 0 failed; production build passed; QA Chromium 15 passed with the new headers live; `git diff --check` and `git diff --cached --check` passed
Task-caused failures resolved: none
Known external failures: HSTS preload eligibility remains BLOCKED_EXTERNAL — the header is implemented and gated, but only a deployed HTTPS domain can verify it, and no domain was submitted to any preload list
Remaining risks: without `script-src`/`connect-src`/`img-src`/`frame-src` the policy does not yet constrain code execution or exfiltration; that is WEB-008B and the inventory it needs is recorded above
Next phase: WEB-008B as described in the resume summary
Important commands: `node --test --experimental-strip-types tests/securityHeaders.test.mjs`; `rg -n 'dangerouslySetInnerHTML' app/layout.tsx`; `npx playwright test -c playwright.qa.config.ts tests/e2e/qa/organization-resolver.spec.ts`
```

## Phase 2H atomic checkpoint (WEB-006B)

```text
Phase: Phase 2 — Core web security boundaries, atomic slice 2H / WEB-006B
Status: COMPLETE (WEB-006 is VALIDATED)
Initial HEAD: 72a4775553e094d14edf625b5ad23dbc4ca10d7c
Final HEAD: Phase 2H checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(web): a stored link is not automatically a place to go
Files materially changed: new `lib/externalHref.ts`; seven components that render stored URLs; new five-case suite including a sink-coverage guard; execution ledger and handoff
Migrations: None; no legacy row was rewritten, which is the reason this slice exists
Behavior changed: every `href` fed by a stored URL now passes through `safeExternalHref`, which returns `undefined` for anything that is not an absolute http(s) URL without credentials. A row written before Phase 2G's storage validator can still hold `javascript:alert(1)`; it now renders as inert text rather than as navigation. The project detail card goes further and does not render its clickable surface at all when the link is unusable, because an inert full-bleed card would look broken
Security assumptions: storage, render and fetch are three separate contracts and the render layer must fail closed on data it did not write — "the backend validates it now" is only true for rows written after it started to; `safeExternalHref` and `safeExternalImageSrc` are deliberately separate functions even though both currently accept exactly http(s), so that loosening one later cannot silently loosen the other; a sink-coverage test fails if any of the seven components renders a stored URL directly again
Tests run: render-guard suite; TypeScript; ESLint; complete frontend unit suite; production build; git diff checks. The backend was not modified by this slice and its complete suite passed at the immediately preceding commit
Exact results: externalHref 5 passed; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,159 passed / 0 failed; production build passed; `git diff --check` and `git diff --cached --check` passed
Task-caused failures resolved: `InteractiveProjectLink` requires a string href, so the project page now gates the link wrapper on the safe value rather than passing a possibly-undefined one
Known external failures: none introduced
Remaining risks: WEB-008 is the last open Phase 2 item; application/interview URL fields were inventoried and are rendered through the same guarded components, so no separate WEB-006C was needed
Next phase: WEB-008 as described in the resume summary
Important commands: `node --test --experimental-strip-types tests/externalHref.test.mjs`; `rg -n 'href=\{' components | rg -i url`
```

## Phase 2G atomic checkpoint (WEB-006A)

```text
Phase: Phase 2 — Core web security boundaries, atomic slice 2G / WEB-006A
Status: COMPLETE (WEB-006 moves to IN_PROGRESS; render safety is WEB-006B)
Initial HEAD: af74f771d610f3b9fe2d94607db73bb3d27af623
Final HEAD: Phase 2G checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(web): decide once what a stored link may be
Files materially changed: new `app/core/external_url.py`; profile service `_is_http_url` chokepoint; profile/portfolio write schemas; new 36-case suite; execution ledger and handoff
Migrations: None; no legacy row was rewritten
Behavior changed: one implementation now answers "may this be stored". The existing service check — which already refused `javascript:` but accepted embedded credentials, control characters, single-label internal names, and any length — delegates to it, keeping its documented 400 responses. Portfolio `source_url`/`media_url`/`youtube_url`/`thumbnail_url` and profile `avatar_url`/`instagram_url` had no validation at all and now enforce it at the schema, which is their only chokepoint. Bare domains are still accepted and normalized to https, so nothing a creator actually types stopped working
Security assumptions: this is the *storage* contract only. Render safety is a separate contract that must fail closed independently, because rows written before this slice may hold anything — that is WEB-006B and it is why no destructive migration was written. Server-side fetch safety remains `SafeOutboundFetcher`'s and reusing it here would be wrong in both directions: it would reject a real link whose host is unreachable, and it would never see a `javascript:` value because that one never reaches a socket. `hiring_website_or_social_url` is deliberately validated only in the service, because adding a schema validator would turn its documented 400 into a 422
Tests run: new stored-URL suite; profile/portfolio/creator-profile dependent matrix; complete uncontended backend pytest; changed-file Ruff; TypeScript; complete frontend unit suite; production build; git diff checks
Exact results: stored-URL 36 passed; dependent matrix 30 passed; complete backend 6,700 passed / 64 skipped / 88 warnings in 317.55s with zero failures; changed-file Ruff passed; TypeScript passed; frontend unit 1,154 passed / 0 failed; production build passed; `git diff --check` and `git diff --cached --check` passed
Task-caused failures resolved: one test expectation of mine was wrong rather than the implementation — a *trailing* CRLF is stripped as normalization and never reaches storage, so the case now asserts that contract; a control character in the middle of a URL cannot be stripped and is still refused
Known external failures: none introduced
Remaining risks: legacy stored rows are untouched by design and can still hold an executable scheme until WEB-006B lands; application/interview URL fields have not been inventoried yet; WEB-008 remains
Next phase: WEB-006B as described in the resume summary
Important commands: `rg -n 'href=\{' components | rg -i 'url' | head -30`; `cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_external_url_storage.py tests/test_profile_features.py`
```

## Phase 2F atomic checkpoint

```text
Phase: Phase 2 — Core web security boundaries, atomic slice 2F
Status: COMPLETE (WEB-005 is VALIDATED)
Initial HEAD: 2f8a967d2177234e9cd6bb9ebb3c3aaf7b0db297
Final HEAD: Phase 2F checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(web): stop the sign-in page redirecting off-site
Files materially changed: new `lib/safeRedirect.ts`; sign-in page redirect handling; new nine-case validator suite; execution ledger and handoff
Migrations: None
Behavior changed: `/auth?next=` is validated once at the source and every consumer reads the validated value. The live defect was `router.push(result.url || nextAfterAuth)`, which navigated to whatever the query string contained after a successful sign-in — an open redirect on the one page where a victim has just been asked to trust what they are looking at. Legitimate application paths, including query and hash, are preserved exactly; anything else falls back to `/you` rather than failing loudly, because a bad `next` is usually a stale link
Security assumptions: NextAuth's default `redirect` callback already constrains `callbackUrl` to the deployment origin, but that protection is implicit and does not cover `router.push`, so the validator is applied at the source rather than relied upon downstream; the check accepts only a single-leading-slash path, rejects backslashes before and after one decode, rejects userinfo, control characters and unparseable values, and resolves against an opaque base so nothing about the real origin can influence the decision
Tests run: redirect validator suite; TypeScript; ESLint; complete frontend unit suite; production build; git diff checks. Backend untouched
Exact results: safeRedirect 9 passed and verified non-vacuous by reverting the call-site guard; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,154 passed / 0 failed; production build passed; `git diff --check` and `git diff --cached --check` passed
Task-caused failures resolved: none
Known external failures: none introduced
Remaining risks: WEB-006 stored/user-supplied URL contracts and WEB-008 response headers remain in Phase 2; every other redirect target in the tree is a literal string, so no further consumers needed migrating in this slice
Next phase: WEB-006 as described in the resume summary
Important commands: `rg -n 'callbackUrl|returnTo|searchParams.get\("next"\)' app components lib`; `node --test --experimental-strip-types tests/safeRedirect.test.mjs`
```

## Phase 2D-3 atomic checkpoint

```text
Phase: Phase 2 — Core web security boundaries, atomic slice 2D-3
Status: COMPLETE (WEB-003 is VALIDATED)
Initial HEAD: dca6c11272c6d29a161d6025db81fd6c4f54ebcc
Final HEAD: Phase 2D-3 checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(web): resolve youtube custom paths server-side
Files materially changed: `lib/youtubeIdentity.ts` custom-path resolution and its HTML extractor removal; organization-identity route wiring; resolver regression tests; outbound inventory; execution ledger and handoff
Migrations: None
Behavior changed: a YouTube custom path (`youtube.com/somebrand`) is the one shape the Data API cannot look up directly, and its channel id lives in the page. That page is no longer fetched from the Next runtime; the caller injects a resolver backed by `POST /me/organization-page`, which reads it through the shared pinned boundary and returns the id alone. Without an injected resolver a custom path falls back to URL-derived identity rather than fetching, which is deliberate: losing an enrichment is cheaper than keeping an unpinned fetch alive for it. Handle, channel-id, username and video shapes are unchanged and still use the fixed Data API endpoints
Security assumptions: `lib/youtubeIdentity` now has no code path that fetches a page; the only URLs it requests are the fixed googleapis.com endpoints (OF-104, tracked separately); the injected resolver receives the caller's own backend token
Tests run: YouTube identity resolver suite including two new cases; TypeScript; ESLint; complete frontend unit suite; production build; authenticated resolver browser suite; git diff checks. The backend was not modified by this slice, and its complete suite passed at the immediately preceding commit
Exact results: YouTube resolver 11 passed; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,145 passed / 0 failed; production build passed; organization resolver Chromium 6 passed; `git diff --check` and `git diff --cached --check` passed
Task-caused failures resolved: none; one new test asserts that only googleapis.com hosts are contacted and fails if the page is fetched
Known external failures: none introduced
Remaining risks: WEB-005 internal redirects, WEB-006 stored/user-supplied URL contracts, and WEB-008 response headers remain in Phase 2; per-user quotas for these endpoints are Phase 3 RATE-003
Next phase: WEB-005 — inventory every user-influenced redirect/return target (`next`, `returnTo`, `callbackUrl`, invitation and auth callbacks) and introduce one canonical internal-redirect validator, migrating consumers incrementally
Important commands: `rg -n 'callbackUrl|returnTo|[?&]next=|redirect\(' app lib components | head -50`; `node --test --experimental-strip-types tests/youtubeIdentityResolver.test.mjs`
```

## Phase 2D-2 atomic checkpoint

```text
Phase: Phase 2 — Core web security boundaries, atomic slice 2D-2
Status: COMPLETE (WEB-003 remains IN_PROGRESS; OF-007 is the remaining caller)
Initial HEAD: ff3c819fec1dd40e6ffb2d69434fac5d93bee72a
Final HEAD: Phase 2D-2 checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(web): read organization pages behind the backend boundary
Files materially changed: new `app/services/organization_page_service.py`; new authenticated `POST /me/organization-page`; organization page request/response schemas; typed frontend backend client; organization-identity Next route rewritten as an orchestration boundary with its HTML scraping helpers removed; new 15-case backend suite; outbound inventory; execution ledger and handoff
Migrations: None; Alembic remains at the single 0059_oauth_connection_events head
Behavior changed: the Next runtime no longer fetches arbitrary external HTML for organization resolution. It requires a session, decides the identity strategy, and asks the backend to read the page; the backend fetches through `SafeOutboundFetcher` and returns only `final_url`, `site_name`, `title`, `image_url`, `icon_url` and `youtube_channel_id`. YouTube and Instagram pages additionally carry a per-hop destination predicate, so a platform profile cannot redirect the request off its platform. A general company URL keeps no allowlist on purpose — real organizations redirect across domains — and is bounded by the generic public-address policy. Resolution outcomes, the Instagram URL-derived fallback, and the unreadable-page fallback are unchanged; an unreadable page answers 200 with empty fields so best-effort enrichment never blocks the workflow
Security assumptions: only http(s) values leave the service, so a `javascript:` or `data:` icon can never be handed back as an image URL; every returned field is length-bounded; no remote HTML crosses to the Next runtime or the browser; the route's remaining private-host regex is a fast input check and is explicitly documented as not the boundary; the platform predicate is caller-owned and the generic fetcher still knows nothing about YouTube or Instagram
Tests run: new organization-page suite; hiring-identity fetch; shared boundary; profile features; link preview; complete uncontended backend pytest; changed-file Ruff; TypeScript; ESLint; complete frontend unit suite; production build; authenticated resolver browser suite; git diff checks
Exact results: organization page 15 passed; dependent backend matrix 148 passed in 12.60s; complete backend 6,664 passed / 64 skipped / 88 warnings in 331.38s with zero failures; changed-file Ruff passed; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,143 passed / 0 failed; production build passed; organization resolver Chromium 6 passed; `git diff --check` and `git diff --cached --check` passed
Task-caused failures resolved: none; the platform-predicate cases were verified non-vacuous by temporarily setting `destination_allowed=None`, which let all four platform redirect escapes through before it was restored
Known external failures: no live YouTube, Instagram or third-party site was contacted; page shapes are represented by fixtures
Remaining risks: OF-007 still fetches YouTube HTML from the Next runtime; WEB-005, WEB-006 and WEB-008 remain; fixed provider clients (OF-103/104/105) still lack uniform response bounds
Next phase: Phase 2D-3 atomic slice as described in the resume summary
Important commands: `rg -n 'resolveCustomPathByHtml' lib app`; `cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_organization_page.py`; `npx playwright test -c playwright.qa.config.ts tests/e2e/qa/organization-resolver.spec.ts`; never start a second pytest while a suite is running
```

## Phase 2E atomic checkpoint

```text
Phase: Phase 2 — Core web security boundaries, atomic slice 2E
Status: COMPLETE (WEB-007 is VALIDATED)
Initial HEAD: 6a6e85bc8c2f9809eb5bd28349ab2ac9feaf9ada
Final HEAD: Phase 2E checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(web): make inline structured data html-safe
Files materially changed: new `lib/jsonLd.ts` serializer; public job and talent detail pages; new injection test suite; execution ledger and handoff
Migrations: None
Behavior changed: every inline `application/ld+json` block now serializes through `serializeJsonLd`, which escapes `<`, `>`, `&`, U+2028 and U+2029 as JSON `\uXXXX` sequences; consumers parse identical values, but an HTML parser can no longer be made to end the script block early from recruiter- or creator-supplied text
Security assumptions: `JSON.stringify` produces valid JSON and valid JSON is not safe inside HTML — an HTML parser ends a script at the first `</script` sequence wherever it appears, including inside a string; `&` is escaped so an entity cannot reconstruct a delimiter; the serializer deliberately takes a value rather than a pre-serialized string, because a string argument would mean the escaping decision had already been made elsewhere; any future inline structured-data block must use it, which the call-site test enforces
Tests run: JSON-LD injection suite; TypeScript; ESLint; complete frontend unit suite; production build; git diff checks
Exact results: JSON-LD injection 5 passed and verified non-vacuous by temporarily reverting one call site, which failed the call-site guard; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,143 passed / 0 failed; production build passed; `git diff --check` and `git diff --cached --check` passed; the backend was not touched by this slice so its suite was not rerun
Task-caused failures resolved: none
Known external failures: none introduced
Remaining risks: OF-006/OF-007 retrieval remains unpinned (2D-2); WEB-005 internal redirects and WEB-006 stored user URLs remain NOT_STARTED; WEB-008 response headers remain and should be sequenced last in Phase 2
Next phase: Phase 2D-2 atomic slice as described in the resume summary
Important commands: `rg -n 'application/ld\+json' app components`; `node --test --experimental-strip-types tests/jsonLdInjection.test.mjs`; `npx tsc --noEmit`
```

## Phase 2D-1 atomic checkpoint

```text
Phase: Phase 2 — Core web security boundaries, atomic slice 2D-1
Status: COMPLETE (WEB-003 remains IN_PROGRESS; the retrieval itself is 2D-2)
Initial HEAD: 36fd7175de8900a0f381f5bbdb89f4ffd2009b21
Final HEAD: Phase 2D-1 checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(web): require a session for organization resolution
Files materially changed: organization-identity Next route (same-origin check, session requirement, no-store responses); resolver browser spec moved from the anonymous mock harness to the authenticated QA harness; outbound inventory; execution ledger and handoff
Migrations: None
Behavior changed: `POST /api/profile/organization-identity` now refuses cross-site callers with 403 and anonymous callers with 401 instead of fetching a URL chosen by anyone on the internet; both product callers (Post a Job authorization and the profile experience editor) already run behind a signed-in session, so no user-visible flow changes; QA personas remain accepted because they are real accounts and this endpoint reveals nothing about the caller
Security assumptions: this closes the anonymous surface and does NOT fix the retrieval — the fetch still resolves DNS in the Next runtime, follows its own redirects, and screens hosts with a pattern list that a decimal-encoded address or a privately-resolving name would pass; that is 2D-2's work and the inventory records OF-006 as AUTH_GATED_PHASE_2D_1 rather than migrated
Tests run: authenticated resolver browser suite; TypeScript; ESLint; complete frontend unit suite; production build; git diff checks
Exact results: organization resolver Chromium 6 passed, including an explicit anonymous-caller rejection; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,138 passed / 0 failed; production build passed; `git diff --check` and `git diff --cached --check` passed; the backend was not touched by this slice so its suite was not rerun
Task-caused failures resolved: the previous `tests/e2e/instagram-resolver.spec.ts` asserted the anonymous contract this slice deliberately removes; its product assertions were preserved by moving them into the authenticated QA harness rather than relaxing the route
Known external failures: none introduced; live Instagram enrichment is still never asserted
Remaining risks: OF-006/OF-007 retrieval remains unpinned until 2D-2; WEB-005 internal redirects, WEB-006 stored URLs, WEB-007 JSON-LD escaping and WEB-008 HTTP boundaries remain
Next phase: Phase 2D-2 atomic slice — add a backend organization-resolution endpoint that uses `SafeOutboundFetcher` with a destination predicate for the supported platforms, have the Next route proxy to it with the caller's backend token, bound the response, and keep Instagram's URL-derived fallback behaviour intact
Important commands: `sed -n '1,90p' app/api/profile/organization-identity/route.ts`; `rg -n 'resolveCustomPathByHtml|resolveYouTubeChannelIdentity' lib app`; `npx playwright test -c playwright.qa.config.ts tests/e2e/qa/organization-resolver.spec.ts`; never start a second pytest while a suite is running
```

## Phase 2C atomic checkpoint

```text
Phase: Phase 2 — Core web security boundaries, atomic slice 2C
Status: COMPLETE (WEB-003 moves to IN_PROGRESS; the Next organization resolver remains)
Initial HEAD: 14881532a603db8d78ae7e0a1c18921c1540fde0
Final HEAD: Phase 2C checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(web): pin hiring-identity verification fetches
Files materially changed: additive `destination_allowed` predicate on the shared outbound policy evaluated inside per-hop destination validation; hiring-identity verification migrated off its own httpx client onto the shared boundary; new focused escape-path suite; outbound inventory; execution ledger and handoff
Migrations: None; Alembic remains at the single 0059_oauth_connection_events head
Behavior changed: hiring-identity verification still reads only a creator's own YouTube or Instagram profile page and still returns the same verification outcomes and the same single recruiter-facing failure message, but the platform host/path allowlist is now carried into the shared boundary as a per-hop predicate instead of being re-checked around a client that resolved DNS itself, followed its own redirects, honoured environment proxies, and materialised the whole body before slicing; the transfer is now IP-pinned, peer-checked, proxy-free, cookie-free, HTML-only, capped at four megabytes while streaming, limited to four redirects, and bounded by a fifteen-second whole-attempt deadline
Security assumptions: the predicate is caller-owned product policy and the primitive owns when it runs — on the entered URL and again on every hop, after the generic network policy passes and before any connection is opened; a predicate that raises is treated as a refusal; the generic primitive must never learn hiring-platform rules; `destination_allowed` defaults to None so every existing caller is unchanged; refusal reasons are deliberately collapsed into one product message because the difference between "not an allowed profile page" and "that host resolved somewhere private" is a fact about someone else's network
Tests run: new hiring-identity escape suite; profile features; shared boundary; link preview; creator profile; job URL import; complete uncontended backend pytest; changed-file Ruff; TypeScript; ESLint; complete frontend unit suite; production build; git diff checks
Exact results: hiring-identity fetch 12 passed; dependent matrix 196 passed in 16.93s; complete backend 6,649 passed / 64 skipped / 88 warnings in 318.51s with zero failures; changed-file Ruff passed; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,138 passed / 0 failed; production build passed with 33 static-generation entries; `git diff --check` and `git diff --cached --check` passed
Task-caused failures resolved: none; the new suite was verified non-vacuous by temporarily removing the predicate, which let five redirect escapes through (an unrelated host, a lookalike host, an attacker domain prefixed by the allowed one, a disallowed YouTube path, and an Instagram post page) before the predicate was restored
Known external failures: no live provider, hostile DNS, managed egress, or hosted service was used; consent-wall and login-wall behaviour is exercised with representative page text rather than live YouTube/Instagram responses
Remaining risks: OF-006 unauthenticated Next organization resolver and OF-007 YouTube HTML fallback still resolve and fetch outside the shared boundary from the Next runtime; fixed provider clients (OF-103/104/105) still lack uniform response bounds; internal redirects (WEB-005), stored-URL validation (WEB-006), JSON-LD escaping (WEB-007) and HTTP boundaries (WEB-008) remain
Next phase: Phase 2D atomic slice — require an authenticated same-origin session for `POST /api/profile/organization-identity`, move its retrieval to a backend endpoint using `SafeOutboundFetcher` with a platform destination predicate, bound the request and response, and keep the existing resolution outcomes; do not fold WEB-005/006/007 into the same commit
Important commands: `sed -n '1,120p' app/api/profile/organization-identity/route.ts`; `rg -n 'resolveCustomPathByHtml|organization-identity' app lib backend`; `cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_hiring_identity_public_fetch.py tests/test_safe_outbound_fetch.py`; never start a second pytest while a suite is running
```

## Phase 2B atomic checkpoint

```text
Phase: Phase 2 — Core web security boundaries, atomic slice 2B
Status: COMPLETE (WEB-004 is VALIDATED; Phase 2 remains in progress)
Initial HEAD: e65852472c75c224bc2c578c319d5fc0dc94037f
Final HEAD: Phase 2B checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(web): harden portfolio link previews
Files materially changed: portfolio link-preview service migrated to the shared outbound boundary with an exact oEmbed endpoint allowlist, redirect-free JSON policy, subdomain-accurate provider detection, and per-field metadata ceilings; link-preview security tests; portfolio-builder failure-path source contract; operator README; outbound inventory; execution ledger and handoff
Migrations: None; Alembic remains at the single 0059_oauth_connection_events head and the configured local SQLite remains unstamped
Behavior changed: authenticated `POST /portfolio/link-preview` still returns the same product responses, but every HTML retrieval now runs through `SafeOutboundFetcher` — public-only destinations, validated-IP TCP pin with original TLS identity, peer verification, per-hop redirect revalidation, no environment proxy or cookies, six-second total deadline, HTML/plain-only content types, and a 512 KiB decoded ceiling; YouTube/Vimeo oEmbed may only call two exact built-in endpoints, refuses every redirect, accepts only JSON within 64 KiB, and sends no credentials; provider detection no longer treats `notyoutube.com` or `youtube.com.attacker.example` as a provider; each metadata field read from an untrusted page is clamped to a length the product can store and display; unsafe URLs are rejected before any request, and network/provider failure still yields the manual-entry response so portfolio creation never breaks
Security assumptions: the preview endpoint remains authenticated; the two oEmbed endpoint constants are the only permitted network destinations for that path and are compared exactly, so a provider outage cannot redirect the request elsewhere; `_assert_public_http_url` is a fast pre-check and the fetch itself re-validates and pins, so the intervening DNS window is not authoritative; metadata URLs returned by an untrusted page are still only length-bounded here and remain WEB-006's validation responsibility before storage/display; `embed_html` is returned but no client renders it as HTML today, and it must never reach `dangerouslySetInnerHTML` without sanitisation; `allow_test_loopback` stays constructor-only test infrastructure
Tests run: focused link-preview suite; shared-boundary security suite; portfolio/profile dependent matrix; complete uncontended backend pytest; changed-file Ruff; TypeScript; ESLint; complete frontend unit suite; production build; Alembic heads/current; git diff checks
Exact results: link-preview 29 passed; shared-boundary 72 passed; dependent matrix 175 passed in 18.04s; complete backend 6,637 passed / 64 skipped / 88 warnings in 318.50s with zero failures; changed-file Ruff passed; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,138 passed / 0 failed; production build passed with 33 static-generation entries; one Alembic head 0059_oauth_connection_events; `git diff --check` and `git diff --cached --check` passed
Task-caused failures resolved: none in the implementation; a first full backend run reported 158 failures purely because a focused pytest was launched against the shared test database while it ran, and the uncontended rerun passed 6,637/6,637
Known external failures: no live provider, hostile DNS, managed egress, or hosted service was used; the portfolio builder has no browser coverage for the preview-failure path because it lives behind auth on `/you` and carries no test ids, so the contract is pinned as a source assertion and a real-browser spec is deferred until the builder gains stable selectors
Remaining risks: OF-005 social-profile verification, OF-006 unauthenticated Next organization resolver, and OF-007 YouTube HTML fallback still resolve and fetch outside the shared boundary; fixed provider clients (OF-103/104/105) still lack uniform response bounds; internal redirects, stored-URL validation, JSON-LD escaping, CSP/CORS/trusted-host/COOP/CORP, and Redis quotas remain in Phase 2/3
Next phase: Phase 2C atomic slice — route `ProfileService._fetch_public_hiring_identity_text` through `SafeOutboundFetcher` behind its existing platform allowlist without changing verification outcomes; do not migrate the Next organization resolver in the same commit
Important commands: `sed -n '1,120p' backend/app/services/profile_service.py`; `rg -n '_fetch_public_hiring_identity_text|httpx' backend/app/services/profile_service.py`; run `APP_ENV=test .venv/bin/python -m pytest tests/test_profile_features.py tests/test_safe_outbound_fetch.py` first; never start a second pytest while a suite is running
```

## Phase 2A atomic checkpoint

```text
Phase: Phase 2 — Core web security boundaries, atomic slice 2A
Status: COMPLETE (WEB-001 and WEB-002 are VALIDATED; WEB-004 is IN_PROGRESS; Phase 2 remains in progress)
Initial HEAD: 7759cc50243ed90012c92e9bba4741d28ec4a05c
Final HEAD: Phase 2A checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(web): pin validated outbound fetches
Files materially changed: new shared safe outbound-fetch service and exhaustive security tests; job/brand URL wrapper migration and expanded integration cases; backend production dependency declarations/lock metadata and operator README; source-contract frontend test; complete outbound caller inventory; execution ledger and handoff
Migrations: None; Alembic remains at the single 0059_oauth_connection_events head and the configured local SQLite remains unstamped
Behavior changed: authenticated job URL import and background brand enrichment retain their existing parsing, one-timeout retry, response/error, draft-only, and paste-fallback behavior, but every public request now permits only HTTP(S) ports 80/443, blocks non-public/reserved/multicast/metadata and unsafe embedded IPv4/IPv6 destinations, resolves each hop under a deadline, pins TCP to only the approved answers while preserving original TLS identity, verifies the connected peer, opens a fresh cookie-free pool per redirect, ignores environment proxies, rejects unsupported types and oversized declared/streamed/decompressed bodies, and enforces operation plus whole-chain deadlines; no AI feature was disabled or redesigned
Security assumptions: `httpx==0.28.1` and `httpcore==1.0.9` remain pinned until their transport API is deliberately reviewed; the low-level pool receives the original hostname for Host/SNI/certificate validation while its network backend substitutes only a prevalidated IP; all DNS answers used for connection must pass, and only those copied answers are connectable; a missing or mismatched peer fails closed; caller-supplied Authorization/Cookie/Host/proxy headers are impossible through the current policy; `allow_test_loopback` is constructor-only test infrastructure and must never become production configuration; managed egress filtering remains desirable defense in depth, not a substitute for this boundary
Tests run: changed-file Ruff and py_compile; uv locked-resolution check; isolated shared-fetch security suite; job/brand/import/enrichment dependent matrix; complete uncontended backend pytest; TypeScript; ESLint; complete frontend unit suite; production build; focused Chromium import workflow; git diff checks
Exact results: changed-file Ruff passed; Python compile passed; uv resolved 62 packages and `uv lock --check` passed; shared-fetch security 72 passed / 2 warnings; dependent matrix 327 passed / 2 warnings; complete backend 6,614 passed / 64 skipped / 88 warnings in 320.05s; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,137 passed / 0 failed/skipped; production build passed with 33 static-generation entries; import Chromium 4 passed; git diff checks passed
Task-caused failures resolved: the first complete frontend unit run found one source-contract assertion that required `is_global` to remain literally inside `job_url_fetcher.py`; that contract contradicted the intended shared-boundary architecture, so the test now verifies the stronger checks in `safe_outbound_fetch.py` plus the wrapper's explicit delegation and product limits; isolated 3/3 and complete 1,137/1,137 reruns passed
Known external failures: no production/staging DNS resolver, hostile live DNS rebinding domain, managed egress firewall, external public site, hosted database, or hosted service was used; local tests prove the actual pinned socket/Host/proxy-bypass path against a disposable TCP server, while staging egress and live-site drills remain operational certification work; the Phase 0 full browser failure matrices were not rerun because their known deterministic failures belong to later phases
Remaining risks: portfolio HTML/oEmbed preview still duplicates weaker DNS logic and can honor environment proxies; public hiring-identity verification and the unauthenticated Next organization resolver remain outside the shared boundary; fixed YouTube/Places clients need uniform response bounds; internal redirects, user URL storage/display validation, JSON-LD escaping, CORS/trusted-host/CSP/COOP/CORP, Redis quotas, and general browser/backend bearer boundary remain; see the complete outbound inventory
Next phase: Phase 2B atomic slice — migrate `link_preview_service` HTML retrieval to `SafeOutboundFetcher`, add a bounded JSON policy and strict redirect destination contract for fixed YouTube/Vimeo oEmbed, preserve authenticated manual-entry fallback behavior, and validate every private/redirect/size/type/outage case; do not start the organization resolver in the same commit
Important commands: `sed -n '1,470p' backend/app/services/link_preview_service.py`; `sed -n '1,280p' backend/tests/test_link_preview.py`; `rg -n '_fetch_text_url|_fetch_oembed_json|preview_portfolio_link' backend/app backend/tests`; run isolated shared-fetch/link-preview tests first, then complete backend/frontend gates; read docs/PRODUCTION_READINESS_OUTBOUND_FETCH.md before adding any network client
```

## Phase 1E atomic checkpoint

```text
Phase: Phase 1 — Critical authentication and identity security, atomic slice 1E
Status: COMPLETE (local engineering; AUTH-004 and AUTH-009 are BLOCKED_EXTERNAL, AUTH-007/010 continue in their owning later phases)
Initial HEAD: 22e9bd1586db1aabf3453bcd62182ed31bec0cfd
Final HEAD: Phase 1E checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(oauth): minimize scopes and add revocable YouTube grants
Files materially changed: centralized frontend/backend Google scope policies; NextAuth Google callback/exchange boundary; Auth, Settings, YouHub, Post Job, and platform-removal UI; same-origin YouTube refresh/disconnect routes and clients; Google identity access-token binding; OAuth repository/service lifecycle; provider refresh/revocation services; YouTube API error classification; OAuth connection-event model/migration; production configuration/examples/README; focused backend, unit, migration, and browser security tests; execution ledger and handoff
Migrations: 0059_oauth_connection_events additively creates credential-free authorization/revocation audit history with ownership FKs, nonnegative removal counts, and lookup indexes; downgrade is allowed only while the table is empty and otherwise refuses security-audit destruction; fresh disposable PostgreSQL upgraded, downgraded through 0059, and re-upgraded successfully
Behavior changed: ordinary Continue with Google requests only openid/email/profile and never asks for offline or YouTube access; Settings, YouHub, and Post Job request youtube.readonly incrementally with explicit consent only when needed; only a YouTube-scoped callback sends provider credentials server-to-server; basic login cannot overwrite an existing feature grant and clears only legacy credentials that never had a supported feature scope; the backend requires a matching server secret, verifies the signed ID-token/access-token `at_hash`, and confirms `mine=true` authority before committing credentials or replacing channel links; expired or unauthorized access tokens refresh once server-side, rotated refresh tokens are preserved across a downstream outage, explicit grant loss clears local authority, and transient quota/config/provider failures retain it; disconnect revokes Google remotely when possible and always clears all local credential copies, channel links, and channel avatar state without deleting the stable Google subject; the former bearer-authenticated provider-token upsert no longer exists; cross-origin and QA refresh/disconnect calls fail closed
Security assumptions: production NextAuth and FastAPI share one random 32–512 character GOOGLE_OAUTH_EXCHANGE_SECRET that is never public; backend GOOGLE_CLIENT_ID exactly matches the ID-token audience and GOOGLE_CLIENT_SECRET belongs to that OAuth client; Google continues issuing RS256 ID tokens whose OIDC at_hash uses SHA-256; stored feature grants always carry the exact youtube.readonly scope; PostgreSQL user-then-OAuth row locks serialize authorization, refresh, and disconnect; provider responses are untrusted, bounded where credentials are exchanged/revoked, never logged, and temporary failures do not destroy authority; the current Google consent screen and real provider behavior remain external verification gates
Tests run: changed-code Ruff; focused Google identity/scope/exchange/refresh/revocation/disconnect/encryption/config/migration/channel suites; complete backend pytest; Alembic heads/current; fresh disposable PostgreSQL migration/downgrade/re-upgrade suite; TypeScript; ESLint; complete frontend unit suite; production build; provider-session security suite; complete Settings Chromium suite; git diff checks
Exact results: changed-code Ruff passed; final focused backend matrix 109 passed / 6 warnings, with earlier combined refresh/revocation/migration matrix 112 passed; complete backend 6,538 passed / 64 skipped / 88 warnings in 318.29s; one Alembic head 0059_oauth_connection_events; configured local SQLite remains unstamped; disposable PostgreSQL 29 passed / 2 warnings; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,137 passed / 0 failed/skipped; production build passed with 33 static-generation entries; provider-session security 9 passed; Settings Chromium 12 passed; git diff checks passed
Known external failures: no real Google account, consent screen, OAuth client, refresh token, revocation, provider outage, production shared secret, hosted database, or production keyring was used; live consent/reconnect/refresh/revoke and hosted encrypted-only rollout remain BLOCKED_EXTERNAL; full Phase 0 standard/QA browser failure matrices were not rerun because their deterministic failures belong to Phases 2/4/11
Remaining risks: production shared-secret/keyring/Google configuration and live provider behavior are unverified; provider credential rows have not been backfilled/cut over on hosted infrastructure; the general browser-visible short-lived backend access bearer and remaining HTTP boundaries continue under AUTH-007/Phase 2; Redis-atomic abuse controls remain Phase 3; shared hardened outbound fetching, redirects, URL contracts, JSON-LD, and response headers remain Phase 2; operational monitoring/alerting remain Phase 12; release remains NO-GO
Next phase: Phase 2A atomic slice — first inventory and classify every server-side outbound fetch, then design one hardened fetch primitive and its complete DNS/IP/redirect/size/timeout/content-type tests before migrating a bounded caller set; do not create parallel SSRF implementations
Important commands: `rg -n 'httpx\.|fetch\(|requests\.|urlopen|AsyncClient|ClientSession' backend/app app lib`; inspect `backend/app/services/job_url_fetcher.py`, `backend/app/services/brand_enrichment_probe.py`, `backend/app/services/profile_service.py`, and existing SSRF tests; run `git branch --show-current && git status --short`; verify `.venv/bin/python -m alembic heads`; retain the final Phase 1 security matrices while Phase 2 changes shared network boundaries
```

## Phase 1D-3 atomic checkpoint

```text
Phase: Phase 1 — Critical authentication and identity security, atomic slice 1D-3
Status: COMPLETE (AUTH-008 is VALIDATED; Phase 1 remains in progress)
Initial HEAD: 1d75662bb356a45323dbb82100905c4295fdf133
Final HEAD: Phase 1D-3 checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(admin): add strong-auth browser flows
Files materially changed: same-origin strong-auth route adapter; typed browser and backend strong-auth clients; short-lived Google reauthentication state helper; NextAuth JWT callback; production admin layout gate; shared enrollment/challenge/recovery/management controls; administrator Settings integration; backend status contract; security/unit/browser regressions; execution ledger and handoff
Migrations: None; this slice consumes the already validated 0058 schema and leaves one Alembic head at `0058_strong_auth_totp`
Behavior changed: production administrators see no admin shell until the backend confirms fresh durable-session assurance; unenrolled password administrators primary-reauthenticate and enroll TOTP, Google administrators must complete recent Google login, enrolled administrators challenge with TOTP or one unused recovery code, recovery codes are shown once and must be acknowledged before the gate opens, and Settings can rotate codes or disable the factor with the required proofs; disablement signs out locally after the backend revokes every durable session; backend factor status now explicitly reports whether policy requires strong authentication
Security assumptions: FastAPI remains the privilege authority and independently verifies every factor/primary proof; the Next route requires a live ADMIN backend session, rejects QA personas and cross-site POSTs, accepts only bounded JSON/actions/fields, maps backend errors without reflecting arbitrary bodies, and marks responses no-store; browser JSON can never provide a Google ID token—the five-minute provider proof is held only inside the encrypted HttpOnly NextAuth JWT cookie, is bound to the backend user, capped by the provider token expiry, pruned on expiry, and omitted from `/api/auth/session` and browser Session types; recovery codes live only in transient React state/DOM and an operator-controlled clipboard; production fails closed on status errors while non-production deliberately preserves the existing backend-offline admin shell for local development; backend authorization still fails closed in every environment
Tests run: focused backend status/administrator lifecycle and changed-code Ruff; Google reauthentication state and browser-client contract/security tests; provider-session leakage tests; TypeScript; complete ESLint; complete frontend unit suite; production build; focused strong-auth browser matrix; existing admin/Settings browser regression matrix; isolated reruns and one uncontended complete backend suite; Alembic heads/current; `git diff --check`
Exact results: focused backend 12 passed / 3 warnings; three representative backend collision diagnostics passed; uncontended backend 6,484 passed / 64 skipped / 89 warnings with 6,548 collected and zero failures; changed-code Ruff passed; TypeScript passed; ESLint 0 errors / 33 known warnings; final isolated frontend unit run 1,133 passed / 0 failed / 0 skipped in 2.00s; production build passed with 33 static-generation entries; all 6 strong-auth Chromium cases passed in the final combined run; combined strong-auth/admin/Settings Chromium regression matrix 24 passed / 1 pre-existing Settings sign-out navigation timeout, whose isolated rerun passed 1 / 1; one Alembic head `0058_strong_auth_totp`; configured local SQLite remains unstamped; `git diff --check` passed
Known external failures: no hosted database, production keyring, physical authenticator, live Google reauthentication, provider outage/revocation, multi-instance deployment, or lost-all-factors support drill was exercised; authenticated GitHub inspection and the AUTH-004 hosted keyring/backfill cutover remain external; the full Phase 0 standard/QA browser matrices were not rerun; an invalid duplicate full-pytest orchestration run produced 38 unrelated shared-test-state failures, all three isolated representatives and the subsequent uncontended full suite passed, so that overlapped run is not a repository failure
Remaining risks: ordinary Google login still requests YouTube/offline scope and provider disconnect does not yet complete remote revocation under AUTH-009/AUTH-004; the general browser-visible backend access bearer remains under AUTH-007; Phase 3 owns Redis-atomic limits and trusted-client identity; real strong-auth secret provisioning/rotation, physical-device/live-provider validation, security monitoring, and a no-bypass lost-all-factors recovery procedure remain external/operational gates; WebAuthn/passkeys remain optional future hardening and no pretend MFA was added
Next phase: Phase 1E atomic slice — inspect and minimize ordinary Google-login scopes, keep YouTube authorization incremental, implement server-owned provider disconnect/revocation with safe local credential invalidation and auditability, add reconnect/revoke/outage tests, and separate locally validated engineering from live Google credential drills; do not touch hosted rows or credentials
Important commands: start with `rg -n 'scope|access_type|prompt|youtube|revoke|disconnect|OAuthAccount' lib app backend/app tests`; inspect `lib/auth.ts`, `app/api/identity/connect/start/route.ts`, `app/api/identity/disconnect/route.ts`, `lib/youtubeIdentity.ts`, and the backend OAuth credential service/model; retain focused auth tests, then run TypeScript, lint, all frontend units, focused browser tests, backend auth/Google tests, build, Alembic heads/current, and `git diff --check`
```

## Phase 1D-2 atomic checkpoint

```text
Phase: Phase 1 — Critical authentication and identity security, atomic slice 1D-2
Status: COMPLETE (Phase 1 and AUTH-008 remain in progress)
Initial HEAD: ff31a6ef072334c6234e93a23334ee7167b780aa
Final HEAD: Phase 1D-2 checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(admin): add real TOTP authentication lifecycle
Files materially changed: dedicated strong-auth secret cipher and TOTP primitives; TOTP/recovery models and API schemas; StrongAuthService; auth dependencies/routes; rate-limit rules; Alembic 0058; production configuration and environment documentation; disposable PostgreSQL runner; focused crypto/lifecycle/migration/concurrency/config tests; execution ledger and handoff
Migrations: 0058_strong_auth_totp additively creates one pending-or-confirmed encrypted TOTP credential per user and hash-only one-time recovery codes with lifecycle, failed-attempt, uniqueness, and cascading-ownership constraints; no account is enrolled or elevated; downgrade refuses while any pending or confirmed factor exists to prevent silent authentication/recovery destruction
Behavior changed: under-elevated durable administrators can read factor status, primary-reauthenticate with their current password or independently verified linked Google subject, enroll and confirm a real RFC 6238 TOTP factor, elevate with a non-replayed TOTP or one-time recovery code, regenerate recovery codes after a fresh TOTP proof, and disable the factor only with both primary and factor proof; confirmation/regeneration/recovery revoke sibling sessions and disabling revokes all sessions; invalid factor attempts persist and audit, with five attempts causing a 15-minute account-factor lock; enrollment expires after 10 minutes; sensitive successful responses are `Cache-Control: no-store`; production refuses to boot without a dedicated valid strong-auth keyring
Security assumptions: TOTP secrets are 160-bit base32 values encrypted under a dedicated rotation-ready AES-256-GCM keyring whose authenticated context binds user, credential, and purpose; OAuth keys must never be reused; TOTP uses 30-second, six-digit SHA-1 as required by RFC 6238 with only plus/minus one step drift, and the last accepted step is persisted under a row lock; recovery codes contain 160 random bits, are returned only on creation, and persist only a domain-separated SHA-256 hash; all factor mutations lock user, credential, then sessions and revalidate the current session; PostgreSQL locking is the multi-instance authority; the route limiter is additive defense only until Phase 3 replaces its process-local/trusted-IP assumptions with Redis-atomic enforcement; lost-all-factors reset remains an external support/recovery design and no bypass was added
Tests run: RFC TOTP vectors/drift/input/URI tests; cipher round-trip/context-binding/tamper/rotation/config/plaintext tests; password and Google reauthentication; encrypted enrollment/expiry/confirmation; replay/lockout; one-time recovery; regeneration; disable; audit/redaction; sibling/all-session revocation; non-admin/unconfigured fail-closed behavior; migration downgrade guard; PostgreSQL schema constraints and concurrent replay; focused and whole-tree Ruff; complete backend pytest; TypeScript; ESLint; complete frontend unit suite; production build; fresh disposable PostgreSQL upgrade/downgrade/re-upgrade; Alembic heads/current; `git diff --check`
Exact results: focused backend 59 passed / 3 warnings; changed-code Ruff passed; backend 6,484 passed / 64 skipped / 89 warnings with 6,548 tests collected and zero failures; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,125 passed / 0 failed in 2.83s; production build passed with 32 static pages; disposable PostgreSQL suite 29 passed / 2 warnings; one Alembic head `0058_strong_auth_totp`; configured local SQLite remains unstamped; whole-tree Ruff remains at the pre-existing 93 findings; `git diff --check` passed
Known external failures: no hosted database, real production strong-auth keyring, key-rotation ceremony, physical authenticator, browser MFA flow, multi-instance deployment, or lost-all-factors support drill was exercised; authenticated GitHub inspection and AUTH-004 provider/keyring rollout remain external; the Phase 0 standard/QA browser matrices were not rerun because this backend-only slice changed no frontend behavior
Remaining risks: administrators still lack browser enrollment/challenge/recovery UI, so AUTH-008 remains `IN_PROGRESS`, the production gate would strand an administrator who cannot call the API directly, and release remains `NO-GO`; the frontend needs a first-factor-aware strong-auth interstitial, one-time recovery-code handling, failure/expiry/lockout UX, and browser privilege/revocation tests; strong-auth key provisioning/rotation and a no-bypass recovery procedure require operational validation; WebAuthn/passkeys remain optional future provider-backed hardening rather than pretend MFA; Phase 3 still owns Redis-atomic rate limits and trusted proxy identity; browser access bearers remain visible to application JavaScript under AUTH-007
Next phase: Phase 1D-3 atomic slice — add a narrowly scoped administrator TOTP enrollment/challenge/recovery UI using the existing backend contract, keep recovery codes visible only at creation, handle revoked/expired/locked sessions safely, and prove the global admin privilege boundary plus logout/recovery behavior in focused browser tests; do not redesign unrelated Settings/admin UX and do not mark AUTH-008 validated until this matrix is green
Important commands: inspect `lib/backend.ts`, `lib/auth.ts`, `components/settings/SettingsClient.tsx`, `app/admin/layout.tsx`, and existing auth/browser test helpers; run `rg -n 'backendToken|401|403|insufficient_user_authentication|admin|settings' lib app components tests`; keep backend focus with `cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_strong_auth_lifecycle.py tests/test_admin_strong_auth.py`; preserve one Alembic head with `.venv/bin/python -m alembic heads`; after frontend changes run `npx tsc --noEmit`, `npm run lint`, `node --test tests/*.test.mjs`, focused Playwright, and `npm run build`
```

## Phase 1D-1 atomic checkpoint

```text
Phase: Phase 1 — Critical authentication and identity security, atomic slice 1D-1
Status: COMPLETE (Phase 1 and AUTH-008 remain in progress)
Initial HEAD: 5dd829a896f01de0238182f668ecca54f03d27c3
Final HEAD: Phase 1D-1 checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(admin): add strong-auth enforcement foundation
Files materially changed: administrator assurance policy helper; authoritative access dependency and deliberately narrow base-auth logout dependency; durable auth-session model; Alembic 0057; production configuration and environment documentation; canonical HTTP error handler; focused administrator/config/migration/PostgreSQL tests; execution ledger and handoff
Migrations: 0057_admin_session_assurance additively appends nullable `strong_auth_method`, `strong_auth_verified_at`, and `strong_auth_expires_at` columns plus a completeness/supported-method/chronology check constraint; it elevates no row; downgrade refuses after any assurance field has been used because an old binary would bypass the boundary
Behavior changed: when `ADMIN_STRONG_AUTH_REQUIRED=true`, every ADMIN request—including ordinary owner/participant routes outside `/admin`—requires a live durable session with fresh database-backed TOTP, WebAuthn, or recovery-code assurance; signed JWT `amr`/`acr` claims cannot elevate a session; QA and claimless administrator sessions fail closed; stored expiry is capped by the configured 5–60 minute maximum age; under-elevated administrators can still revoke the current/all session families; custom HTTP error rendering now preserves security response headers such as `WWW-Authenticate`; production configuration refuses to boot with the administrator gate disabled
Security assumptions: no endpoint in this slice writes assurance and migration 0057 sets no assurance, so this is an enforcement foundation rather than pretend MFA; enabling the required production gate before the next factor slices intentionally denies administrator product access except safe logout; only a successful server-side factor verifier may populate all three assurance fields atomically; ordinary product/admin routes must continue using `get_current_access_context`; `get_current_base_access_context` is limited to logout and future factor ceremonies; the durable session remains the revocation boundary and access-token claims remain untrusted for elevation
Tests run: assurance policy tests; administrator privilege, forged-claim, expiry, non-admin, logout-all, admin-panel, session, migration-downgrade, and production-config tests; focused Ruff on every changed Python file; complete backend pytest; TypeScript; ESLint; complete frontend unit suite; production build; fresh disposable PostgreSQL migration/downgrade/re-upgrade and database constraint suite; Alembic heads/current; whole-tree Ruff baseline; `git diff --check`
Exact results: focused backend 50 passed / 9 warnings; changed-code Ruff passed; backend 6,457 passed / 61 skipped / 88 warnings in 308.96s; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,125 passed / 0 failed in 3.18s; production build passed with 32 static pages; disposable PostgreSQL suite 26 passed / 2 warnings; one Alembic head `0057_admin_session_assurance`; configured local SQLite remains unstamped; whole-tree Ruff remains at the pre-existing 93 findings; `git diff --check` passed
Known external failures: no real factor device/provider, hosted database, production cookie, multi-instance deployment, Google credential, or provider outage was exercised; authenticated GitHub inspection and the AUTH-004 provider/keyring rollout remain external; the Phase 0 standard/QA browser failure matrices were not rerun because this slice changed no frontend behavior
Remaining risks: administrators have no product-accessible enrollment/challenge/recovery flow yet, so AUTH-008 is `IN_PROGRESS` and production remains `NO-GO`; TOTP secrets need encrypted storage, enrollment confirmation, replay prevention, recovery-code one-time consumption, abuse controls, audit events, factor-reset/session-revocation semantics, and browser UX; browser access bearers remain visible to application JavaScript under AUTH-007; Google incremental scopes/provider revocation, hosted OAuth encryption cutover, security monitoring, and prior deterministic browser failures remain
Next phase: Phase 1D-2 atomic slice — implement a genuine encrypted TOTP credential and server-side enrollment/confirmation/elevation/recovery lifecycle using the narrow base-auth ceremony boundary, hash-only single-use recovery codes, replay protection, bounded attempts, auditability, and session revocation on factor changes; do not mark AUTH-008 validated until the frontend and full recovery/privilege matrix are complete
Important commands: `rg -n 'encrypt|AESGCM|SecretStr|rate_limit|AdminAuditLog|AuthSession|BaseAuthenticatedAccessDependency' backend/app backend/tests`; inspect `backend/app/core/oauth_credentials.py`, `backend/app/core/rate_limit.py`, `backend/app/models/admin.py`, and auth repository/service patterns; before migration run `.venv/bin/python -m alembic heads` and `./scripts/test_interaction_status_postgres.sh`; start with focused `APP_ENV=test .venv/bin/python -m pytest tests/test_admin_strong_auth.py tests/test_auth_sessions.py tests/test_config.py`
```

## Phase 1C-5 atomic checkpoint

```text
Phase: Phase 1 — Critical authentication and identity security, atomic slice 1C-5
Status: COMPLETE (Phase 1 remains in progress; AUTH-006 is VALIDATED)
Initial HEAD: 8591c8e287fd72706187e6f74c558cea74dfed63
Final HEAD: Phase 1C-5 checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(session): revoke sessions on security events
Files materially changed: password-reset repository/service transaction boundaries; password and existing-account Google login locks; direct and report-driven administrator suspension; lock-refresh behavior for user/reset/session rows; SQLite/PostgreSQL auth and admin regressions; execution ledger and handoff
Migrations: None; this slice uses the existing 0056 durable-session schema
Behavior changed: a successful password reset changes the password, consumes every outstanding reset token, and revokes every durable session family in one commit; direct administrator suspension and report-resolution suspension update the account, revoke all durable families, and append the audit record in one commit; unsuspension permits a fresh login but never resurrects invalidated access or refresh credentials; password/reset issuance, reset confirmation, existing-account Google login, and suspension serialize through a user-row lock before session creation/revocation; concurrent reset requests leave exactly one usable token; lock reads use `populate_existing` so a waiter observes the committed winner instead of stale ORM identity-map state
Security assumptions: PostgreSQL row locking is authoritative; security events and login issuance acquire the user row before session families, while refresh/current logout acquire a session before credentials and never row-lock the user, avoiding a lock-order cycle; the configured persistent mode is required for immediate all-family invalidation; bounded migration-mode claimless access remains non-selectively revocable until its <=60-minute expiry; every future credential-changing endpoint must call the shared all-family revocation primitive in the same transaction; long-lived WebSockets remain Phase 8 work
Tests run: focused auth/session/Google/admin pytest; forced commit-failure rollback regression; focused Ruff on every changed Python file; complete backend pytest with explicit summary; TypeScript; ESLint; complete frontend unit suite; production build; fresh disposable PostgreSQL migration/downgrade/re-upgrade plus OAuth/session/reset concurrency tests; Alembic heads/current; whole-tree Ruff baseline; `git diff --check`
Exact results: focused auth/Google/admin 65 passed; rollback/reset focus 2 passed; changed-code Ruff passed; backend 6,450 passed / 60 skipped / 88 warnings in 311.69s; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,125 passed / 0 failed; production build passed with 32 static pages; disposable PostgreSQL suite 25 passed / 2 warnings; one Alembic head `0056_persistent_auth_sessions`; configured local SQLite remains unstamped; whole-tree Ruff improved from 110 to 93 known findings after fixing the touched admin module header/import ordering; `git diff --check` passed
Known external failures: no hosted database, production cookie, multi-instance deployment, real Google credential, or provider outage was exercised; authenticated GitHub inspection and the AUTH-004 provider/keyring rollout remain external; the Phase 0 standard/QA browser failure matrices were not rerun because this slice changed no frontend behavior
Remaining risks: browser access bearers remain visible to application JavaScript under AUTH-007; active-session inventory/individual device controls are a non-blocking hardening extension beyond the validated current/all-device revocation contract; migration-mode claimless access cannot be selectively revoked; long-lived WebSockets do not disconnect at revocation; revocation/login abuse throttling and security-event monitoring remain AUTH-010/Phase 12; Google incremental scope/provider revocation, hosted OAuth encryption cutover, and administrator strong authentication remain
Next phase: Phase 1D-1 atomic slice — inspect the existing administrator authorization/session boundary, add real strong-auth capability/enforcement contracts and fail-closed production gates without pretending locally configured MFA exists, and test privilege boundaries/recovery behavior; classify provider enrollment and live-factor drills accurately as external
Important commands: `rg -n 'ADMIN|admin|mfa|passkey|webauthn|amr|acr|require_permission' backend/app backend/tests lib app`; `cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_admin_panel.py tests/test_auth_sessions.py tests/test_config.py`; `.venv/bin/python -m alembic heads`; `./scripts/test_interaction_status_postgres.sh`; inspect configuration and NextAuth claims before deciding whether Phase 1D-1 needs a migration
```

## Phase 1C-4 atomic checkpoint

```text
Phase: Phase 1 — Critical authentication and identity security, atomic slice 1C-4
Status: COMPLETE (Phase 1 and AUTH-006 remain in progress)
Initial HEAD: 712fcef749315a62b23c3b3387da3666ba1848c3
Final HEAD: Phase 1C-4 checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(session): enforce durable logout revocation
Files materially changed: authoritative access-token dependency/context; auth revocation repository/service/router/schema contracts; refresh lock ordering; NextAuth server-side sign-out event; backend token helper; Settings all-device logout workflow; SQLite/PostgreSQL/frontend/browser security tests; execution ledger and handoff
Migrations: None; this slice consumes the additive 0056 `auth_sessions` and `auth_refresh_credentials` schema without changing it
Behavior changed: every non-QA access JWT carrying `sid` must resolve to the same user and a live, unexpired, unrevoked database session; `persistent` mode rejects claimless legacy access JWTs while `migration` preserves their bounded rollout compatibility; `POST /auth/logout` derives current ownership from a verified refresh credential or authenticated access token and never accepts a caller-selected session ID; `POST /auth/logout-all` revokes every durable family for the authenticated account; refresh/logout/logout-all lock the session family before credentials; NextAuth sign-out sends its server-held refresh proof to the backend before clearing the same-origin cookie and falls back to access proof only when refresh material is absent; refresh credentials remain absent from `/api/auth/session`; Settings adds an explicit confirmed “Sign out everywhere” workflow
Security assumptions: PostgreSQL row locking is authoritative for multi-instance refresh/revocation serialization; a refresh proof is preferred because access may already be expired at logout; the refresh value travels only from the NextAuth server event to the backend and is never serialized into the browser session; backend request-body logging must remain disabled/redacted for auth routes; migration-mode claimless access remains non-revocable until its production-capped <=60-minute expiry, which is why migration must be bounded; a backend outage can prevent remote family revocation even though NextAuth still clears its local cookie, so revocation failures are logged and production monitoring remains required; existing long-lived WebSockets do not re-authenticate mid-connection and remain Phase 8 work
Tests run: focused auth-session pytest; focused Node session/privacy tests; focused Ruff on every touched Python file; TypeScript; complete frontend unit suite; complete backend pytest; ESLint; production build; fresh disposable PostgreSQL migration/downgrade/re-upgrade plus forced concurrent refresh and refresh-versus-logout tests; complete Settings Chromium Playwright suite; Alembic heads/current; whole-tree Ruff baseline; `git diff --check`
Exact results: focused auth-session 15 passed / 2 warnings; focused frontend security 19 passed; focused Ruff passed; TypeScript passed; frontend unit 1,125 passed / 0 failed; backend 6,449 passed / 57 skipped / 88 warnings in 299.85s; ESLint 0 errors / 33 known warnings; production build passed with 32 static pages; disposable PostgreSQL suite 22 passed / 2 warnings; Settings Playwright 10 passed; one Alembic head `0056_persistent_auth_sessions`; configured local SQLite remains unstamped; whole-tree Ruff remains at 110 known findings; `git diff --check` passed
Known external failures: no hosted database or live multi-instance deployment was touched; no real production cookie, load balancer, Google credential, or outage logout was exercised; authenticated GitHub inspection and the AUTH-004 provider/keyring rollout remain external; the whole standard/QA browser matrices retain the Phase 0 known failures and were not claimed green
Remaining risks: AUTH-006 still needs atomic all-family revocation on password reset, administrator suspension, and any future credential change, plus active-session inventory/individual revocation; migration-mode claimless access cannot be selectively revoked; long-lived WebSockets do not disconnect at revocation; revocation endpoint abuse throttling/audit work remains AUTH-010; browser access bearers remain visible to application JavaScript under AUTH-007; server-side revocation failures need production alerting; Google incremental scope/provider revocation, hosted OAuth encryption cutover, and administrator strong authentication remain
Next phase: Phase 1C-5 atomic slice — make password reset and administrator suspension revoke every durable session family in the same transaction, preserve unsuspension/relogin behavior, and add concurrency/security regression tests before considering active-session management
Important commands: `cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_auth_sessions.py tests/test_admin_panel.py`; inspect `AuthService.reset_password`, administrator suspension/unsuspension handlers, `AuthRepository.revoke_auth_sessions`, and transaction boundaries; run `.venv/bin/python -m alembic heads`, `./scripts/test_interaction_status_postgres.sh`, focused Ruff, then broad auth/backend/frontend gates; no migration is expected unless inspection proves otherwise
```

## Phase 1C-3 atomic checkpoint

```text
Phase: Phase 1 — Critical authentication and identity security, atomic slice 1C-3
Status: COMPLETE (Phase 1 remains in progress; AUTH-005 is VALIDATED and AUTH-006 is IN_PROGRESS)
Initial HEAD: e18f5800ee2fb4f2df1f095affd77bd2179cfa82
Final HEAD: Phase 1C-3 checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(session): add persistent rotating refresh sessions
Files materially changed: auth-session/refresh-credential models and repository; token creation/refresh service and auth router; production configuration; Alembic 0056; NextAuth refresh singleflight; backend/frontend security, migration, import-order, and PostgreSQL race tests; environment/operator docs; execution ledger and handoff
Migrations: 0056_persistent_auth_sessions additively creates `auth_sessions` and `auth_refresh_credentials`; raw refresh values never enter the database; the downgrade refuses while any unexpired session family exists because removing server state would reactivate used or revoked signed credentials
Behavior changed: `legacy` retains the old stateless behavior for local/rollback compatibility; `migration` issues persistent families while temporarily accepting claimless legacy refresh JWTs; `persistent` rejects legacy refresh JWTs; password and Google logins share durable issuance; each refresh rotates once under row locks; immediate duplicate use is rejected without falsely revoking the family, while delayed reuse revokes every family credential and records compromise; suspended accounts cannot log in and presented persistent families are revoked; NextAuth coalesces identical same-process refresh callbacks and rejects a backend response without a replacement credential; production boot requires a <=60-minute access lifetime and forbids `legacy`
Security assumptions: deploy migration 0056 before enabling non-legacy issuance; use `migration` only for a bounded compatibility window with explicit acknowledgement; do not switch to `persistent` until the last stateless refresh issued by an old instance has expired (or deliberately rotate JWT_SECRET and accept global logout); never roll an old stateless binary back over live persistent credentials without a signing-secret rotation/global logout; SHA-256 is safe here because signed refresh JWTs contain high-entropy UUID credential IDs; PostgreSQL row locking is authoritative for multi-instance rotation; the reuse grace prevents a false family-compromise decision but never accepts the duplicate credential; access-token session revocation is intentionally the next atomic slice
Tests run: focused auth/session/config/migration pytest; isolated repository-first import regression; focused Ruff on every touched Python file; full backend pytest; TypeScript; all frontend unit tests; ESLint; production build; production-mode backend import; fresh disposable PostgreSQL upgrade/downgrade/re-upgrade plus schema and forced concurrency tests; diagnostic Alembic drift check; complete Settings Playwright; one real-backend QA customer/API journey with `AUTH_SESSION_MODE=persistent`; `git diff --check`
Exact results: focused auth checkpoint 54 passed / 7 warnings; focused Ruff passed; full backend 6,443 passed / 56 skipped / 88 warnings in 297.31s; TypeScript passed; frontend unit 1,122 passed / 0 failed; ESLint 0 errors / 33 known warnings; production build passed with 32 static pages; production-mode backend import passed; one Alembic head `0056_persistent_auth_sessions`; disposable PostgreSQL suite 21 passed / 2 warnings; whole-tree Ruff remains at 110 known findings; diagnostic `alembic check` reported only pre-existing unrelated drift and no auth-session operation; Settings Playwright 9 passed; persistent-session real-backend QA probe 1 passed
Known external failures: no hosted database migration or session rollout ran; no real production cookies, Google credentials, load balancer, or multi-instance staging were exercised; live OAuth/keyring work from AUTH-004 remains external; no push or deployment occurred
Remaining risks: AUTH-006 still needs access-token revocation enforcement, current-session logout, logout-all, password-reset/credential-change all-family revocation, immediate suspension revocation, and active-session management; same-process frontend singleflight does not coordinate separate frontend instances (the backend safely produces one winner without family revocation, but a losing callback can still require retry); refresh abuse throttling/audit work remains AUTH-010; browser access bearers remain visible to application JavaScript under AUTH-007; ordinary Google login still requests YouTube/offline scope; admin strong authentication remains; production must complete the explicit migration window; whole-tree Ruff and Alembic drift are known baseline debt
Next phase: Phase 1C-4 atomic slice — make the `sid` access claim authoritative, add authenticated current-session and all-session revocation APIs, wire same-origin logout without exposing refresh credentials, and cover revoked-access/logout concurrency before adding password-reset/suspension triggers
Important commands: `cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_auth_sessions.py tests/test_auth_and_channels.py tests/test_config.py`; `.venv/bin/python -m alembic heads`; `./scripts/test_interaction_status_postgres.sh`; `cd .. && node --test tests/backendTokenRefresh.test.mjs && npx tsc --noEmit`; inspect `backend/app/api/deps.py`, `backend/app/services/auth_service.py`, `backend/app/repositories/auth_repository.py`, `lib/auth.ts`, and the NextAuth sign-out callers before designing revocation
```

## Phase 1C-2 atomic checkpoint

```text
Phase: Phase 1 — Critical authentication and identity security, atomic slice 1C-2
Status: COMPLETE (Phase 1 and AUTH-004 remain in progress)
Initial HEAD: bd52e97f10428c00dc55889b0be5f338e82703be
Final HEAD: Phase 1C-2 checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(auth): encrypt stored OAuth credentials
Files materially changed: OAuth credential cryptographic primitive and storage policy; OAuth account model/repository/YouTube credential consumer; production configuration and dependency injection; Alembic 0055; idempotent rotation CLI; focused unit/API/rotation/PostgreSQL tests; backend dependency declaration/lock; backend environment and operator documentation; execution ledger and handoff
Migrations: 0055_oauth_credential_encryption additively adds nullable `access_token_ciphertext`, `refresh_token_ciphertext`, and `credentials_encrypted_at`; it performs no implicit data rewrite, preserves plaintext columns for an explicit expand/backfill/contract rollout, and refuses a downgrade that would discard encrypted-only credentials
Behavior changed: configured OAuth writes can run in temporary rollback-compatible `dual` mode or steady-state `encrypted_only` mode; encrypted-only writes clear plaintext and reads never fall back to plaintext; YouTube refresh decrypts only inside the backend repository boundary; AES-GCM additional authenticated data binds ciphertext to its provider, provider subject, and token field; old keys decrypt while new writes use only the active key; the operator command is dry-run by default, requires exact APP_ENV confirmation to write, locks and commits bounded batches, resumes idempotently, and never emits credential values
Security assumptions: every configured key is independently generated 32-byte secret material held only in the server secret manager; key IDs are non-secret stable labels; all historical keys remain available until every row is verified on the active key; `dual` mode is a temporary acknowledged migration state and not production steady state; migration 0055 must land before code expecting its columns; hosted plaintext must not be cleared until dual backfill and rollback readiness have been verified; database/host compromise is outside application-layer key custody and the keyring must not share that trust boundary
Tests run: focused OAuth cipher/storage/rotation/config/Google/auth pytest; focused Ruff on every touched Python file; full backend pytest; Python compileall; uv lock consistency; rotation CLI help and fail-closed default; Alembic heads; fresh disposable PostgreSQL upgrade, downgrade to 0038, fixture load, re-upgrade, schema/concurrency/interaction tests; `git diff --check`; whole-tree Ruff baseline comparison; diagnostic Alembic model-drift check
Exact results: 61 focused tests passed / 7 warnings; focused Ruff passed; full backend 6,428 passed / 54 skipped / 88 warnings in 292.94s; compileall passed; uv resolved-lock check passed with 62 packages; rotation CLI help passed and default plaintext configuration failed closed with exit 2; one Alembic head `0055_oauth_credential_encryption`; disposable PostgreSQL suite 17 passed / 2 warnings; whole-tree Ruff reported 110 known findings versus 111 at Phase 0; diagnostic `alembic check` reported only pre-existing unrelated model drift and no OAuth credential-column operation
Known external failures: no production keyring was provisioned; no hosted database was inspected or backfilled; no live Google token was encrypted/decrypted or revoked; no production secret manager or staging deployment was touched
Remaining risks: AUTH-004 remains `IN_PROGRESS` until a real keyring is provisioned, hosted rows complete dual backfill, encrypted-only mode clears and verifies plaintext, old-key retirement is proven, and provider disconnect/revocation is implemented; backend refresh sessions remain stateless/non-revocable; ordinary Google login still requests YouTube/offline scope; admin strong authentication remains; whole-tree Ruff and Alembic drift are known baseline debt
Next phase: Phase 1C-3 atomic slice — design and implement additive persistent session families with hashed rotating refresh credentials, replay/reuse detection, and compatibility-safe issuance before wiring revocation/logout behavior
Important commands: `cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_oauth_credentials.py tests/test_rotate_oauth_credentials.py tests/test_config.py tests/test_google_identity.py tests/test_auth_and_channels.py`; `.venv/bin/python -m alembic heads`; `./scripts/test_interaction_status_postgres.sh`; with a disposable configured database and non-secret test keyring, `.venv/bin/python -m scripts.rotate_oauth_credentials` before any `--apply`; inspect `app/core/security.py`, `app/services/auth_service.py`, and auth router/session response contracts before designing migration 0056
```

## Phase 1C-1 atomic checkpoint

```text
Phase: Phase 1 — Critical authentication and identity security, atomic slice 1C-1
Status: COMPLETE (Phase 1 remains in progress)
Initial HEAD: f60463629f32b3dbcfe0728a978514a4d694af3a
Final HEAD: Phase 1C-1 checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(auth): enforce concurrent OAuth link ownership
Files materially changed: OAuth account model; AuthService concurrent-conflict recovery; Alembic 0054; disposable PostgreSQL auth race tests; PostgreSQL migration test runner; execution ledger and handoff
Migrations: 0054_oauth_link_uniqueness adds `uq_oauth_user_provider` on `(user_id, provider)` after a non-destructive ambiguous-link preflight; downgrade removes only that constraint
Behavior changed: simultaneous different Google subjects for one CreatorJobs user now have exactly one winner and one conflict; one Google subject cannot be claimed by different users; simultaneous identical exchanges converge successfully on one user/link instead of surfacing an unhandled database error
Security assumptions: one Google provider identity per CreatorJobs user is the established product contract; the existing `(provider, provider_account_id)` constraint remains authoritative for subject ownership; ambiguous legacy rows must be investigated, never auto-merged; PostgreSQL constraint arbitration is authoritative under concurrency
Tests run: focused Google/auth SQLite tests; focused Ruff; Alembic heads/current; fresh disposable PostgreSQL upgrade, downgrade to 0038, fixture load, re-upgrade, migration tests, interaction tests, and four deterministic OAuth concurrency tests; full backend pytest
Exact results: focused Google/auth 33 passed / 7 warnings; Ruff passed; one Alembic head `0054_oauth_link_uniqueness`; disposable PostgreSQL suite 14 passed / 2 warnings; full backend 6,405 passed / 53 skipped / 88 warnings in 303.37s
Known external failures: the hosted production database was not inspected; migration 0054 deliberately refuses any ambiguous pre-existing `(user_id, provider)` duplicates and requires security review before retry
Remaining risks: provider credentials remain plaintext at rest; key rotation and provider revocation are absent; backend refresh sessions remain stateless/non-revocable; Google login still requests YouTube/offline scope; admin strong authentication remains
Next phase: Phase 1C-2 atomic slice — add versioned application-layer encryption for provider access/refresh credentials with an expand/backfill/compatibility-safe migration and key-rotation tests
Important commands: `cd backend && .venv/bin/python -m alembic heads`; `./scripts/test_interaction_status_postgres.sh`; `APP_ENV=test .venv/bin/python -m pytest tests/test_google_identity.py tests/test_auth_and_channels.py`; inspect `app/core/config.py`, `app/models/oauth_account.py`, and every OAuth token read/write before designing 0055
```

## Phase 1B atomic checkpoint

```text
Phase: Phase 1 — Critical authentication and identity security, atomic slice 1B
Status: COMPLETE (Phase 1 remains in progress)
Initial HEAD: e1276e75b0584a622aaa561db983502cd191a266
Final HEAD: Phase 1B checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(session): keep Google credentials server-side
Files materially changed: NextAuth JWT/session callback and declarations; safe-session helper; YouHub, Post Job, and Settings YouTube flows; authenticated YouTube refresh API; legacy identity routes; frontend backend-client credential surface; unit/browser security tests; execution ledger and handoff
Migrations: None
Behavior changed: Google provider access/refresh credentials, provider subject, scope/expiry metadata, and raw profile claims are no longer copied into the NextAuth JWT or `/api/auth/session`; existing cookies are scrubbed on their next JWT callback and their JWT subject is normalized to the canonical backend user ID; the public session keeps only the non-secret provider name; browser YouTube refresh/reconnect now calls a same-origin authenticated server route, which delegates to the backend's stored OAuth account; legacy identity routes also use backend-held credentials; Settings now initiates Google re-consent when the backend reports `youtube_reauth_required`
Security assumptions: the verified Google exchange remains the only creator/updater of a provider link; backend-held OAuth credentials are authoritative; SameSite/HttpOnly NextAuth cookies and current same-origin routing remain intact; provider credentials are still plaintext in the database pending AUTH-004; CreatorJobs backend access tokens remain browser-visible pending the additive persistent-session/browser-boundary work
Tests run: provider-session security unit suite; all frontend unit tests; TypeScript; ESLint; production build; focused backend Google/auth tests; complete Settings Playwright suite plus direct `/api/auth/session` sentinel test
Exact results: provider-session security 5 passed; frontend unit 1,119 passed / 0 failed; TypeScript passed; ESLint passed with 0 errors / 33 pre-existing warnings; production build passed and generated 32 static pages; backend focused auth 33 passed / 7 warnings; complete Settings Playwright suite 9 passed, including the direct `/api/auth/session` credential-sentinel regression and server-owned YouTube refresh
Known external failures: real Google consent/re-consent, provider revocation, and provider outage exercises require configured staging Google credentials; none were used
Remaining risks: OAuth credentials need at-rest encryption/key rotation and revocation; concurrent provider-link races need deterministic PostgreSQL proof; backend refresh sessions remain stateless/non-revocable; basic Google login still requests offline YouTube scope; full browser/backend cookie boundary and admin strong authentication remain
Next phase: Phase 1C atomic slice — validate concurrent OAuth-link collision behavior on disposable PostgreSQL, then implement a coherent rotation-ready at-rest credential encryption slice only if migration/test budget remains sufficient
Important commands: `rg -n 'access_token|refresh_token|provider_account_id' backend/app/models backend/app/repositories backend/app/services`; `cd backend && .venv/bin/python -m alembic heads`; `node --test tests/providerSessionSecurity.test.mjs`; `npx playwright test tests/e2e/settings.spec.ts`
```

## Phase 1A atomic checkpoint

```text
Phase: Phase 1 — Critical authentication and identity security, atomic slice 1A
Status: COMPLETE (Phase 1 remains in progress)
Initial HEAD: 832d0332d66c2abf2d6e2d168c2ac51ae7258fa6
Final HEAD: Phase 1A checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(auth): verify Google identity server-side
Files materially changed: backend Google identity service/config/dependencies/auth schema/router/service/repository; authenticated OAuth update boundary; NextAuth exchange and browser token-recovery callers; auth/security tests; execution ledger and handoff
Migrations: None
Behavior changed: `/auth/oauth/google` now requires a Google-issued ID token; email, subject, verified-email state, and display name derive only from verified claims; caller identity fields are forbidden; provider subjects cannot be reassigned; `/me/oauth/google/upsert` cannot create or choose a link; NextAuth fails closed when backend Google authentication fails; browser recovery now asks the server-owned NextAuth session to refresh instead of rebuilding identity from browser fields; production boot requires backend GOOGLE_CLIENT_ID; Google exchange uses the auth-login rate limit
Security assumptions: backend GOOGLE_CLIENT_ID exactly matches the Google OAuth client used by NextAuth; google-auth owns signature/JWKS validation; Google's documented issuers remain accounts.google.com and https://accounts.google.com; HTTPS termination and real provider credentials remain external deployment gates
Tests run: focused Google/auth/config pytest; dependent job/import pytest; full backend pytest; focused Ruff; TypeScript; ESLint; all frontend unit tests; production frontend build
Exact results: 38 focused auth/config tests passed; 422 dependent backend tests passed; full backend 6,405 passed / 49 skipped / 88 warnings; focused Ruff passed; TypeScript passed; ESLint passed with the pre-existing 33 warnings; frontend unit 1,114 passed / 0 failed; production build passed with 31 static pages
Known external failures: real Google login/JWKS/provider-outage exercise requires configured Google credentials and staging; no external service was changed
Remaining risks: Google access/refresh credentials and provider metadata are still serialized into browser-visible sessions; provider credentials remain plaintext at rest; backend refresh sessions remain stateless and non-revocable; concurrent OAuth-link races still need deterministic PostgreSQL validation/recovery; Google login still requests YouTube/offline scopes; admin strong-auth work remains
Next phase: Phase 1B atomic slice — remove browser-visible Google provider credentials while preserving explicit YouTube connection/reconnection
Important commands: `rg -n 'accessToken|refreshToken|providerAccountId|oauthScope|profile' lib/auth.ts types/next-auth.d.ts app components`; `APP_ENV=test .venv/bin/python -m pytest tests/test_google_identity.py tests/test_auth_and_channels.py`; `npx tsc --noEmit`
```

## Phase checkpoint

```text
Phase: Phase 0 — Baseline and preservation
Status: COMPLETE
Initial HEAD: 2b616e1f239ffa5c0129be1da1b1324197d68650
Final HEAD: Phase 0 checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): docs(readiness): establish phase 0 execution baseline
Files materially changed: docs/PRODUCTION_READINESS_EXECUTION.md; docs/PRODUCTION_READINESS_HANDOFF.md
Migrations: None
Behavior changed: None
Security assumptions: Local branch/ref inspection is authoritative; remote state remains unverified; no production credentials or hosted services were used
Tests run: Repository integrity/ref checks; TypeScript; ESLint; frontend unit; frontend build; backend pytest; Ruff; Alembic heads/current; disposable PostgreSQL migration test; standard Playwright; serial deterministic rerun; real-backend QA Playwright; npm/Python audits; Gitleaks history scan
Exact results: See baseline matrix below
Known external failures: GitHub remote fetch requires credentials; live Google/email/storage/Redis/hosting/legal/staging checks unavailable
Remaining risks: Every non-baseline item in the execution ledger; current release assessment is NO-GO
Next phase: Phase 1 — Critical authentication and identity security
Important commands: See final section
```

## Repository and preservation baseline

- Active branch: `integration/import-and-messaging-2026-07-30`
- Initial HEAD: `2b616e1f239ffa5c0129be1da1b1324197d68650`
- Primary worktree was clean before Phase 0.
- Secondary worktree `/Users/guhanpurushothaman/creator-jobs-messaging-paused` is on `wip/messaging-paused` and was clean.
- `git fsck --full --no-reflogs` reported dangling recovery commits/trees but no corruption.
- Every local branch is an ancestor of the active integration branch; no local branch has a commit absent from the active branch.
- The active branch is 266 commits ahead of local `main` and 147 commits ahead of its locally recorded upstream.
- Authenticated remote fetch failed during the audit because credentials are unavailable. Do not infer current remote truth from local tracking refs.

Frozen recovery references recorded at Phase 0:

| Reference | Kind | Object |
|---|---|---|
| `wip/messaging-paused` | branch | `fdabfd4b3feb2ea75fda3ac0a889f7e02dac5158` |
| `recovery/pre-messaging-merge` | branch | `858934259fe8ea7b7de69ac2326d4c099375a80c` |
| `backup/integrated-import-messaging-2026-07-30` | branch | `de7a0583e4c003073fc0cd67b4fdc43859cf0eed` |
| `wip/job-import-readiness-paused-2026-07-25` | branch | `93c31b2ae69512a7b0f38d5098e65f861e0028b5` |
| `integrated-import-messaging-2026-07-30` | annotated/lightweight tag | `5e06112afbf9cf36a2957491c26e6626f4fe5523` |

Never delete, move, reset, rebase, amend, or repoint these references.

## Phase 0 baseline matrix

All results below were obtained at the initial HEAD. Long-running audit results immediately preceded Phase 0 and the repository remained clean at the same commit; TypeScript, lint, and frontend unit tests were rerun during Phase 0.

| Check | Exact result | Baseline classification |
|---|---|---|
| `npx tsc --noEmit` | PASS | Green |
| `npm run lint` | PASS exit code; 0 errors, 33 warnings | Known debt |
| `node --test tests/*.test.mjs` | 1,114 passed; 0 failed/skipped | Green |
| `npm run build` with production-like non-secret config | PASS; 31 static pages generated | Green |
| `APP_ENV=test .venv/bin/python -m pytest` | 6,387 passed; 49 skipped; 86 warnings | Green with known skips/warnings |
| `.venv/bin/ruff check .` | 111 findings | Known baseline failure |
| `.venv/bin/python -m alembic heads` | One head: `0053_brand_about_enrichment_state` | Green |
| `.venv/bin/python -m alembic current` | Configured local SQLite has no stamped revision | Known local-state limitation |
| `./scripts/test_interaction_status_postgres.sh` | Fresh disposable PostgreSQL upgrade, downgrade to `0038`, fixture load, re-upgrade; 10 tests passed | Green |
| `npm run test:e2e` | 438 passed; 26 failed | Known baseline failure |
| Serial rerun of the 26 failed browser tests | 9 passed; 17 failed deterministically | Known deterministic failures |
| `npm run test:e2e:qa` | 272 passed; 6 failed; 2 skipped in 14.8 minutes | Known baseline failure |
| Frontend production dependency audit | 6 vulnerabilities: 1 critical, 4 high, 1 moderate | Release blocker |
| Python environment audit | 37 findings in 12 packages | Release blocker |
| Production backend import with memory limiter | PASS | Limited baseline only |
| Production backend import with recommended Redis limiter | FAIL: Redis Python package absent | Release blocker |
| Production HTTP probes | `/`, `/api/health`, `/auth`, `/you` returned 200; dev/QA routes returned 404 | Partially green |
| Security headers/metadata probes | CSP absent; root canonical inherited by private pages and 404s | Release blocker |
| Gitleaks full-history scan | 286 commits and 18.45 MB scanned; one generic-key alert in `backend/app/main.py` manually confirmed false positive | Green, retain CI scan |

The tracked history contains only `.env.example` and `backend/.env.example` among environment files. Local ignored environment files exist and were not read into this document. No secret value was printed or stored.

## Known browser failures

### Standard Playwright: 17 deterministic failures

The initial 464-test run had 26 failures. A serial rerun passed 9 and reproduced 17. The deterministic set covers:

- Recruiter and agency public profile views and entry links.
- Pipeline row to chat-dock handoff.
- Homepage/jobs beta trust copy.
- Internal/external job detail and application behavior, including demo deadlines.
- Dev data-source switch.
- `/post-job` horizontal overflow at 390 and 320 pixels.
- Search results and empty state.
- Job-detail statistics/trust panel.
- Multi-screen Post Job headings.
- `/jobs/1` smoke behavior.
- External Apply CTA and link semantics.

The nine failures that passed serially remain flake candidates and must not be silently dismissed; they included settings, admin planned-tab, listing actions, and portfolio-popup cases.

### Real-backend QA Playwright: 6 failures

1. `tests/e2e/qa/applicant-requirements.spec.ts:173` — submitted application modal never closes; Send application remains present.
2. `tests/e2e/qa/craft-ambiguity.spec.ts:76` — persisted role snapshot becomes `Video Editor` instead of `Video Editor\nLikely match` expected by the current contract; inspect whether presentation copy leaked into selection or the test contract is stale before changing either.
3. `tests/e2e/qa/draft-assistant.spec.ts:581` — typing indicator overlaps the submitted reply by approximately 0.61 px.
4. `tests/e2e/qa/post-job-later-steps.spec.ts:669` — switching onsite Kolkata back to remote retains `Kolkata` instead of clearing it.
5. `tests/e2e/qa/qa-personas.spec.ts:488` — duplicate `job-apply-button` test IDs exist in desktop and mobile containers.
6. `tests/e2e/qa/workspace-performance.spec.ts:108` — `/me/interviews` and `/me/engagements` were each requested three times; contract permits at most two.

Do not weaken these tests without first proving that their asserted product contract is wrong.

## Phase 1 current risk state

- Phase 1A removed the caller-asserted Google identity takeover: `/auth/oauth/google` now accepts a signed ID token and derives identity only after server verification.
- Phase 1A made provider-subject reassignment fail closed and removed browser-driven identity reconstruction. Phase 1C-1 added the inverse database uniqueness constraint and deterministic PostgreSQL races, so AUTH-002 is now `VALIDATED`.
- Phase 1B removed Google access/refresh tokens, provider subject, OAuth metadata, and raw claims from the browser session and from the encrypted NextAuth JWT. A sentinel-bearing legacy JWT produced a clean `/api/auth/session` response in Playwright.
- YouHub, Post Job, and Settings refresh or disconnect YouTube through authenticated same-origin server routes that reject cross-origin and QA use, return bounded states, and never expose provider credentials.
- Provider credentials have a locally validated AES-256-GCM storage path, rotation keyring, additive migration, idempotent backfill/rewrap command, fixed-endpoint refresh, remote revocation, unconditional local clearing, and credential-free audit history. Production rows remain unverified and may remain plaintext until the external dual-backfill/encrypted-only rollout is actually completed; real Google behavior is also unverified.
- Backend refresh tokens are durable, hash-only, one-time credentials grouped into persistent families. Rotation is serialized on PostgreSQL; delayed replay revokes the family and records compromise; production cannot boot in stateless `legacy` mode.
- Signed access-token `sid` now resolves through live database state on every non-QA authenticated request. Revocation therefore stops both refresh and subsequent HTTP access immediately; `persistent` rejects claimless access while bounded `migration` mode accepts it until its production-capped <=60-minute expiry.
- Current-session logout prefers the server-held refresh credential, logout-all revokes every durable family, and Settings exposes a confirmed all-device workflow. NextAuth performs current-family revocation inside its same-origin sign-out event without serializing its refresh credential into `/api/auth/session`.
- Password reset and both administrator-suspension entry points now revoke every durable family atomically. Password/reset issuance, reset confirmation, existing-account Google login, and suspension share a user-first lock boundary, so a concurrent old-password/provider login either commits before the security event and is revoked or observes the new security state and fails. AUTH-006 is `VALIDATED`.
- Active-session inventory/individual device controls remain a non-blocking hardening extension; long-lived WebSocket disconnect, abuse throttling/audit, and production revocation-failure alerting remain AUTH-010/Phase 8/Phase 12 work.
- Administrator TOTP is a complete locally validated factor lifecycle: secrets are encrypted under a dedicated keyring, TOTP steps and recovery codes are one-use, failures lock durably, factor changes revoke session families, and every privileged backend route checks current durable-session assurance. The browser adds password/Google primary reauthentication, enrollment, challenge, one-time recovery display, rotation, disablement, and a production fail-closed no-shell gate. AUTH-008 is `VALIDATED`.
- The browser factor adapter is same-origin, action-allowlisted, size-bounded, no-store, and rejects cross-site POSTs. Google reauthentication proof is held for at most five minutes in the encrypted HttpOnly NextAuth JWT cookie and is never serialized into the Session API; ordinary browser JSON cannot supply it.
- The rollout is deliberately additive: land 0056, run bounded `migration` mode until the final legacy refresh expires, then use `persistent`; land 0057 and 0058, provision the dedicated strong-auth keyring, then enable administrator strong-auth enforcement; land 0059 before code emits OAuth connection events. Downgrade/old-binary rollback after persistent issuance requires JWT signing-secret rotation/global logout, downgrade of 0057 is refused once assurance state has been used, downgrade of 0058 is refused while factor material exists, and downgrade of 0059 is refused once audit history exists.
- Ordinary Google login requests identity scopes only. YouTube authorization is explicit and incremental, the access token must match the signed OIDC `at_hash`, a server-only exchange secret gates persistence, and a successful provider authority check precedes credential/channel commits. Live provider validation remains `BLOCKED_EXTERNAL`.

Phase 1 must remain additive and migration-safe. The browser-field removal, least-privilege server-owned YouTube lifecycle, OAuth ownership constraints, local encrypted credential architecture, persistent refresh-family foundation, authoritative access checks, explicit logout contracts, security-event revocation, and real administrator strong authentication are complete locally. Do not bypass the verified exchange, reintroduce browser provider credentials, accept caller-selected session IDs or provider proof in browser strong-auth JSON, trust JWT claims for strong-auth elevation, broaden the base-auth dependency beyond logout/factor ceremonies, change the user-then-OAuth lock order without real PostgreSQL race tests, retire an OAuth/strong-auth key before a zero-pending rotation audit, or remove plaintext columns before the hosted encrypted-only contract is verified.

## Phase 2 files to read first

- `backend/app/services/job_url_fetcher.py`
- `backend/app/services/job_import_url_service.py`
- `backend/app/services/brand_enrichment_probe.py`
- `backend/app/services/brand_enrichment_service.py`
- `backend/app/services/profile_service.py`
- `backend/app/services/youtube_service.py`
- `backend/app/services/google_oauth_refresh.py`
- `backend/app/services/google_oauth_revocation.py`
- `app/api/profile/organization-identity/route.ts`
- `app/api/location/autocomplete/route.ts`
- `app/api/location/details/route.ts`
- `backend/tests/test_job_url_import.py`
- `backend/tests/test_brand_url_fetcher.py`
- every additional caller/test returned by the outbound-fetch inventory before designing a shared primitive

## Important commands

Before Phase 2A:

```bash
cd /Users/guhanpurushothaman/creator-jobs-phase1
git branch --show-current
git rev-parse HEAD
git status --short
git worktree list
git show-ref | rg 'messaging-paused|pre-messaging-merge|integrated-import-messaging|job-import-readiness-paused'
```

Focused discovery:

```bash
rg -n 'httpx\.|fetch\(|requests\.|urlopen|AsyncClient|ClientSession' backend/app app lib
sed -n '1300,1760p' backend/app/services/job_url_fetcher.py
sed -n '1,280p' backend/app/services/brand_enrichment_probe.py
sed -n '1,260p' app/api/profile/organization-identity/route.ts
```

Migration safety:

```bash
cd /Users/guhanpurushothaman/creator-jobs-phase1/backend
.venv/bin/python -m alembic heads
APP_ENV=test .venv/bin/python -m alembic current
./scripts/test_interaction_status_postgres.sh
# Dry-run only unless the target environment, keyring, migration, and rollback
# posture have been independently verified.
.venv/bin/python -m scripts.rotate_oauth_credentials
```

No push, production deployment, hosted Neon access, Vercel change, or Render change occurred through the latest atomic checkpoint.
