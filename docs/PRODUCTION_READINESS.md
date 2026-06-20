# CreatorJobs — Production Readiness Plan (Admit Live Users)

> **Purpose:** Hand this file to an AI agent (or engineer) to execute when you're ready to
> take CreatorJobs live. It is a prioritized, self-contained implementation brief.
> **Launch model:** Free beta (no payments — payment integration is intentionally deferred).
> **Status when written:** Core user workflows verified working through the real UI
> (auth, profile edit + avatar/banner, browse/search/filter, post job, apply, hire/shortlist/
> decline, save/unsave, talent hiring requests, notifications, mobile). The remaining work is
> operational hardening, secrets, deploy, and email — not core features.

## How to use this document
Execute **P0 first** (these are hard launch blockers — the app is unsafe or non-functional for
real users without them), then **P1**, then **P2** post-launch. Each item lists the concrete
change, the files/areas involved, and an acceptance check. Do not skip the Verification section.

## Verdict
Strong foundation already in place: the backend **refuses to boot in production** with unsafe
config (`validate_production_settings` in `backend/app/core/config.py`), auth endpoints are
rate-limited, email verification is enforced before login, admin routes are gated
(`require_admin`), and CORS is enforced. **Not launchable until the P0 items below are done.**

## Recommended launch stack (hosting was undecided)
Simplest robust path that avoids local-media / in-memory-state pitfalls:
- **Backend:** one managed container — Fly.io / Render / Railway. `backend/Dockerfile` exists.
- **Database:** managed Postgres (provider add-on).
- **Media:** S3-compatible object storage. (Fastest beta alternative: a single backend instance
  with a persistent volume mounted at `MEDIA_ROOT` — acceptable but caps you at one instance.)
- **Frontend:** Vercel (native Next.js 16).
- **Rate limiting:** managed Redis, OR set `ALLOW_MEMORY_RATE_LIMIT_IN_PRODUCTION=true` only if
  you commit to a single backend instance.

---

## P0 — Launch blockers (must do)

### P0.1 Rotate all leaked secrets
`.env.local` was committed to git history and contains the **real** Google OAuth client secret,
YouTube API key, and `NEXTAUTH_SECRET`. Treat all three as compromised.
- Rotate Google OAuth client secret + YouTube Data API key in Google Cloud Console.
- Generate a fresh `NEXTAUTH_SECRET` and a fresh backend `JWT_SECRET`.
- `.gitignore` already excludes `.env*` (only `*.example` tracked) — confirm no new secrets land.
- Optional: scrub history with `git filter-repo`/BFG. Rotation is the real fix; scrubbing is hygiene.
- **Accept:** `git ls-files | grep -i env` shows only `*.example`; rotated creds work in staging.

### P0.2 Run DB migrations on deploy
`backend/Dockerfile` only runs uvicorn. The SQLite auto-sync (`sync_dev_sqlite_schema` in
`backend/app/main.py`) is **SQLite-only** — a production Postgres will have **no schema**.
- Add `alembic upgrade head` as a release/entrypoint step before the server starts (incl. the
  latest migration `backend/alembic/versions/0020_user_banner_url.py`).
- **Accept:** fresh Postgres + deploy → all tables exist (including `users.banner_url`).

### P0.3 Wire real email (SMTP)
`EMAIL_MODE` defaults to `log` — verification and password-reset links only print to backend logs,
so **users cannot verify their email and therefore cannot log in**.
- Set `EMAIL_MODE=smtp` and `SMTP_HOST/SMTP_PORT/SMTP_USERNAME/SMTP_PASSWORD/SMTP_FROM_EMAIL`
  (config slots already exist in `backend/app/core/config.py`; sender in `backend/app/services/email_service.py`).
- **Accept:** a real signup on staging delivers a verification email; clicking it enables login.

### P0.4 Set the full production environment
The backend enforces these via `validate_production_settings` (it raises on any unsafe value).
- **Backend:** `APP_ENV=production`, strong `JWT_SECRET`, `DEBUG=false`, prod `FRONTEND_BASE_URL`,
  `CORS_ORIGINS` = prod frontend https origin(s) (no localhost), Postgres `DATABASE_URL`, SMTP (P0.3),
  rate-limit backend (Redis or memory opt-in).
