# CreatorJobs Backend (FastAPI)

Standalone, production-oriented backend service for CreatorJobs.

## Stack
- FastAPI
- SQLAlchemy 2.0 (async engine)
- Alembic migrations
- PostgreSQL (primary runtime DB)
- Pydantic v2
- Pytest + HTTPX
- Docker + docker-compose

## Project Structure
- `app/main.py`: FastAPI app/bootstrap
- `app/core/`: config, logging, security, error handling
- `app/db/`: base + async session
- `app/models/`: SQLAlchemy models
- `app/schemas/`: Pydantic schemas
- `app/repositories/`: persistence layer
- `app/services/`: business logic
- `app/api/v1/routers/`: versioned API routers
- `app/health/`: health checks
- `alembic/`: DB migrations
- `tests/`: pytest tests

## Environment
1. Copy env file:
```bash
cp .env.example .env
```
2. Edit variables as needed.

Key vars:
- `APP_ENV`
- `EMAIL_MODE`
- `DATABASE_URL`
- `CORS_ORIGINS`
- `LOG_LEVEL`
- `MAX_CONCURRENT_HTTP_REQUESTS` (required explicit per-worker capacity in production;
  omitted outside production uses 100 for the existing local concurrency harness,
  not a production sizing recommendation)
- `JWT_SECRET`
- `JWT_ACCESS_TOKEN_EXPIRES_MINUTES` (production maximum: 60)
- `JWT_REFRESH_TOKEN_EXPIRES_MINUTES`
- `AUTH_SESSION_MODE` (`migration` only for the bounded legacy-token rollout;
  `persistent` for steady-state production)
- `ALLOW_LEGACY_REFRESH_COMPATIBILITY_IN_PRODUCTION` (temporary acknowledgement
  required only while `AUTH_SESSION_MODE=migration`)
- `REFRESH_REUSE_GRACE_SECONDS` (0–30 seconds; duplicate refreshes are rejected,
  and reuse after this race window revokes the complete session family)
- `ADMIN_STRONG_AUTH_REQUIRED` (must be `true` in production; ADMIN access then
  requires fresh database-backed second-factor assurance on its durable session)
- `ADMIN_STRONG_AUTH_MAX_AGE_MINUTES` (5–60 minute upper bound even if stored
  assurance metadata claims a later expiry)
- `STRONG_AUTH_SECRET_KEYS` + `STRONG_AUTH_SECRET_ACTIVE_KEY_ID` (dedicated,
  rotation-ready AES-256-GCM keyring for TOTP secrets; required in production
  and intentionally separate from OAuth credential encryption)
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (server-owned Google identity
  verification and YouTube refresh client; both are required in production)
- `GOOGLE_OAUTH_EXCHANGE_SECRET` (random 32+ character server-to-server secret
  shared with NextAuth; required before feature-scoped Google credentials are accepted)
- `OAUTH_CREDENTIAL_KEYS` + `OAUTH_CREDENTIAL_ACTIVE_KEY_ID` (server-only
  AES-256-GCM keyring for Google access/refresh credentials)
- `OAUTH_CREDENTIAL_WRITE_MODE` (`dual` only during the recoverable migration;
  `encrypted_only` for production steady state)
- `YOUTUBE_API_KEY` (preferred server-side YouTube Data API v3 key for authenticated
  channel enrichment and portfolio metadata import; `YOUTUBE_DATA_API_KEY` is a
  backward-compatible backend-only alias)
- `OPENAI_API_KEY` (server-side only; required only for private text job-import processing)
- `OPENAI_MODEL` (defaults to `gpt-5.6-luna`; clients cannot override it)
- `OPENAI_REQUEST_TIMEOUT_SECONDS` (server-only, bounded to 5–120 seconds;
  defaults to 60 seconds for synchronous URL extraction)
- `OPENAI_MAX_RETRIES`
- `JOB_IMPORT_PROMPT_VERSION`

