# CreatorJobs Phase 4A Launch Readiness Audit

Date: 2026-06-02

## Verdict

CreatorJobs is close to beta-deployable, but a production launch still depends on real deployment configuration, a migrated production database, SMTP credentials, Redis or an explicitly approved single-instance rate-limit posture, and a manual QA pass against staging.

## Critical Blockers

- Production secrets must be real: `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_SECRET`, backend `JWT_SECRET`, SMTP password, and database credentials cannot use placeholders.
- Production mock fallback must remain disabled with `NEXT_PUBLIC_USE_LOCAL_MOCKS=false`.
- Backend production rate limiting must use `RATE_LIMIT_BACKEND=redis` with `REDIS_URL`, unless a single-instance launch explicitly sets `ALLOW_MEMORY_RATE_LIMIT_IN_PRODUCTION=true`.
- Production SMTP must be configured with `EMAIL_MODE=smtp`.
- Database migrations must be applied in order before real users sign up or post listings.

## High-Priority Blockers

- Verify Google OAuth redirect URIs for the production domain.
- Verify CORS uses only the production frontend origin.
- Verify frontend and backend health checks are wired into deployment monitoring.
- Confirm support email inbox ownership before beta invites.
- Review `/terms` and `/privacy` with counsel before broad launch.

## Medium Launch Risks

- Dynamic remote avatars and thumbnails still use native `img` tags. This is acceptable for beta, but a dedicated remote image policy is needed before scale.
- Payment remains launch-free entitlement mode; there is no real payment provider integration.
- Admin moderation exists, but founder/operator playbooks must be followed manually during beta.
- Some profile/project builder surfaces still contain older implementation structure even where visible copy has been cleaned up.

## Required Frontend Env Vars

- `APP_ENV=production`
- `NEXT_PUBLIC_APP_ENV=production`
- `NEXT_PUBLIC_SITE_URL=https://<production-domain>`
- `NEXTAUTH_URL=https://<production-domain>`
- `NEXTAUTH_SECRET=<strong-secret>`
- `GOOGLE_CLIENT_ID=<google-oauth-client-id>`
- `GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>`
- `NEXT_PUBLIC_BACKEND_URL=https://<backend-domain>/api/v1`
- `BACKEND_URL` or `INTERNAL_BACKEND_URL=https://<backend-domain>/api/v1`
- `NEXT_PUBLIC_USE_LOCAL_MOCKS=false`
- `NEXT_PUBLIC_SUPPORT_EMAIL=<support-inbox>`

## Required Backend Env Vars

- `APP_ENV=production`
- `DEBUG=false`
- `DATABASE_URL=<production-postgres-async-url>`
- `JWT_SECRET=<strong-secret>`
- `FRONTEND_BASE_URL=https://<production-domain>`
- `CORS_ORIGINS=["https://<production-domain>"]`
- `EMAIL_MODE=smtp`
- `SMTP_HOST=<smtp-host>`
- `SMTP_PORT=<smtp-port>`
- `SMTP_USERNAME=<smtp-username>`
- `SMTP_PASSWORD=<smtp-password>`
- `SMTP_FROM_EMAIL=<verified-sender>`
- `RATE_LIMIT_BACKEND=redis`
- `REDIS_URL=<redis-url>`
- `YOUTUBE_API_KEY=<optional-metadata-key>`

## Migration Checklist

- Confirm production database is empty or has a planned migration baseline.
- Run Alembic migrations in order through the latest revision.
- Run backend smoke tests against staging with test-safe accounts.
- Seed staging/demo data only in staging or explicit demo environments.
- Do not run dev seed endpoints in production.
- Confirm rollback/backups are available before beta invites.

## Manual QA Checklist Summary

- Signup, login, email verification, and password reset.
- Profile edit and public profile rendering.
- Browse jobs, open job detail, apply, save, share, report.
- Browse talent, open talent detail, click profile name, invite/contact, save, share, report.
- Post job, save draft, resume draft, publish through launch-free checkout.
- Create talent listing, save draft, resume draft, publish through launch-free checkout.
- Activity, Saved, Search, Notifications, owner controls.
- Mobile checks across home, jobs, talent, detail pages, post flows, auth, and checkout.
- Production env validation failure with unsafe placeholders.

## Recommended Phase 4B Execution

- Tighten production validation for canonical URLs, CORS, debug, and production database host.
- Add frontend health route.
- Add public support, terms, and privacy routes.
- Add public profile metadata and canonical URLs for detail pages.
- Update robots and sitemap for launch-safe discovery.
