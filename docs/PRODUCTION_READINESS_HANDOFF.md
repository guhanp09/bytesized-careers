# CreatorJobs Production Readiness Handoff

## Resume summary

```text
LAST COMPLETED PHASE: Phase 2 — Core web security boundaries (locally complete and certified; listed external gates remain)
CURRENT PHASE: Phase 3 — Dependencies, rate limiting, and request safety
LAST COMPLETED ATOMIC SLICE: Phase 2J (WEB-008B) — the complete Content-Security-Policy, nonce-based and enforcing, followed by the Phase 2 certification checkpoint
NEXT ATOMIC SLICE: Phase 3 opens at RATE-001 (Redis-backed atomic rate limiting). Read the current in-process limiter first — `rg -n "rate.?limit" backend/app --glob '!tests'` — and decide the 3A/3B split from what is actually there rather than from the illustrative decomposition. DEP-001/DEP-002 (dependency audits) have no dependency on RATE-001 and are a smaller, safer opening slice if budget is short
CURRENT HEAD: Phase 2D-2 checkpoint commit (run `git rev-parse HEAD`; the tracked document cannot contain its own commit hash)
CURRENT ALEMBIC HEAD: 0059_oauth_connection_events
CURRENT ALEMBIC CURRENT: local configured SQLite is unversioned; disposable PostgreSQL upgrade/downgrade/re-upgrade reached 0059 successfully
IMPORTANT NEW ARCHITECTURE (2B): portfolio HTML preview and YouTube/Vimeo oEmbed now call `SafeOutboundFetcher` instead of their own DNS/redirect logic; oEmbed additionally requires an exact built-in endpoint constant, refuses every redirect, accepts only JSON, and caps decoded bodies at 64 KiB, while HTML previews accept only HTML/plain text within 512 KiB; provider host detection matches a domain or its subdomains rather than any suffix, so `notyoutube.com` is no longer treated as YouTube; each metadata field extracted from an untrusted page is length-clamped; unsafe URLs are refused before any request and network/provider failure still returns the manual-entry response. IMPORTANT ARCHITECTURE (2A): `SafeOutboundFetcher` is the one backend boundary for user-influenced public GETs: strict HTTP(S)/80-or-443 URL normalization; public-only IPv4/IPv6 plus tunnel-address checks; DNS answers are copied into an httpcore network backend that connects only to those IPs while the original host remains the HTTP Host/TLS SNI/certificate identity; the connected peer is checked; every redirect gets fresh validation and a fresh cookie-free one-connection pool; environment proxies are ignored; decoded response bytes, content type, redirects, DNS/connect/read/total time, URL length, and header surface are bounded. PublicJobUrlFetcher and PublicBrandUrlFetcher preserve their product parsing/error/retry contracts on top. The Phase 1 verified identity, durable session, encrypted credential, and administrator TOTP architecture remains unchanged
NEW ENVIRONMENT VARIABLES: backend GOOGLE_CLIENT_ID; backend GOOGLE_CLIENT_SECRET; GOOGLE_OAUTH_EXCHANGE_SECRET shared only between NextAuth and FastAPI; OAUTH_CREDENTIAL_KEYS; OAUTH_CREDENTIAL_ACTIVE_KEY_ID; OAUTH_CREDENTIAL_WRITE_MODE; ALLOW_OAUTH_PLAINTEXT_COMPATIBILITY_IN_PRODUCTION; AUTH_SESSION_MODE; ALLOW_LEGACY_REFRESH_COMPATIBILITY_IN_PRODUCTION; REFRESH_REUSE_GRACE_SECONDS; ADMIN_STRONG_AUTH_REQUIRED; ADMIN_STRONG_AUTH_MAX_AGE_MINUTES; STRONG_AUTH_SECRET_KEYS; STRONG_AUTH_SECRET_ACTIVE_KEY_ID
NEW DEPENDENCIES: backend now declares its already-locked runtime `httpx==0.28.1` and `httpcore==1.0.9` usage directly; no package version changed
NEW SERVICES: app.services.safe_outbound_fetch shared public-URL boundary; docs/PRODUCTION_READINESS_OUTBOUND_FETCH.md complete caller inventory; plus all previously documented OAuth/session/strong-auth services
OUTSTANDING EXTERNAL REQUIREMENTS: authenticated GitHub fetch/protection inspection; matching production GOOGLE_OAUTH_EXCHANGE_SECRET provisioning; real Google consent-screen scope configuration/verification and live login/incremental-consent/reconnect/refresh/revoke/outage drill; real OAuth/strong-auth keyring provisioning plus rotation drills; hosted credential backfill/encrypted-only verification; a physical authenticator-device drill and lost-all-factors support procedure; email DNS/provider; managed Postgres/Redis/storage; counsel approval; accessibility review; backup/restore; staging soak
KNOWN TEST FAILURES: 17 deterministic standard Playwright failures and 6 real-backend QA failures from the Phase 0 matrix remain unrerun as a whole and are owned by later phases; Phase 2C's 12-case hiring-identity fetch suite, 196-case dependent matrix, and complete uncontended 6,649-case backend suite are green alongside TypeScript, ESLint, the 1,138-case frontend unit suite and the production build; Phase 2B's 29-case link-preview suite, 72-case shared-boundary suite, 175-case dependent matrix, complete uncontended 6,637-case backend suite, TypeScript, ESLint, 1,138-case frontend unit suite, and production build are green; whole-tree Ruff retains unrelated baseline findings while every changed Python file passes; one overlapping pytest run during this session produced 158 shared-test-state failures that vanished on an uncontended rerun — never run a second pytest against the shared test database
COMMANDS TO RESUME: see "Phase 2C atomic checkpoint" and "Important commands"
FILES TO READ FIRST: docs/PRODUCTION_READINESS_EXECUTION.md; docs/PRODUCTION_READINESS_OUTBOUND_FETCH.md; backend/app/services/safe_outbound_fetch.py; backend/tests/test_hiring_identity_public_fetch.py; app/api/profile/organization-identity/route.ts; lib/youtubeIdentity.ts; backend/app/services/profile_service.py
RELEASE ASSESSMENT: NO-GO
```

The machine-readable work status is in `docs/PRODUCTION_READINESS_EXECUTION.md`. The older `docs/PRODUCTION_READINESS.md` predates the current product and audit; treat it as historical context, not the active source of truth.

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