- **Frontend (build-time):** `NEXT_PUBLIC_BACKEND_URL` = prod https backend `/api/v1`,
  `NEXTAUTH_URL` = prod https site, fresh `NEXTAUTH_SECRET`, rotated Google creds,
  `NEXT_PUBLIC_USE_LOCAL_MOCKS` unset/false. (Mock fallback is already disabled when
  `isProductionRuntime()` in `lib/backendClient.ts`, but confirm at build.)
- **Accept:** backend boots cleanly with `APP_ENV=production`; no mock data appears on the deploy.

### P0.5 Media persistence
Avatars/banners are written to the local filesystem and served via `StaticFiles`
(`backend/app/main.py`, `backend/app/services/profile_service.py` `upload_my_avatar`/`upload_my_banner`).
On serverless or multi-instance hosting these vanish on redeploy / aren't shared.
- Either switch uploads to S3-compatible object storage, or commit to a single instance with a
  persistent volume at `MEDIA_ROOT`.
- **Accept:** upload an avatar + banner, redeploy, and they still render.

### P0.6 HTTPS end-to-end
Serve frontend and backend over TLS so NextAuth issues secure cookies and bearer tokens aren't
sent in clear. **Accept:** site loads over https; auth cookies are `Secure`.

---

## P1 — Strongly recommended before real users

### P1.1 Session longevity / token refresh
Access token TTL is 60 min with **no app-level refresh** for credentials users, so people hit
"session expired" on apply/save roughly hourly (the UI already degrades gracefully to a re-login
prompt). Either raise `JWT_ACCESS_TOKEN_EXPIRES_MINUTES` to a sane window (e.g. 7–14 days) or add
refresh-token rotation + a NextAuth refresh callback.
Files: `backend/app/services/auth_service.py`, `backend/app/core/security.py`, `lib/auth.ts`.

### P1.2 Frontend deploy + CI
No Vercel/CI config today. Add host config and a CI pipeline that runs `npx tsc --noEmit`,
`npm run lint`, `npm run build`, `npx playwright test`, and backend `pytest` on PRs.

### P1.3 Observability
Add error tracking (e.g. Sentry) on frontend + backend; use `/api/v1/health` as the platform
healthcheck; ship structured logs to an aggregator.

### P1.4 Decide the messaging story
In-app messaging has no backend (the reply composer is hidden in live mode) and there's no
withdraw endpoint for applications/interests. For a free beta this is acceptable **only if honest**;
recruiters↔talent can't converse in-app. Decide: ship with status-actions + external contact, or
build minimal threaded messaging. (Reviews are summary-only too — fine for beta.)

### P1.5 Legal + account deletion
`/privacy`, `/terms`, `/support` are placeholders. Add real policies and a user-initiated
account/data-deletion path (India DPDP / general compliance).

### P1.6 Backups + runbook
Automated Postgres + media backups; document restore steps.

---

## P2 — Post-launch
Payments/entitlements (when monetizing — there's a `free_launch` entitlement scaffold today),
real channel/representation verification beyond pending/manual, job view-count + response-rate
computation (currently hidden when zero, which is honest), full-text search as volume grows,
notification email digests, full accessibility + LCP performance audit.

---

## Verification (run before declaring "live")
1. **Config gate:** boot the backend with a prod-like env (`APP_ENV=production`); confirm
   `validate_production_settings` passes (it raises on any unsafe value).
2. **Migrations:** `alembic upgrade head` against a fresh Postgres; confirm all tables incl. `banner_url`.
3. **Email:** sign up on staging; confirm the verification email arrives and login works.
4. **Secrets:** rotated creds work; `git ls-files | grep -i env` shows only `*.example`.
5. **End-to-end on staging:** run `node scripts/qa-workflow-sim.mjs` and `node scripts/qa-prodready-sim.mjs`
   pointed at the deployed URLs; run `npx playwright test` + backend `pytest`. Manually smoke a
   two-account journey (recruiter posts a job → talent applies → recruiter hires) on the live deploy.

## Reference: existing test/QA assets
- `scripts/qa-workflow-sim.mjs` — full recruiter+talent UI journey (profile → post → apply → hire).
- `scripts/qa-prodready-sim.mjs` — logged-out gating, save/unsave, search, notifications, mobile overflow.
- `tests/e2e/*.spec.ts` — Playwright suite (run with `npm run test:e2e`).
- Backend tests: `cd backend && pytest` (jobs, marketplace, profile, auth).
- Local full stack: `npm run dev:all` (frontend :3000 + backend :8000), `npm run seed` once.