HTTP admission rejects excess concurrent work immediately with a privacy-safe
`503 server_busy`, `Retry-After: 1`, `Cache-Control: no-store` and request correlation.
Rejected requests never enter body parsing, authentication, DB checkout or provider
work; there is no waiting queue. A slot remains owned through response transmission
and application cancellation cleanup. This per-worker resource ceiling supplements,
but never replaces, Redis account quotas. Size it against process count, memory,
database pool and upstream connection limits. Only exact `GET /api/v1/health` has
one separately bounded liveness slot; readiness and feature probes use ordinary
capacity. WebSocket/lifespan scopes retain their existing lifecycle. This does not
impose a blanket transaction deadline or claim a timed-out mutation was rolled back;
ingress connection/slow-client protection and full request deadlines remain separate.

Private normalized-text import processing is available to an authenticated draft
owner at `POST /api/v1/job-imports/drafts/{draft_id}/process`. The request body
must be `{}`; provider, model, and audit metadata are server-owned. Processing
supports pasted text, rough descriptions, externally sourced listing text, and
securely normalized public job URLs. Successful extraction remains private and stops at recruiter review—it
does not create or publish a native job.

Public job, brand-page, and portfolio-preview retrieval use the shared
`app.services.safe_outbound_fetch.SafeOutboundFetcher`. It accepts only HTTP(S)
on ports 80/443, rejects non-public IPv4/IPv6 and embedded transition addresses,
pins each TCP connection to the DNS answer that passed validation, verifies the
connected peer, starts a fresh pool for every revalidated redirect, ignores
environment proxies, sends no cookies or credentials, and enforces total,
operation, content-type, redirect, and decoded-body limits. The
`allow_test_loopback` constructor seam is for disposable local fixtures only and
must never be enabled by production configuration. Other user-influenced
fetchers are tracked in `docs/PRODUCTION_READINESS_OUTBOUND_FETCH.md` until they
are migrated to the same boundary.

Portfolio HTML previews accept only bounded HTML/plain-text responses. YouTube
and Vimeo oEmbed calls additionally require an exact built-in provider endpoint,
refuse redirects, accept only JSON, and cap decoded responses at 64 KiB. Preview
network/provider failures retain the existing manual-entry path; unsafe URLs are
rejected before a request is made.

## Dependency contract

`pyproject.toml` declares what this service depends on. `uv.lock` records the
one resolution that was actually reviewed, tested, and shipped. Both are
committed, and the production image installs from the lock — not from the
ranges — so a build today and a build next month install the same versions.

**To change a production dependency:**

```bash
cd backend
# 1. edit the version constraint in pyproject.toml, then:
uv lock --upgrade-package <name>   # relock just that package, not everything
uv lock --check                    # must pass: lock agrees with the manifest
uv sync --all-groups               # bring your local environment in line
APP_ENV=test uv run pytest         # then validate
```

Never edit `uv.lock` by hand, and never add a `requirements.txt` — a second
dependency artifact means two answers to the same question.

The production image (`Dockerfile`) installs with `uv sync --locked --no-dev`:
`--locked` makes a manifest edited without relocking a build failure rather than
a silent re-resolution, and `--no-dev` keeps pytest and ruff out of the runtime
image. `UV_NO_SYNC=1` is set so the entrypoint's `uv run` uses the environment
baked at build time instead of reaching for the network while starting.

`tests/test_packaging_contract.py` asserts these properties. It reads the
Dockerfile rather than building it, so it proves the instructions are right, not
that the build succeeds — building needs a Docker daemon.

## Local Development (uv)
Install dependencies (the dev group is wanted locally; it is excluded from the
production image):
```bash
uv sync --all-groups
```

Run migrations:
```bash
uv run alembic upgrade head
```

Audit or rotate stored OAuth credentials after migration 0055 (dry-run by
default; output contains counts and key IDs, never credentials):

```bash
.venv/bin/python -m scripts.rotate_oauth_credentials
.venv/bin/python -m scripts.rotate_oauth_credentials --apply --confirm development
```

The safe production rollout is: deploy the additive migration and `dual` mode
with the temporary compatibility acknowledgement, run and verify the backfill,
then deploy `encrypted_only` and rerun the command to clear plaintext. Keep all
old decryption keys until a final dry-run reports zero rows needing rewrap.

Run dev server:
```bash
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Docs:
- Swagger: `http://localhost:8000/api/v1/docs`
- OpenAPI: `http://localhost:8000/api/v1/openapi.json`

## Docker Development
From `backend/`:
```bash
docker compose up --build
```

