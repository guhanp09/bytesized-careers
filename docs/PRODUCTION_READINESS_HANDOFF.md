# CreatorJobs Production Readiness Handoff

## Resume summary

```text
LAST COMPLETED PHASE: Phase 0 — Baseline and preservation
LAST COMPLETED ATOMIC SLICE: Phase 1C-4 — authoritative access-session revocation and current/all-device logout
NEXT ATOMIC SLICE: Phase 1C-5 — revoke every durable family on password reset and administrator suspension
CURRENT HEAD: Phase 1C-4 checkpoint commit (run `git rev-parse HEAD`; the tracked document cannot contain its own commit hash)
CURRENT ALEMBIC HEAD: 0056_persistent_auth_sessions
CURRENT ALEMBIC CURRENT: local configured SQLite is unversioned; disposable PostgreSQL upgrade/downgrade/re-upgrade reached 0056 successfully
IMPORTANT NEW ARCHITECTURE: FastAPI verifies Google ID tokens and owns provider credentials; NextAuth exposes only an allowlisted session; the database enforces both OAuth ownership invariants; provider credentials use versioned AES-256-GCM storage; backend password/Google logins issue durable session families with one-time hash-only refresh credentials; authenticated HTTP requests now treat signed `sid` as a database-backed revocation boundary; refresh, current logout, and logout-all share one session-before-credential PostgreSQL lock order; NextAuth sign-out proves the family server-to-server with its encrypted-cookie refresh credential; Settings exposes confirmed all-device revocation
NEW ENVIRONMENT VARIABLES: backend GOOGLE_CLIENT_ID; OAUTH_CREDENTIAL_KEYS; OAUTH_CREDENTIAL_ACTIVE_KEY_ID; OAUTH_CREDENTIAL_WRITE_MODE; ALLOW_OAUTH_PLAINTEXT_COMPATIBILITY_IN_PRODUCTION; AUTH_SESSION_MODE; ALLOW_LEGACY_REFRESH_COMPATIBILITY_IN_PRODUCTION; REFRESH_REUSE_GRACE_SECONDS
NEW SERVICES: app.services.google_identity.GoogleIdentityVerifier; app.core.oauth_credentials.OAuthCredentialCipher; app.services.oauth_credential_storage.OAuthCredentialStorage; app.models.AuthSession/AuthRefreshCredential; scripts.rotate_oauth_credentials
OUTSTANDING EXTERNAL REQUIREMENTS: authenticated GitHub fetch/protection inspection; real OAuth keyring provisioning plus hosted credential backfill/encrypted-only verification and provider revocation; Google/provider credentials; email DNS/provider; managed Postgres/Redis/storage; counsel approval; accessibility review; backup/restore; staging soak
KNOWN TEST FAILURES: 17 deterministic standard Playwright failures and 6 real-backend QA failures from the Phase 0 matrix remain unrerun as a whole; this slice's focused browser, security, PostgreSQL, frontend, and backend gates are green
COMMANDS TO RESUME: see "Phase 1C-4 atomic checkpoint" and "Important commands"
FILES TO READ FIRST: backend/app/services/auth_service.py; backend/app/repositories/auth_repository.py; backend/app/api/deps.py; backend/app/api/v1/routers/auth.py; backend/app/api/v1/routers/admin.py; backend/app/models/auth_session.py; backend/app/core/security.py; backend/tests/test_auth_sessions.py; backend/tests/test_auth_sessions_postgres.py; lib/auth.ts; lib/backendTokenRefresh.ts; components/settings/SettingsClient.tsx
RELEASE ASSESSMENT: NO-GO
```

The machine-readable work status is in `docs/PRODUCTION_READINESS_EXECUTION.md`. The older `docs/PRODUCTION_READINESS.md` predates the current product and audit; treat it as historical context, not the active source of truth.

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
- YouHub, Post Job, Settings, and the legacy identity routes now refresh YouTube through backend-held OAuth credentials. The same-origin `/api/identity/youtube/refresh` route returns channel data or bounded error codes, never provider credentials.
- Provider credentials have a locally validated AES-256-GCM storage path, rotation keyring, additive migration, and idempotent backfill/rewrap command. Production rows remain unverified and may remain plaintext until the external dual-backfill/encrypted-only rollout is actually completed; provider disconnect/revocation is also still absent.
- Backend refresh tokens are durable, hash-only, one-time credentials grouped into persistent families. Rotation is serialized on PostgreSQL; delayed replay revokes the family and records compromise; production cannot boot in stateless `legacy` mode.
- Signed access-token `sid` now resolves through live database state on every non-QA authenticated request. Revocation therefore stops both refresh and subsequent HTTP access immediately; `persistent` rejects claimless access while bounded `migration` mode accepts it until its production-capped <=60-minute expiry.
- Current-session logout prefers the server-held refresh credential, logout-all revokes every durable family, and Settings exposes a confirmed all-device workflow. NextAuth performs current-family revocation inside its same-origin sign-out event without serializing its refresh credential into `/api/auth/session`.
- Password-reset and administrator-suspension all-family triggers, any future credential-change trigger, active-session inventory/individual revocation, long-lived WebSocket disconnect, abuse throttling/audit, and production revocation-failure alerting remain AUTH-006/AUTH-010 work.
- The rollout is deliberately additive: land 0056, run bounded `migration` mode until the final legacy refresh expires, then use `persistent`. Downgrade/old-binary rollback after persistent issuance requires JWT signing-secret rotation/global logout.
- Google login requests YouTube/offline scopes during ordinary sign-in rather than using incremental authorization.
- Admin authorization exists, but strong administrator authentication/MFA enforcement does not.

Phase 1 must remain additive and migration-safe. The browser-field removal, server-owned YouTube replacement, OAuth ownership constraints, local encrypted credential architecture, persistent refresh-family foundation, authoritative access checks, and explicit logout contracts are complete. Do not bypass the verified exchange, reintroduce browser provider credentials, accept caller-selected session IDs, invert the session-before-credential lock order, retire an OAuth key before a zero-pending rotation audit, or remove plaintext columns before the hosted encrypted-only contract is verified.

## Phase 1 files to read first

- `backend/app/api/v1/routers/auth.py`
- `backend/app/api/deps.py`
- `backend/app/services/auth_service.py`
- `backend/app/core/security.py`
- `backend/app/repositories/auth_repository.py`
- `backend/app/models/auth_session.py`
- `backend/app/models/oauth_account.py`
- `backend/app/schemas/auth.py`
- `backend/app/core/config.py`
- `backend/app/core/oauth_credentials.py`
- `backend/app/services/oauth_credential_storage.py`
- `backend/scripts/rotate_oauth_credentials.py`
- `backend/tests/test_auth_and_channels.py`
- `backend/tests/test_auth_sessions.py`
- `backend/tests/test_auth_sessions_postgres.py`
- `lib/auth.ts`
- `lib/backendTokenRefresh.ts`
- `types/next-auth.d.ts` if present, plus components identified by `rg 'session\?\.user\?\.(accessToken|refreshToken)'`
- `backend/alembic/versions/0056_persistent_auth_sessions.py` and its predecessor before designing any migration

## Important commands

Before Phase 1:

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
rg -n 'exchange_google_oauth|OAuthGoogleExchangeRequest|provider_account_id|accessToken|refreshToken|refresh_backend_session' backend/app backend/tests lib app components
sed -n '1,240p' backend/app/api/v1/routers/auth.py
sed -n '430,570p' backend/app/services/auth_service.py
sed -n '130,540p' lib/auth.ts
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
