# Local Backend And Auth Testing

Use this flow when testing local backend storage, signup, email verification, login, and password reset.

1. Start the backend with local email logging enabled:

   ```bash
   cd backend
   DATABASE_URL=sqlite+aiosqlite:///./.local-data/creatorjobs_backend.db DEBUG=false APP_ENV=development EMAIL_MODE=log ./.local-venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```

   For local browser calls, use:

   ```bash
   NEXT_PUBLIC_BACKEND_URL=http://localhost:8000/api/v1
   NEXT_PUBLIC_USE_LOCAL_MOCKS=false
   ```

2. Start the frontend:

   ```bash
   npm run dev
   ```

3. Check health endpoints:

   - Frontend: `http://localhost:3000/api/health`
   - Backend: `http://localhost:8000/api/v1/health`
   - Backend DB: `http://localhost:8000/api/v1/health/db`

   If port 8000 accepts connections but health checks hang, stop the stale backend and restart it:

   ```bash
   lsof -nP -iTCP:8000 -sTCP:LISTEN
   kill <pid>
   ```

   If you are using Alembic-managed local data, apply migrations before starting:

   ```bash
   cd backend
   ./.local-venv/bin/alembic upgrade head
   ```

4. Open `/auth` and sign up with a fresh email address.
5. Open `/dev/emails`.
6. Click `Open verification link`.
7. Return to `/auth` and log in with the same email and password.
8. Open `/you` and confirm the backend-storage-offline warning is not shown.
9. Test password reset from `/auth/reset`, then open `/dev/emails` and click `Open reset link`.

`/dev/emails` is development-only. Production must use real SMTP and must not expose verification or password-reset links.

Old local SQLite databases are repaired on backend startup in development. Production and staging databases must use Alembic migrations.