Apply migrations inside container:
```bash
docker compose exec backend uv run alembic upgrade head
```

Seed sample jobs (development only):
```bash
curl -X POST http://localhost:8000/api/v1/dev/seed/jobs
```

The seed endpoint is idempotent and only works when `APP_ENV=development`.
With the backend running, `npm run seed:demo-jobs` validates and upserts the
shared 24-job CreatorJobs demo portfolio. The JSON response reports created,
updated, unchanged, and safely skipped seed-owned records; user-created jobs are
never deleted or rewritten.

## Tests
Tests use SQLite (`aiosqlite`) for fast isolated execution.

Run tests:
```bash
uv run pytest
```

## Lint / Format
Lint:
```bash
uv run ruff check .
```

Format:
```bash
uv run ruff format .
```

## Migration Commands
Generate migration:
```bash
uv run alembic revision --autogenerate -m "describe_change"
```

Apply migration:
```bash
uv run alembic upgrade head
```

Migration safety note:
- `0003_profile_username` upgrades `alembic_version.version_num` to `VARCHAR(64)` on PostgreSQL to avoid revision-id length issues.

Rollback one step:
```bash
uv run alembic downgrade -1
```

## API Endpoints
Base prefix: `/api/v1`

- `GET /health`
- `GET /health/db`
- `GET /jobs`
- `GET /jobs/{id}`
- `POST /jobs`
- `PATCH /jobs/{id}`
- `DELETE /jobs/{id}` (soft delete: archives + sets `deleted_at`)
- `POST /auth/register`
- `POST /auth/verify-email`
- `POST /auth/resend-verification`
- `POST /auth/login`
- `POST /auth/oauth/google`
- `GET /me`
- `GET /me/profile`
- `PATCH /me/profile`
- `PATCH /me/privacy`
- `GET /me/portfolio`
- `POST /me/portfolio`
- `PATCH /me/portfolio/{id}`
- `DELETE /me/portfolio/{id}`
- `POST /portfolio/youtube/preview`
- `POST /portfolio/items`
- `GET /portfolio/items?user_id=me`
- `GET /portfolio/items?user_id={user_id}`
- `PATCH /portfolio/items/{id}`
- `DELETE /portfolio/items/{id}`
- `GET /portfolio/{user_id}`
- `GET /users/{username}/public-profile`
- `POST /me/youtube/refresh`
- `POST /me/youtube/disconnect`
- `GET /me/youtube/channels`
- `POST /dev/seed/jobs` (development only, idempotent)

## Auth + Channel Verification (MVP)
- Register with `POST /auth/register` (development logs verification URL to backend logs).
  - `username` is required and becomes public profile URL `/u/{username}`.
- Verify email with `POST /auth/verify-email`.
- Resend verification link with `POST /auth/resend-verification` (always returns generic success).
- Login with `POST /auth/login` to obtain bearer token.
- Ordinary Google sign-in requests identity scopes only. Grant YouTube read
  access through the verified `POST /auth/oauth/google` server exchange; it
  requires a signed Google ID token bound to the access token and the internal
  exchange header before credentials are stored.
- Refresh and persist linked YouTube channels with `POST /me/youtube/refresh`;
  expired grants refresh server-side and temporary provider failures retain the
  last known authorization.
- Revoke and locally clear all YouTube authority with
  `POST /me/youtube/disconnect`; the stable Google identity binding remains.
- Read persisted linked channels with `GET /me/youtube/channels`.
- Manage profile/privacy with `GET/PATCH /me/profile` and `PATCH /me/privacy`.
- Manage portfolio items with `/me/portfolio` CRUD endpoints.
- Public profile (privacy-applied, read-only) is available at `GET /users/{username}/public-profile`.

When creating YouTube jobs (`platforms` contains `youtube` or `posted_platform=youtube`):
- `posted_youtube_channel_id` is required.
- Caller must be authenticated.
- Channel must already be linked to the authenticated user via `user_youtube_channels`.

Resend verification testing:
- Call `POST /api/v1/auth/resend-verification` with `{ "email": "you@example.com" }`.
- For unverified accounts in local/dev, backend prints a plain line in container logs:
  `[auth] Email verification link: http://localhost:3000/auth/verify?token=...`
