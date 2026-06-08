# CreatorJobs Autopilot Gap Analysis

Audit date: 2026-05-30

## Stack Found

- Frontend: Next.js App Router, React, TypeScript, Tailwind-style utility classes, NextAuth.
- Backend: FastAPI, SQLAlchemy async models, Alembic migrations, Pydantic schemas.
- Data source: FastAPI backend is the production source of truth; frontend local mocks are gated by `NEXT_PUBLIC_USE_LOCAL_MOCKS`.
- Local persistence: backend Docker Compose uses PostgreSQL with a named `postgres_data` volume.

## Critical Gaps Found

- Applications UI existed, but sent/received application pages were mock-data driven.
- Saved jobs existed as UI affordances only; save actions were alert/local-only behavior.
- Header notification UI existed but only showed placeholder copy.
- Creator-side availability/talent marketplace was missing.
- No persisted talent listing, saved talent, talent interest, notification, report, or entitlement models existed.
- Posting monetization had no future-proof checkout/entitlement record; paid actions were not modeled.
- Job detail apply/save/share actions were not wired to persisted backend state.
- Root metadata still used Create Next App defaults.
- Sitemap and robots routes were missing.
- Trust/reporting backend and UI entry points were missing.

## Already Strong Foundations

- Auth, session exchange, protected `/you`, profile editing, public profiles, portfolio projects, hiring identity, and backend job CRUD already existed.
- Profile and portfolio are backend-backed when `NEXT_PUBLIC_USE_LOCAL_MOCKS=false`.
- Bio and availability note have been removed from the active profile UX and should stay removed.
- Public profile visual direction is already dark, minimal, and editorial compared with earlier dashboard-like versions.

## Completed In This Pass

- Added persisted marketplace models and migration for saved jobs, applications, talent listings, saved talent, talent interest, notifications, reports, and launch-free entitlements.
- Added backend routes for job save/apply/application tracking, talent listing CRUD, talent save/interest, notifications, reports, and free launch checkout.
- Replaced mock sent/received applications pages with backend-backed data.
- Replaced saved page redirect with backend-backed saved jobs and saved talent display.
- Wired job detail apply/save/report/share actions to real backend calls.
- Wired job cards to real saved-job persistence for signed-in users.
- Added talent marketplace browse, post availability, and detail/action pages.
- Added launch-free entitlement creation before job and talent listing publish flows.
- Added notification dropdown data, unread count, and mark-all-read action in the header.
- Added `/talent` navigation.
- Added route metadata, robots, sitemap, and basic security response headers.
- Added focused backend tests covering saved jobs, applications, notifications, reports, launch-free checkout, talent listings, saved talent, and talent interest.

## Remaining High-Value Work

- Full admin moderation UI for reviewing reports and hiding/pausing listings.
- Real paid Stripe checkout adapter; current implementation records zero-value launch entitlements.
- Full notification preferences and email delivery.
- Richer applicant pipeline UI beyond persisted status APIs.
- Talent listing owner management dashboard polish.
- Saved search/job alert matching logic.
- Broader Playwright end-to-end coverage.
- CSP hardening after auditing all inline Next.js/runtime needs.
- Production email/password reset/rate limiting hardening beyond existing auth foundations.

## Current Local Quality Gate

- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`
- `DATABASE_URL=sqlite+aiosqlite:///./.local-data/test_marketplace_core.db DEBUG=false .local-venv/bin/python -m pytest tests/test_marketplace_core.py -q`
- `DATABASE_URL=sqlite+aiosqlite:///./.local-data/test_full_backend.db DEBUG=false .local-venv/bin/python -m pytest -q`
