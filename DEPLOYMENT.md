# CreatorJobs Deployment Guide

This guide is for four different modes:

- **Local development:** runs on your laptop with local env files.
- **Mock preview:** Vercel-only UI review using mock data.
- **Hosted investor staging:** real hosted frontend, backend, database, Google sign-in, and seeded demo data.
- **Future production:** not covered as an implementation target yet.

The investor staging setup is meant to feel real enough for demos while keeping cost and operational risk low. It is not a customer-production launch.

## 1. GitHub Repo

Push the current repo to GitHub before connecting hosting providers.

Do not commit:

- `.env`
- `.env.local`
- real database URLs
- OAuth secrets
- JWT/NextAuth secrets
- API keys

The existing `.vercelignore` is for frontend deployments. It intentionally excludes backend files from Vercel because the backend runs separately on Render.

## 2. Neon Free Postgres

1. Create a Neon project.
2. Create or use the default database.
3. Copy the Postgres connection string.
4. Use an async SQLAlchemy URL in Render:

```text
postgresql+asyncpg://USER:PASSWORD@HOST/DBNAME
```

If Neon provides SSL parameters, preserve the provider-recommended SSL form and verify it by running the migration command below.

Do not run destructive downgrade/reset commands on staging.

## 3. Render Backend

Create a Render web service from the GitHub repo.

Use these exact settings:

- **Root Directory:** `backend`
- **Runtime:** Docker
- **Dockerfile Path:** `Dockerfile`
- **Docker Context Directory:** `.`
- **Docker Command:** leave blank unless you intentionally override the Dockerfile command
- **Health Check Path:** `/api/v1/health`

The Dockerfile starts the Render-safe startup script:

```dockerfile
CMD ["sh", "scripts/start_render.sh"]
```

The script starts Uvicorn with Render's `PORT`; local Docker falls back to `8000`.

### Render Environment Variables

Set these in Render:

```env
APP_ENV=staging
DATABASE_URL=postgresql+asyncpg://USER:PASSWORD@HOST/DBNAME
JWT_SECRET=replace-with-strong-random-value
FRONTEND_BASE_URL=https://your-vercel-url
CORS_ORIGINS=["https://your-vercel-url"]
EMAIL_MODE=log
EMAIL_DELIVERY_ENABLED=false
RATE_LIMIT_BACKEND=memory
RUN_DB_MIGRATIONS=true
RUN_STAGING_SEED=true
```

`CORS_ORIGINS` may be a JSON array or comma-separated string. Use the JSON array form above for staging.

### Render Free: Migrations And Staging Seed Without Shell Access

Render Free does not provide an interactive Shell. Instead of manually running
migrations and the demo seed after deploy, the Docker container can run them
before FastAPI starts.

For the first staging deployment, add these two environment variables in the
Render dashboard:

```env
RUN_DB_MIGRATIONS=true
RUN_STAGING_SEED=true
```

Then click **Manual Deploy** and select **Deploy latest commit**. The service
will run Alembic, add deterministic investor demo data, and then start the API.
The startup logs print the environment and whether migrations and seeding are
enabled, but never print secrets.

`RUN_STAGING_SEED=true` is only accepted for `APP_ENV=staging`,
`development`, or `test`. It is explicitly refused for `APP_ENV=production`.
It never performs a destructive reset.

Use this automatic startup flow for the single-service investor staging
prototype only. Do not adopt automatic seed-on-start behavior for future
customer production; that environment needs a controlled migration process.

After the first successful seed, you can change this in Render:

```env
RUN_STAGING_SEED=false
```

That skips the idempotent demo-seed check on future deploys. Leave
`RUN_DB_MIGRATIONS=true` while preparing staging so new schema migrations are
applied automatically on future deploys.

After the service becomes healthy, open:

```text
https://skizh-api.onrender.com/api/v1/health
https://skizh-api.onrender.com/api/v1/health/db
```

Both should return `{"status":"ok"}`. Replace `skizh-api` if Render gives
your service a different public hostname.

### Backend Migration Outside Render Free

If you are running a local command against Neon instead of using the Render
Free startup flow, run:

```bash
cd backend
APP_ENV=staging DATABASE_URL="postgresql+asyncpg://USER:PASSWORD@HOST/DBNAME" uv run alembic upgrade head
```

### Backend Health Checks

After deploy, migrations, and optional seeding:

```text
https://your-render-api/api/v1/health
https://your-render-api/api/v1/health/db
```

Both should return `{"status":"ok"}`.

## 4. Media And Uploads

Default cheapest investor mode uses seeded external/demo image URLs.

Without persistent storage, user-uploaded avatars and banners may not survive Render redeploys or instance replacement. This is acceptable for the cheapest investor prototype if uploads are not the core demo.

Optional upgrade if persistent uploads matter:

