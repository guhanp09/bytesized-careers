# CreatorJobs

CreatorJobs is a creator-economy hiring marketplace: content creators and channels post
**jobs**, freelance talent publish **talent listings**, and both sides browse, apply / express
interest, manage those in a shared inbox, and get in-app notifications. It runs as a
[Next.js](https://nextjs.org) frontend (App Router) with a standalone [FastAPI](https://fastapi.tiangolo.com)
backend.

> **Status:** free, pre-launch beta. No payments, and notification email delivery is mocked to an
> outbox until a production domain + provider exist. See [docs/](#documentation) for readiness notes.

## Quickstart

```bash
# 1. Install frontend deps
npm install

# 2. Set up env (frontend). Copy the template and fill in values.
cp .env.example .env.local

# 3. Set up the backend (FastAPI, managed with uv). See backend/README.md for details.
#    The dev scripts expect a virtualenv at backend/.venv.

# 4. Run frontend + backend together (frontend :3000, backend :8000)
npm run dev:all

# 5. Seed demo marketplace data (jobs + talent listings) — backend must be running
npm run seed
```

Open [http://localhost:3000](http://localhost:3000).

Frontend-only mode: run `npm run dev` and set `NEXT_PUBLIC_USE_LOCAL_MOCKS=true`. Otherwise
backend-backed pages fall back to local sample data when the FastAPI service is not running (in
non-production only).

## Project layout

| Path | What lives there |
| --- | --- |
| `app/` | Next.js App Router routes (pages, layouts, route handlers, loading/error boundaries) |
| `components/` | UI components (marketplace, job/talent details, post flows, `/you` hub, inbox) |
| `lib/` | Frontend data access (`backendClient.ts`), drafts, opening-message, mock data, helpers |
| `backend/` | FastAPI service: routers, models, schemas, services, Alembic migrations, pytest suite |
| `tests/` | Playwright e2e (`tests/e2e/`) + Node unit tests (`tests/*.test.mjs`) |
| `docs/` | Readiness audits, notifications architecture, roadmap, IA reference |

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev:all` | Run frontend (:3000) and backend (:8000) together |
| `npm run dev` | Frontend only |
| `npm run dev:backend` | Backend only (uvicorn, reload) |
| `npm run seed` | Seed demo marketplace data via the dev-only seed endpoint |
| `npm run build` | Production build of the frontend |
| `npm run lint` | ESLint |
| `npm run test:e2e` | Playwright end-to-end suite |

## Testing

```bash
# Type-check the frontend
npx tsc --noEmit

# Frontend e2e (Playwright)
npm run test:e2e

# Frontend unit tests (Node's built-in runner; imports lib/*.ts directly)
# Scope to *.test.mjs so the runner doesn't try to execute the Playwright e2e specs.
node --test 'tests/*.test.mjs'

# Backend tests — APP_ENV=test is required, or ~30 tests fail on the auth rate limiter
cd backend && APP_ENV=test .venv/bin/python -m pytest
```

## Documentation

- [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) — what's needed to admit live users (infra, secrets, email).
- [docs/BETA_LAUNCH_READINESS.md](docs/BETA_LAUNCH_READINESS.md) — beta data, copy rules, safety, and manual QA checklist.
- [docs/PHASE_4A_LAUNCH_READINESS_AUDIT.md](docs/PHASE_4A_LAUNCH_READINESS_AUDIT.md) — env var + migration checklist.
- [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md) — the in-app notification pipeline + mocked email outbox.
- [docs/POST_BETA_ROADMAP.md](docs/POST_BETA_ROADMAP.md) — intentionally deferred, post-beta work.
- [docs/CREATORJOBS_INFORMATION_ARCHITECTURE.md](docs/CREATORJOBS_INFORMATION_ARCHITECTURE.md) — routes and IA.
- [backend/README.md](backend/README.md) — backend setup (uv), migrations, and run instructions.

## Local OAuth Setup

Use `.env.example` as your template, and ensure this value matches your frontend dev server port:

```bash
NEXTAUTH_URL=http://localhost:3000
```

If `NEXTAUTH_URL` points to a different port (for example `3001`) while the app runs on `3000`, Google/NextAuth redirects can behave incorrectly.

In Google Cloud Console (OAuth 2.0 Client ID for Web application), add:

- Authorized JavaScript origins: `http://localhost:3000`
- Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google`

If you sometimes run on another local port, add that too (for example `http://localhost:3001` and `http://localhost:3001/api/auth/callback/google`).

## Location Autocomplete Setup

The `/you` profile basics editor works locally without an API key using built-in city suggestions. For broader production coverage, add a Google Places key later. The key is server-only and must not use a `NEXT_PUBLIC_` prefix.

1. Create an API key in Google Cloud Console.
2. Enable the Google Places API for that project.
3. Paste the key into `.env.local` at the project root:

```bash
GOOGLE_PLACES_API_KEY=your_key_here
```

4. Restart the dev server after changing `.env.local`.
5. Do not commit `.env.local`; it is ignored by git.
6. Restrict the key in Google Cloud before production.

Without this key, local autocomplete still works from the built-in dataset. Adding `GOOGLE_PLACES_API_KEY` later switches the server-side autocomplete route to Google Places.

## Backend Data Source Flags

Frontend job data source is switchable via env flags:

```bash
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000/api/v1
NEXT_PUBLIC_USE_LOCAL_MOCKS=false
```

Defaults:
- `NEXT_PUBLIC_BACKEND_URL` defaults to `http://localhost:8000/api/v1` if unset.
- `NEXT_PUBLIC_USE_LOCAL_MOCKS=false` (or unset) means backend is the default source of truth.
- Set `NEXT_PUBLIC_USE_LOCAL_MOCKS=true` only when you explicitly want local mock/SQLite fallback.

## Auth Integration Notes

Frontend auth uses:
- NextAuth Google OAuth (`signIn("google")`)
- NextAuth Credentials provider (`signIn("credentials")`) backed by FastAPI `/api/v1/auth/login`

Required frontend env vars:

```bash
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=change-me-please
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000/api/v1
NEXT_PUBLIC_USE_LOCAL_MOCKS=false
```

Email/password registration + verification endpoints are provided by the backend:
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/verify-email`

During beta, notification email delivery is disabled (`EMAIL_DELIVERY_ENABLED=false`): notification
emails are queued to an outbox and viewable via the dev inbox at `/dev/emails`. Auth emails (verify,
reset) follow `EMAIL_MODE` (default `log`). Portfolio YouTube import uses the backend-only
`YOUTUBE_API_KEY` variable — do not expose it with a `NEXT_PUBLIC_` prefix.
