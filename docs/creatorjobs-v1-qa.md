# CreatorJobs V1 Marketplace Beta QA

## Automated Checks

To run after implementation:

- Frontend typecheck: `npx tsc --noEmit`
- Frontend lint: `npm run lint`
- Frontend build: `npm run build`
- Backend lint: `cd backend && uv run ruff check .`
- Backend tests: `cd backend && uv run pytest`

Latest run:

- `npx tsc --noEmit`: passed.
- `npm run lint`: passed with existing warnings only.
- `npm run build`: passed.
- `cd backend && DEBUG=false .local-venv/bin/pytest`: passed, 39 tests.
- `cd backend && .local-venv/bin/ruff check --select F ...changed backend files...`: passed.
- `cd backend && .local-venv/bin/ruff check .`: not clean because the existing backend tree has broad pre-existing import/style/line-length warnings and a test indentation lint issue outside this V1 pass.
- `uv run ruff check .`: not run because `uv` is not installed in this shell.

## Manual Workflow Checklist

- Home loads and presents Browse jobs, Discover talent, and Post actions.
- `/jobs` loads published jobs and supports keyword, role, platform, and location search.
- `/talent` loads seeded/backend talent listings and supports keyword, role, platform, location, and availability search.
- `POST JOB` opens the posting doorway with Post a job and Create talent listing.
- `/post-job` still publishes through the backend and redirects to `/jobs?posted=1`.
- `/post-talent` can publish a listing or save a draft.
- `/activity` shows applications, applicants, talent interests, and drafts.
- `/saved` shows saved jobs and saved talent with snapshots/fallback detail data.
- `/notifications` shows notifications and can mark read / mark all read.
- `/pricing/checkout` creates a launch-free entitlement with ₹0 due today.
- `/admin/moderation` is blocked for non-admins and renders reports for admins.
- `/you/saved` redirects to `/saved`.
- `/you/applications/*` redirects to `/activity`.
- Public profile remains editorial and does not show Bio or Availability note.
- Review/rating surfaces show the honest zero state `☆☆☆☆☆ 0 reviews` unless a real review system provides verified rating data.
- No fake positive ratings or fake review counts appear in marketplace, profile, project, application, or activity surfaces.
- Future real reviews can replace the zero state only when backed by persisted review data.

## Known Limitations

- Stripe/card collection is intentionally not enabled; the beta flow uses launch-free entitlements.
- Playwright E2E was not added in this pass unless dependencies are installed separately.
- Admin verification actions are minimal; full audit-log UI and advanced moderation queues remain future work.
- Saved snapshots improve saved pages, but historical saves created before the migration may need detail fetch fallback.