1. Add a Render Disk.
2. Mount it at `/var/data`.
3. Add:

```env
MEDIA_ROOT=/var/data/media
MEDIA_BASE_PATH=/media
```

This is still not full production media storage. Future production should use object storage.

## 5. Vercel Frontend

Create a Vercel project from the GitHub repo.

Use these exact settings:

- **Root Directory:** repo root
- **Install Command:** Vercel default
- **Build Command:** `npm run build`
- **Output:** Next.js default

### Vercel Environment Variables

Set these in Vercel:

```env
APP_ENV=staging
NEXT_PUBLIC_APP_ENV=staging
NEXTAUTH_URL=https://your-vercel-url
NEXT_PUBLIC_SITE_URL=https://your-vercel-url
NEXT_PUBLIC_BACKEND_URL=https://your-render-api/api/v1
BACKEND_URL=https://your-render-api/api/v1
NEXTAUTH_SECRET=replace-with-strong-random-value
GOOGLE_CLIENT_ID=replace-me
GOOGLE_CLIENT_SECRET=replace-me
NEXT_PUBLIC_USE_LOCAL_MOCKS=false
NEXT_PUBLIC_ENABLE_DEV_DATA_SWITCH=false
NEXT_PUBLIC_ENABLE_EMAIL_AUTH=false
```

For investor staging, do not set `NEXT_PUBLIC_USE_LOCAL_MOCKS=true`.

The internal `DEV · Backend / Mock` switch is hidden in staging unless you explicitly set:

```env
NEXT_PUBLIC_ENABLE_DEV_DATA_SWITCH=true
```

## 6. Google OAuth

Use Google OAuth as the staging sign-in path.

In Google Cloud Console, configure:

Authorized JavaScript origins:

```text
https://your-vercel-url
http://localhost:3000
```

Authorized redirect URIs:

```text
https://your-vercel-url/api/auth/callback/google
http://localhost:3000/api/auth/callback/google
```

If your OAuth consent screen is in testing mode, add investor emails as test users.

Email/password auth is hidden in investor staging with:

```env
NEXT_PUBLIC_ENABLE_EMAIL_AUTH=false
```

The backend email/password endpoints still exist, but `EMAIL_MODE=log` means verification links are logged, not sent to real inboxes.

## 7. Seed Staging Demo Data

For the first Render Free staging deploy, you do not need to run a manual seed
command. With `RUN_STAGING_SEED=true`, the backend startup script performs the
same safe, deterministic seed before the API starts.

Use the command below only when you intentionally need to seed Neon from your
own terminal, such as when preparing the database before connecting Render:

```bash
cd backend
APP_ENV=staging DATABASE_URL="postgresql+asyncpg://USER:PASSWORD@HOST/DBNAME" uv run python scripts/seed_staging_demo.py --confirm staging
```

This script:

- refuses `APP_ENV=production`
- is idempotent by default
- uses seeded jobs, talent listings, portfolios, applications, inbox/pipeline examples, saved items, notifications, reports, and drafts
- does not expose a public staging seed endpoint

Optional reset for staging-owned seed rows only:

```bash
cd backend
APP_ENV=staging DATABASE_URL="postgresql+asyncpg://USER:PASSWORD@HOST/DBNAME" uv run python scripts/seed_staging_demo.py --confirm staging --reset
```

Do not use reset commands on future real production data.

## 8. Investor Smoke Test

Run this checklist after deploy:

- Backend `/api/v1/health` returns ok.
- Backend `/api/v1/health/db` returns ok.
- Homepage loads.
- `/jobs` loads backend jobs.
- `/talent` loads backend talent.
- A job detail page opens.
- A talent detail page opens.
- Google sign-in starts and returns to the app.
- `/you` loads after sign-in.
- `/drafts` loads after sign-in.
- `/applications` loads after sign-in.
- `/settings` loads after sign-in.
- Save/share actions do not crash.
- Post Job draft flow does not crash.
- Post Talent draft flow does not crash.
- No localhost backend URL appears in browser requests.
- `DEV · Backend / Mock` is not visible.
- Email/password login/signup is not visible.
- Seeded images render.

## 9. Mock Preview

Mock preview is still useful for design-only review.

Use mock mode only when intentionally deploying a frontend-only preview:

```env
NEXT_PUBLIC_USE_LOCAL_MOCKS=true
NEXT_PUBLIC_APP_ENV=preview
```

Do not use mock mode for investor staging.

## 10. Future Production Blockers

Before real customer production, CreatorJobs still needs:

- SMTP/email verification delivery
- production Google OAuth verification/consent setup
- production object storage for uploads
- shared rate limiting such as Redis
- backups and restore testing
- monitoring and error tracking
- admin operations
- privacy/legal deletion policy
- production domain hardening
- real customer onboarding controls
