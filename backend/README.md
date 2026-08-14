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
- `JWT_SECRET`
- `JWT_ACCESS_TOKEN_EXPIRES_MINUTES` (production maximum: 60)
- `JWT_REFRESH_TOKEN_EXPIRES_MINUTES`
- `AUTH_SESSION_MODE` (`migration` only for the bounded legacy-token rollout;
  `persistent` for steady-state production)
- `ALLOW_LEGACY_REFRESH_COMPATIBILITY_IN_PRODUCTION` (temporary acknowledgement
  required only while `AUTH_SESSION_MODE=migration`)
- `REFRESH_REUSE_GRACE_SECONDS` (0–30 seconds; duplicate refreshes are rejected,
  and reuse after this race window revokes the complete session family)
- `OAUTH_CREDENTIAL_KEYS` + `OAUTH_CREDENTIAL_ACTIVE_KEY_ID` (server-only
  AES-256-GCM keyring for Google access/refresh credentials)
- `OAUTH_CREDENTIAL_WRITE_MODE` (`dual` only during the recoverable migration;
  `encrypted_only` for production steady state)
- `YOUTUBE_API_KEY` (server-side YouTube Data API v3 key for portfolio metadata import)
- `OPENAI_API_KEY` (server-side only; required only for private text job-import processing)
- `OPENAI_MODEL` (defaults to `gpt-5.6-luna`; clients cannot override it)
- `OPENAI_REQUEST_TIMEOUT_SECONDS` (server-only, bounded to 5–120 seconds;
  defaults to 60 seconds for synchronous URL extraction)
- `OPENAI_MAX_RETRIES`
- `JOB_IMPORT_PROMPT_VERSION`

Private normalized-text import processing is available to an authenticated draft
owner at `POST /api/v1/job-imports/drafts/{draft_id}/process`. The request body
must be `{}`; provider, model, and audit metadata are server-owned. Processing
supports pasted text, rough descriptions, externally sourced listing text, and
securely normalized public job URLs. Successful extraction remains private and stops at recruiter review—it
does not create or publish a native job.

## Local Development (uv)
Install dependencies:
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
- `POST /me/oauth/google/upsert`
- `POST /me/youtube/refresh`
- `GET /me/youtube/channels`
- `POST /dev/seed/jobs` (development only, idempotent)

## Auth + Channel Verification (MVP)
- Register with `POST /auth/register` (development logs verification URL to backend logs).
  - `username` is required and becomes public profile URL `/u/{username}`.
- Verify email with `POST /auth/verify-email`.
- Resend verification link with `POST /auth/resend-verification` (always returns generic success).
- Login with `POST /auth/login` to obtain bearer token.
- Link Google OAuth credentials to the current user with `POST /me/oauth/google/upsert`.
- Refresh and persist linked YouTube channels with `POST /me/youtube/refresh`.
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
