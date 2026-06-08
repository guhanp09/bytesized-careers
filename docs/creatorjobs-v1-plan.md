# CreatorJobs V1 Marketplace Beta Implementation Plan

## Current Audit

- Frontend uses Next.js App Router, React 19, NextAuth, TypeScript, and the existing dark CreatorJobs UI conventions.
- Backend uses FastAPI, async SQLAlchemy, Alembic, Pydantic, and PostgreSQL in Docker with a named volume.
- Backend is the source of truth for users, jobs, profile data, portfolio projects, marketplace saves, applications, talent listings, interests, notifications, reports, and entitlements.
- Legacy local/Prisma job fallback remains development-only behind `NEXT_PUBLIC_USE_LOCAL_MOCKS=true`.
- Profile editing and public profile rendering are backend-backed. Bio and availability note are intentionally absent from active profile UX and payloads.

## Missing Systems Addressed

- Dedicated Jobs browser at `/jobs`.
- Two-sided homepage with Jobs and Talent entry points.
- Talent directory filters and richer talent cards.
- Saved hub for saved jobs and talent.
- Activity hub for applications, applicants, talent interests, and drafts.
- Full notifications center with mark-read behavior.
- Launch-free checkout surface and entitlement creation.
- Admin moderation page backed by persisted reports.
- Additive backend fields for richer jobs, talent listings, saves, notifications, reports, and entitlements.
- Idempotent talent seed data for realistic local marketplace browsing.

## Information Architecture

- `/`: marketplace home with Browse jobs, Discover talent, and Post entry points.
- `/jobs`: jobs browser with URL-backed search/filter form.
- `/jobs/[id]`: existing job detail route preserved.
- `/talent`: talent directory with URL-backed search/filter form.
- `/talent/[id]`: talent detail with save, share, interest, and report actions.
- `/post-job`: existing job posting flow preserved and extended with V1 job fields.
- `/post-talent`: availability posting flow extended with creator-marketplace fields and drafts.
- `/activity`: authenticated hub for applications, applicants, leads, and drafts.
- `/saved`: authenticated hub for saved jobs and saved talent.
- `/notifications`: authenticated notification center.
- `/pricing/checkout`: launch-free checkout confirmation.
- `/admin/moderation`: admin-only report moderation surface.

## Data Model Changes

- Jobs now support work mode, contract type, timezone overlap, weekly hours, application mode, external apply URL, deadline, featured/paused/closed timestamps.
- Talent listings now support primary role, experience level, rate range/currency, open slots, turnaround, and featured/paused/closed timestamps.
- Saved jobs and saved talent listings now store denormalized public snapshots.
- Notifications now support category and action URL.
- Reports now support resolved admin, resolved timestamp, and moderation action.
- Entitlements now support expiration and checkout intent ID.

## Component Changes

- Added shared marketplace primitives:
  - `EmptyState`
  - `PostMenu`
  - `NotificationList`
  - `CheckoutPanel`
  - `AdminModerationClient`
- Header now searches Jobs or Talent and uses a Post menu.
- Sidebar now reflects the V1 marketplace IA: Home, Jobs, Talent, Activity, Saved, You.
- Talent and saved/activity pages use restrained dark cards, subtle borders, and pointer cursors.

## Seed Strategy

- Backend seed data now includes deterministic talent users and 24 talent listings.
- Seed logic is idempotent and inserts missing seed rows only.
- User-created records are not overwritten.
- Development endpoint `/api/v1/dev/seed/marketplace` seeds jobs and talent.

## Testing Strategy

- Backend: run `uv run ruff check .` and `uv run pytest`.
- Frontend: run `npx tsc --noEmit`, `npm run lint`, and `npm run build`.
- Manual QA focuses on home, jobs, talent, post job, post availability, activity, saved, notifications, checkout, moderation, and public profile continuity.

## Execution Order

1. Add backend contracts, fields, migration, admin actions, snapshots, and seed data.
2. Add frontend marketplace IA routes and shared primitives.
3. Wire navigation/header/search/post menu.
4. Extend post availability and job payloads.
5. Add docs and QA notes.
6. Run quality gates and fix regressions.

