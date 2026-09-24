# Local setup and authentication walkthrough

Run the real FastAPI-backed core workflows on a local, disposable SQLite database.
Google, AI, SMTP, and cloud credentials are not required. This local schema setup
is not PostgreSQL migration evidence.

## Install

Use Node.js 24, Python 3.12, and uv. From the repository root:

```bash
npm ci
cp -n .env.example .env.local
npx prisma generate
cd backend
uv sync --locked --all-groups
cp -n .env.example .env
mkdir -p .local-data
```

`cp -n` preserves existing files. For an existing checkout, review configuration
locally; do not print or commit secret values. Fresh templates contain placeholders.

Keep these frontend settings for the walkthrough:

```text
APP_ENV=development
NEXT_PUBLIC_APP_ENV=development
NEXTAUTH_URL=http://localhost:3000
NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8000/api/v1
BACKEND_URL=http://127.0.0.1:8000/api/v1
NEXT_PUBLIC_USE_LOCAL_MOCKS=false
NEXT_PUBLIC_ENABLE_EMAIL_AUTH=true
```

Use independent local signing secrets if sharing the machine; never reuse production
credentials. Google sign-in needs deliberately configured OAuth clients and the
matching server exchange secret. Use email/password for this credential-free demo.

## Start two terminals

Terminal 1, from `backend/`:

```bash
APP_ENV=development \
DATABASE_URL=sqlite+aiosqlite:///./.local-data/creatorjobs_backend.db \
EMAIL_MODE=log EMAIL_DELIVERY_ENABLED=false EMAIL_WORKER_IN_PROCESS=false \
OPENAI_API_KEY= YOUTUBE_API_KEY= YOUTUBE_DATA_API_KEY= GOOGLE_PLACES_API_KEY= \
uv run --no-sync uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

This overrides the template's Docker `postgres` hostname and disables the listed
provider credentials. Development startup creates/updates SQLite and seeds roles.
Do not use this schema-sync approach on staging or production. PostgreSQL/Alembic
instructions are in the [backend guide](../backend/README.md).

Terminal 2, from the repository root:

```bash
npm run dev
```

Open `http://localhost:3000`. Check the backend at
`http://127.0.0.1:8000/api/v1/health`; local API docs are at
`http://127.0.0.1:8000/api/v1/docs`.

If a port is occupied, identify its owner and select matching unused ports; do not
kill someone else's process. NextAuth's URL must match the frontend port, and
backend CORS must include the selected frontend origin.

## Seed and try the product

With the local backend running, from the repository root:

```bash
npm run seed
```

This calls the development-only loopback seed endpoint. The sample data is synthetic,
not customer activity. Do not expose seeded accounts or the development server publicly.

1. Open `/auth` and register a local email/password account.
2. Open `/dev/emails` and follow its verification link. Link capture is immediate
   even with the delivery worker off.
3. Sign in and complete a profile at `/you`.
4. Test `/auth/reset` through the same local inbox.
5. Use separate browser profiles/accounts for recruiter and talent application
   checks; follow the [reviewer walkthrough](REVIEWER_GUIDE.md).

The dev inbox contains local verification/reset links and is unavailable in
production. Disabled production email leaves durable outbox rows queued, not
mock-sent. Real delivery rollout still has open safety gates.

## Tests and shutdown

Use the [validation commands](../README.md#validation). The QA browser configuration
owns its own disposable database/personas; do not point it at your development or
hosted data. Leave paid live-provider tests off unless explicitly authorized.

Stop your two processes with Ctrl-C. Local data remains for the next session.
Nothing here deploys code or modifies hosted services.
