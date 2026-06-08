# CreatorJobs Engineering Safety Rules

1. Do not rewrite existing working pages unless required.
2. Do not change visual design patterns without explicit instruction.
3. Do not remove existing routes.
4. Do not change database schema casually.
5. Do not break talent signup, employer signup, job posting, profile, or dashboard flows.
6. Every change must preserve mobile responsiveness.
7. Every new form needs validation, loading state, success state, and error state.
8. Every paid feature must be protected server-side.
9. Payment access must depend on webhook-confirmed payment, not frontend redirect alone.
10. Admin-only features must be protected by admin role.
11. Update this document after every completed task.

# CreatorJobs Launch Readiness Audit

Audit date: 2026-05-15

Scope: initial audit was codebase inspection only. Implementation updates are noted as launch tasks are completed; unrelated workflow changes, refactors, UI changes, and schema changes should remain out of scope unless explicitly requested.

Update 2026-05-30: V1 marketplace beta IA implemented. Added `/jobs`, `/activity`, `/saved`, `/notifications`, launch-free checkout, admin moderation, richer talent browsing/posting fields, saved snapshots, notification action URLs/categories, report admin action fields, entitlement checkout fields, and idempotent talent seed support. Bio and availability note remain removed from active profile UX and profile save payloads.

Latest implementation note, 2026-05-30: A backend-backed marketplace core was added for saved jobs, applications, talent availability listings, saved talent, recruiter interest, in-app notifications, reports, and launch-free entitlements. Frontend routes now include `/talent`, `/talent/[id]`, `/post-talent`, backend-backed saved/application pages, job apply/save/report actions, real notification dropdown data, sitemap/robots metadata, and basic security headers. Payments remain in launch-free entitlement mode; full paid checkout, admin moderation UI, notification preferences, and broader Playwright coverage remain future work.

Status legend: ✅ Done, 🟡 Partially done, ❌ Not done, ⚠️ Broken / risky, 🔒 Blocked

# Recommended Execution Order

1. P0-01 Single profile capabilities and onboarding intent
2. P0-02 Route/API authorization foundation
3. P0-03 Hiring information section inside single user profile
4. P0-04 Apply-readiness completion gate
5. P0-05 Lock down job posting create/update/delete
6. P0-06 Applications model/API
7. P0-07 Talent apply flow
8. P0-08 Employer applicant dashboard with real data
9. P0-09 Basic admin/moderation controls
10. P0-10 Pricing page
11. P0-11 Terms/privacy/refund/cancellation pages
12. P0-12 Payment entitlement model design
13. P0-13 Checkout integration
14. P0-14 Payment webhook handling
15. P0-15 Paid feature gating
16. P0-16 Production auth/email/password reset cleanup
17. P0-17 Environment variable validation
18. P0-18 Deployment readiness

## P0 = Must-Have Before Accepting Paying Customers

### Single profile capabilities and onboarding intent

- Priority: P0
- Status: ✅ Done
- Current evidence from the codebase: CreatorJobs still uses one `users` profile domain for applying, posting, portfolio, roles, skills, social links, linked channels, and posted jobs. `users.onboarding_intent` and `users.onboarding_intent_selected_at` are modeled in `backend/app/models/user.py` with migration `backend/alembic/versions/0011_single_profile_onboarding_intent.py`. Public signup and OAuth onboarding capture only non-restrictive intent values: `LOOKING_FOR_WORK`, `HIRING_CREATOR_TALENT`, `BOTH`, or `DECIDE_LATER`. `/api/v1/me` and `/api/v1/me/profile` expose computed single-profile capability flags through `profile_capabilities`: `canApplyToJobs`, `canPostJobs`, `hasPortfolio`, `hasPublicProfile`, `hasHiringIdentity`, `hasVerifiedSocialOrChannel`, and `isAdmin`. The old `account_type` column remains only for backward compatibility/admin detection; public users are not permanently split into talent/employer roles. Creator skill-role tables remain untouched.
- Missing work: Future P0 authorization tasks still need to apply `profile_capabilities` and `isAdmin` across job posting, applications, dashboards, paid features, and admin routes. Capability thresholds may need tuning when real apply/post flows are implemented.
- Files/routes/components involved: `backend/app/models/user.py`, `backend/alembic/versions/0011_single_profile_onboarding_intent.py`, `backend/app/core/onboarding_intent.py`, `backend/app/core/account_types.py`, `backend/app/schemas/profile_capabilities.py`, `backend/app/api/deps.py`, `backend/app/api/v1/routers/auth.py`, `backend/app/api/v1/routers/me.py`, `backend/app/schemas/auth.py`, `backend/app/schemas/me.py`, `backend/app/schemas/profile.py`, `backend/app/services/auth_service.py`, `backend/app/services/me_service.py`, `backend/app/services/profile_service.py`, `components/AuthPage.tsx`, `components/AccountTypePage.tsx`, `app/auth/onboarding-intent/page.tsx`, `app/auth/account-type/page.tsx`, `lib/backendClient.ts`, `lib/auth.ts`, `types/next-auth.d.ts`, `backend/tests/test_auth_and_channels.py`
- Risk level: Low
- Definition of done: There is still one user profile; new users can choose a non-restrictive initial intent; existing users do not break; frontend can read profile capability flags; backend can later check whether the single profile is complete enough to apply or post; admin cannot be self-selected publicly.
- Suggested next implementation step: Start P0-02 Route/API authorization foundation and apply `profile_capabilities` plus `isAdmin` to sensitive routes without creating separate talent/employer profiles.

### Authorization foundation for single-profile model

- Priority: P0
- Status: ✅ Done
- Current evidence from the codebase: Reusable authorization helpers now exist in `backend/app/api/deps.py`: `require_authenticated_user`, `require_admin`, `require_profile_owner`, `require_job_owner`, `require_application_participant`, `get_profile_capabilities`, `require_profile_can_apply`, and `require_profile_can_post_job`, with camelCase aliases for future callers. These helpers use the single user profile and computed `profile_capabilities`; they do not enforce rigid talent/employer identity rules. Existing `PATCH /api/v1/jobs/{job_id}` and `DELETE /api/v1/jobs/{job_id}` now require an authenticated owner or admin through `require_job_owner`.
- Missing work: Future routes still need to apply these helpers as applications, admin surfaces, paid features, and posting gates are implemented. Payment entitlement checks are intentionally not built yet.
- Files/routes/components involved: `backend/app/api/deps.py`, `backend/app/api/v1/routers/jobs.py`, `backend/app/services/job_service.py`, `backend/tests/test_jobs_crud.py`, `backend/app/services/profile_service.py`, `backend/app/schemas/profile_capabilities.py`
- Risk level: Low
- Definition of done: Users are not locked into talent/employer identities; one profile remains the source of truth; admin helpers exist; ownership checks protect job mutations; profile capability helpers are based on completion; unauthenticated sensitive mutations return 401 and wrong-owner mutations return 403.
- Suggested next implementation step: Use `require_profile_can_post_job` during P0-05 job-posting lockdown and `require_profile_can_apply` during P0-07 apply flow, without adding separate talent/employer permission models.

### Auth/signup/login

- Priority: P0
- Status: 🟡 Partially done
- Current evidence from the codebase: Email/password registration, verification, resend, login, and Google OAuth exchange exist in `backend/app/api/v1/routers/auth.py`, `backend/app/services/auth_service.py`, `lib/auth.ts`, `components/AuthPage.tsx`, and `components/VerifyEmailPage.tsx`. Authenticated `/you` and application pages use `getServerSession`. On 2026-05-15, local smoke checks verified backend register -> verify -> login -> `/me`, and the frontend NextAuth credentials callback/session includes `onboardingIntent`, `onboardingIntentSelectedAt`, and admin-compatible `accountType`. Local signup now shows a direct verification link when the backend intentionally returns one in development.
- Missing work: Production email delivery is not implemented; development verification links still rely on log/email-mode behavior when using generic resend. No password reset flow, account deletion flow, rate limiting, or abuse controls were found.
- Files/routes/components involved: `app/auth/page.tsx`, `app/auth/verify/page.tsx`, `app/api/auth/[...nextauth]/route.ts`, `components/AuthPage.tsx`, `components/VerifyEmailPage.tsx`, `lib/auth.ts`, `backend/app/api/v1/routers/auth.py`, `backend/app/services/auth_service.py`
- Risk level: High
- Definition of done: Users can sign up, verify email through a real email provider, log in, recover passwords, and receive clear production-safe messages. Abuse protections and tests cover happy paths and common failures.
- Suggested next implementation step: Add production email provider integration and replace log-based verification UX with email-sent messaging.

### Apply-readiness onboarding

- Priority: P0
- Status: 🟡 Partially done
- Current evidence from the codebase: Single profile editing, creator skill roles, content style, profile completion, YouTube channel linking, and portfolio CRUD exist in `components/you/YouHubClient.tsx`, `backend/app/api/v1/routers/me.py`, `backend/app/api/v1/routers/user_profile.py`, and `backend/app/api/v1/routers/profile_completion.py`.
- Missing work: No guided first-run onboarding flow beyond initial intent, no required onboarding checkpoint before applying, and no production-ready completion requirements tied to marketplace actions.
- Files/routes/components involved: `app/you/page.tsx`, `components/you/YouHubClient.tsx`, `components/you/ProfileCompletionCard.tsx`, `backend/app/services/profile_service.py`
- Risk level: Medium
- Definition of done: Users complete required profile basics, role selection, content style, and portfolio/proof steps before marketplace actions that require apply-ready profile capability.
- Suggested next implementation step: Define required apply-readiness steps and enforce completion status at API boundaries for paid/customer-facing flows.

### Hiring information section inside single user profile

- Priority: P0
- Status: ✅ Done
- Current evidence from the codebase: Hiring Info remains inside the existing unified `/you` profile; no `EmployerProfile`, recruiter profile, separate employer account, or talent profile was created. Existing fields were preserved and reused for post-readiness where possible: `display_name`, `location`, `public_links`, Instagram fields, linked YouTube channels, and the user-level Hiring Info fields from `backend/alembic/versions/0012_single_profile_hiring_info.py`. A new user-owned `HiringIdentity` model was added in `backend/app/models/hiring_identity.py` with migration `backend/alembic/versions/0013_hiring_identities_and_job_snapshots.py` so the same profile can manage multiple YouTube channels or Instagram pages it hires for. `/api/v1/me/hiring-identities` supports list/create/update, and `/api/v1/me/hiring-identities/{id}/request-verification` supports minimal verification requests. Normal users can create identities and request verification but cannot self-award `VERIFIED`; YouTube can auto-verify only when it matches an already linked channel, while Instagram and unmatched YouTube identities become `PENDING` with a verification code/proof workflow. `components/you/YouHubClient.tsx` now shows a clearer Hiring Info card with channel/page identity management, own-vs-represented selection, verification badges, loading/validation/success/error states, and the required helper copy.
- Missing work: Server-side job creation still needs the broader P0-05 publishing lockdown, payment entitlement checks are intentionally not included, and full admin/manual approval UI for pending/rejected hiring identity verification is not built yet. Instagram OAuth and full agency/team verification remain deferred.
- Files/routes/components involved: `backend/app/models/user.py`, `backend/app/models/hiring_identity.py`, `backend/app/models/job.py`, `backend/alembic/versions/0012_single_profile_hiring_info.py`, `backend/alembic/versions/0013_hiring_identities_and_job_snapshots.py`, `backend/app/schemas/profile.py`, `backend/app/schemas/profile_capabilities.py`, `backend/app/schemas/hiring_identity.py`, `backend/app/schemas/job.py`, `backend/app/api/v1/routers/me.py`, `backend/app/api/v1/routers/jobs.py`, `backend/app/services/profile_service.py`, `backend/app/services/job_service.py`, `backend/app/repositories/auth_repository.py`, `backend/app/repositories/job_repository.py`, `backend/tests/test_profile_features.py`, `backend/tests/test_jobs_crud.py`, `components/you/YouHubClient.tsx`, `components/PostJobPage.tsx`, `components/JobCard.tsx`, `components/job-details/JobHero.tsx`, `lib/backendClient.ts`, `lib/types.ts`
- Risk level: Low
- Definition of done: Users can complete Hiring Info inside the same `/you` profile, add YouTube/Instagram hiring identities, mark each as their own or represented by them/agency, request verification, select an identity on `/post-job`, safely attach that identity to the job, and display “Hiring for,” verification status, and “Managed by” on public job surfaces. Existing profile/work/portfolio/social fields remain intact, `canPostJobs` is computed from single-profile completeness plus at least one hiring identity, and incomplete logged-in users are prompted to complete Hiring Info without creating separate employer identity.
- Manual testing checklist: Sign up or log in, open `/you?tab=overview&section=hiring-info`, save Hiring Info without required fields and see friendly validation, add display name/location/hiring type, add a YouTube channel or Instagram page, confirm `UNVERIFIED` badge, request verification and confirm `PENDING` or linked-YouTube `VERIFIED`, open `/post-job`, confirm “Who are you hiring for?” shows the identity cards, select a represented channel/page, post a job, and confirm public job/card detail shows “Hiring for,” verification badge, and “Managed by” for agency-represented identities.
- Suggested next implementation step: During P0-05, enforce `require_profile_can_post_job` for backend job creation/publishing and add the admin/manual approval surface for pending hiring identity verification before treating verification as operationally complete.

### Job posting

- Priority: P0
- Status: ⚠️ Broken / risky
- Current evidence from the codebase: A polished multi-step post-job flow exists in `components/PostJobPage.tsx` and `components/post-job/PostJobForm.tsx`. Backend create exists at `POST /api/v1/jobs` in `backend/app/api/v1/routers/jobs.py`. `/post-job` pulls user-owned hiring identities when available and shows a “Who are you hiring for?” section before job details, but on 2026-05-22 the frontend Hiring Info/readiness block was removed so users can open the posting flow and publish without first completing Hiring Info. Hiring identity selection is now optional; jobs can still store nullable hiring identity snapshots: `hiring_identity_id`, `hiring_display_name_snapshot`, `hiring_platform_snapshot`, `hiring_verification_status_snapshot`, and `managed_by_agency_name_snapshot`; create/update validates that a supplied `hiring_identity_id` belongs to the current user. Backend YouTube job creation now permits posting without a linked YouTube channel when no hiring identity/channel is supplied, while still validating ownership if a channel or hiring identity is supplied.
- Missing work: No payment gate for paid job posts; Hiring Info is intentionally optional for frictionless posting, so trust/moderation, payment entitlement checks, and abuse controls still need to be solved before paid launch. Backend still allows job creation with optional auth for some paths. Update/delete ownership checks exist from P0-02, but broader job publishing lockdown remains incomplete.
- Files/routes/components involved: `app/post-job/page.tsx`, `components/PostJobPage.tsx`, `components/post-job/PostJobForm.tsx`, `backend/app/api/v1/routers/jobs.py`, `backend/app/services/job_service.py`, `backend/app/models/job.py`
- Risk level: High
- Definition of done: Only authenticated users with a post-ready single profile can publish jobs, paid posts are gated by webhook-confirmed payment/entitlement, and all create/update/delete operations enforce ownership.
- Suggested next implementation step: Add server-side authorization and payment/entitlement checks around job publishing before accepting paid posts.

### Job applications

- Priority: P0
- Status: ❌ Not done
- Current evidence from the codebase: Application pages exist, but `app/you/applications/sent/page.tsx`, `app/you/applications/received/page.tsx`, and `components/you/ReceivedApplicationsClient.tsx` use `lib/mockApplications.ts`. No backend application model or application API route was found.
- Missing work: Application database schema, apply endpoint, duplicate prevention, applicant message/materials, application statuses, ownership checks, and notifications.
- Files/routes/components involved: `app/you/applications/*`, `components/you/ReceivedApplicationsClient.tsx`, `lib/mockApplications.ts`, `backend/app/models/`
- Risk level: High
- Definition of done: Talent can apply to real jobs, employers can receive and manage real applications, and all application data is persisted and permissioned.
- Suggested next implementation step: Add an applications domain model and API design, then wire the existing UI to real data.

### Employer applicant dashboard

- Priority: P0
- Status: ❌ Not done
- Current evidence from the codebase: Received applications UI exists but is mock-data driven through `receivedApplicants` in `lib/mockApplications.ts`.
- Missing work: Employer-owned applicant inbox, per-job candidate lists, application status actions, secure applicant profile access, and real backend data.
- Files/routes/components involved: `app/you/applications/received/page.tsx`, `components/you/ReceivedApplicationsClient.tsx`, `lib/mockApplications.ts`
- Risk level: High
- Definition of done: Employers can view only applicants to jobs they own, filter applicants, update statuses, and open applicant profiles from persisted application records.
- Suggested next implementation step: Build backend received-applications query scoped to current employer-owned jobs.

### Basic admin/moderation controls

- Priority: P0
- Status: ❌ Not done
- Current evidence from the codebase: Admin is represented as the internal-only `ADMIN` account type and public signup/onboarding cannot self-select it. `isAdmin` and `require_admin_user` exist in backend helpers/dependencies, but no admin routes or admin UI were found.
- Missing work: Server-side admin route protection on real admin endpoints, ability to view users, ability to view jobs, ability to hide/remove suspicious jobs, ability to verify/hide talent profiles, and minimal audit notes/logging if feasible with the current backend logging approach.
- Files/routes/components involved: future `app/admin/*`, future `backend/app/api/v1/routers/admin.py`, `backend/app/models/user.py`, `backend/app/api/deps.py`, `backend/app/models/job.py`, `backend/app/services/profile_service.py`
- Risk level: High
- Definition of done: Admin-only routes are protected server-side, admins can inspect users/jobs, hide unsafe jobs/profiles, and moderation actions leave enough notes/logging to diagnose who changed what.
- Suggested next implementation step: Build the smallest protected moderation surface using the existing internal-only admin marker and `require_admin_user`.

### Pricing page

- Priority: P0
- Status: ❌ Not done
- Current evidence from the codebase: No `/pricing` route or pricing component was found.
- Missing work: Pricing tiers, job post pricing, plan limits, checkout entry points, FAQs, paid feature copy, and clear commercial terms before checkout.
- Files/routes/components involved: future `app/pricing/page.tsx`, future payment integration
- Risk level: High
- Definition of done: Pricing page clearly maps plans or job-post products to benefits and checkout, with server-side products as source of truth before accepting payment.
- Suggested next implementation step: Finalize commercial packaging before building checkout.

### Terms/privacy/refund/cancellation pages

- Priority: P0
- Status: ❌ Not done
- Current evidence from the codebase: No terms, privacy, refund, or cancellation routes were found.
- Missing work: Legal pages, checkout links, footer/nav access, versioned policy update process, and payment-flow links before users can pay.
- Files/routes/components involved: future `app/terms/page.tsx`, `app/privacy/page.tsx`, `app/refund/page.tsx`, `app/cancellation/page.tsx`
- Risk level: High
- Definition of done: Legal and commerce policy pages are published, linked from auth/payment flows, and reviewed before accepting payments.
- Suggested next implementation step: Draft policy pages and route structure before enabling checkout.

### Payments

- Priority: P0
- Status: ❌ Not done
- Current evidence from the codebase: No Stripe/payment dependency, payment routes, checkout creation, subscription model, plan model, billing env vars, or pricing page were found.
- Missing work: Payment provider integration, checkout, customer mapping, product/price IDs, entitlement model, invoices/receipts handling, and paid feature gating.
- Files/routes/components involved: `package.json`, `app/`, `backend/app/`, `.env.example`, `backend/.env.example`
- Risk level: High
- Definition of done: Employers can pay for job posts/plans, payment state is persisted server-side, and paid features are unavailable without confirmed entitlement.
- Suggested next implementation step: Choose payment provider and define the entitlement model before adding checkout UI.

### Payment webhook handling

- Priority: P0
- Status: ❌ Not done
- Current evidence from the codebase: No webhook route or signature verification code was found.
- Missing work: Webhook endpoint, raw body handling, signature verification, idempotency, event persistence, entitlement updates, retry safety, and tests.
- Files/routes/components involved: `backend/app/api/v1/routers/`, `app/api/`, future payment models/migrations
- Risk level: High
- Definition of done: Payment access depends only on verified webhook-confirmed events and idempotent server-side entitlement updates.
- Suggested next implementation step: Add a backend webhook endpoint and event table as part of payment integration design.

### Security/access control

- Priority: P0
- Status: ⚠️ Broken / risky
- Current evidence from the codebase: JWT auth dependencies exist in `backend/app/api/deps.py`; `/me`, `/user`, and profile endpoints require auth. Single-profile authorization helpers now cover authentication, admin checks, profile ownership, job ownership, application-participant shape, and profile capability checks. Job update/delete routes in `backend/app/api/v1/routers/jobs.py` now require owner/admin authorization, and job create/update validates ownership for any supplied `hiring_identity_id`.
- Missing work: Job creation still needs a mandatory post-ready profile gate, application routes still need participant checks once implemented, admin routes still need real endpoints, and future paid features need entitlement checks. Rate limiting, CSRF review, production secret enforcement, and broader endpoint-level tests remain.
- Files/routes/components involved: `backend/app/api/deps.py`, `backend/app/api/v1/routers/jobs.py`, `backend/app/core/security.py`, `backend/app/core/config.py`, `lib/auth.ts`
- Risk level: High
- Definition of done: All sensitive actions require authenticated users with correct ownership, profile capability, admin permission, and payment entitlement where applicable. Tests assert unauthorized, wrong-owner, forbidden, and expired-token failures.
- Suggested next implementation step: Apply the authorization helpers to job creation/publishing, applications, admin, and paid-feature routes as each P0 flow is implemented.

### Environment variables

- Priority: P0
- Status: ⚠️ Broken / risky
- Current evidence from the codebase: `.env.example` and `backend/.env.example` exist, but both use placeholder secrets. `backend/.env.example` documents server-side `YOUTUBE_API_KEY` for portfolio metadata import. `backend/app/core/config.py` defaults `JWT_SECRET` to `change-me`; frontend defaults backend URL to localhost in `lib/backendClient.ts` and `lib/auth.ts`.
- Missing work: Production env validation, required secret checks, provider-specific env vars for email/payments/analytics, and deployment-specific configuration docs.
- Files/routes/components involved: `.env.example`, `backend/.env.example`, `backend/app/core/config.py`, `lib/backendClient.ts`, `lib/auth.ts`
- Risk level: High
- Definition of done: App refuses production boot with placeholder secrets or missing critical env vars. All production variables are documented and validated.
- Suggested next implementation step: Add production startup validation for secrets, CORS origins, frontend URL, database URL, OAuth, email, and future payment vars.

### Database schema and migrations

- Priority: P0
- Status: 🟡 Partially done
- Current evidence from the codebase: FastAPI backend uses Alembic migrations for jobs, auth, profiles, roles, and portfolio. A separate legacy Prisma SQLite schema exists at `prisma/schema.prisma`.
- Missing work: No schemas for applications, payments, subscriptions, invoices, notifications, employer organizations/team membership where needed, or admin elevation/audit workflow. Legacy Prisma path may confuse production data ownership.
- Files/routes/components involved: `backend/alembic/versions/*`, `backend/app/models/*`, `prisma/schema.prisma`
- Risk level: Medium
- Definition of done: Production source of truth is clearly documented, all launch-critical domains have migrations, and legacy/local fallback data paths cannot be mistaken for production.
- Suggested next implementation step: Document backend Postgres as production source of truth and add migrations only after domain models are reviewed.

### Deployment readiness

- Priority: P0
- Status: 🟡 Partially done
- Current evidence from the codebase: Backend has `Dockerfile`, `docker-compose.yml`, health routes, and README instructions. Frontend has default Next scripts. On 2026-05-24, the home jobs feed, post-job submit path, job detail route, and `/you` profile shell were made resilient in local development so they fall back to local data/profile rendering instead of returning backend connection errors when `NEXT_PUBLIC_USE_LOCAL_MOCKS=false` but the backend at `NEXT_PUBLIC_BACKEND_URL` is not running. README still contains create-next-app boilerplate.
- Missing work: Production deployment runbook, CI/CD, build checks, production Docker/hosting config, secrets validation, observability, backup/restore, and staging environment.
- Files/routes/components involved: `README.md`, `backend/README.md`, `backend/Dockerfile`, `backend/docker-compose.yml`, `.github/`
- Risk level: High
- Definition of done: Staging and production deploy from CI, migrations run safely, health checks and logs are monitored, secrets are validated, and rollback/backups are documented.
- Suggested next implementation step: Create a production deployment checklist and CI pipeline that runs frontend build, backend tests, lint, and migration checks.

## P1 = Important For Early Users

### Talent profile pages

- Priority: P1
- Status: 🟡 Partially done
- Current evidence from the codebase: Public profiles exist at `/u/[slug]`, backed by `GET /api/v1/users/{username}/public-profile`. Profile tabs show overview, jobs, and portfolio with privacy-applied data.
- Missing work: SEO metadata per profile, review system, share previews, richer empty states, and explicit public/private visibility review.
- Files/routes/components involved: `app/u/[slug]/page.tsx`, `components/profile/PublicProfileTabs.tsx`, `backend/app/api/v1/routers/users.py`, `backend/app/services/profile_service.py`
- Risk level: Medium
- Definition of done: Public profiles are SEO-ready, privacy-safe, complete enough for employers, and tested across empty/partial/complete profiles.
- Suggested next implementation step: Add `generateMetadata` for public profile pages and audit privacy fields.

### Job pages

- Priority: P1
- Status: 🟡 Partially done
- Current evidence from the codebase: Job detail route exists at `/jobs/[id]` with job hero, description sections, reference videos, and actions panel components.
- Missing work: Real apply flow, SEO metadata, expired/archived behavior, structured data, and job owner controls.
- Files/routes/components involved: `app/jobs/[id]/page.tsx`, `components/job-details/*`, `backend/app/api/v1/routers/jobs.py`
- Risk level: Medium
- Definition of done: Job pages show real state, support applying, handle unavailable jobs, expose SEO metadata, and never leak owner-only actions.
- Suggested next implementation step: Wire job detail actions to the future persisted application flow.

### Talent dashboard

- Priority: P1
- Status: 🟡 Partially done
- Current evidence from the codebase: `/you` loads `YouHubClient` for authenticated users and supports profile, jobs, portfolio, applications, and saved tabs. The Portfolio tab can be opened without completing prerequisite profile fields. On 2026-05-18, the owner portfolio experience was rebuilt around a Behance-inspired creator proof-of-work model in `components/you/PortfolioProjectWorkspace.tsx`: users can create a project, import YouTube metadata through `POST /api/v1/portfolio/youtube/preview`, choose or override a cover, add title/role/source/visibility/status, contribution chips, tools, tags, verified/public metrics, self-reported metrics, save drafts, publish projects, and pin featured work. On 2026-05-21, the Add Work Sample builder was refined into a bounded one-step-at-a-time wizard after link preview/fallback, with clearer source labels, private/restricted link guidance, cover/thumbnail wording, project timeline UX mapped to existing now/past persistence, and role/source-aware contribution/tool suggestions; the Source and Cover stages were then merged into one `Source & cover` screen to reduce unnecessary clicks while keeping thumbnail override and card preview. The visible builder copy was then cleaned up to use project language, remove duplicate step headings, remove the redundant contribution chip question, and shorten the wizard to `Source & cover`, `Project details`, `Contribution`, and `Review` without backend changes. The first Add Project dialog was also simplified to `Project URL` copy with reduced explanatory text, cleaned platform examples, generic public-URL helper copy, and an animated URL placeholder while preserving link preview behavior. The owner and public profile rating row now shows the empty-star `(0 reviews)` state for zero-review profiles. Backend portfolio items now support `publish_status` and `thumbnail_options` through migration `backend/alembic/versions/0014_portfolio_project_states.py`; public profile portfolio reads expose only public published projects while owners can see drafts/private items. On 2026-05-24, profile and portfolio persistence was re-audited: profile edits use authenticated backend profile APIs, project create/update/delete and pin/unpin use authenticated backend portfolio APIs, the Project Builder reloads saved portfolio records after writes, no permanent profile/project data is stored in browser storage, and offline local profile rendering is marked read-only with project creation disabled when backend storage is unavailable.
- Missing work: Real sent applications, real saved jobs, dashboard metrics, onboarding gates, and intent/capability-aware views.
- Files/routes/components involved: `app/you/page.tsx`, `components/you/YouHubClient.tsx`, `components/you/PortfolioProjectWorkspace.tsx`, `lib/backendClient.ts`, `backend/app/api/v1/routers/portfolio.py`, `backend/app/models/portfolio_item.py`, `backend/app/schemas/profile.py`, `backend/app/services/profile_service.py`, `backend/app/services/youtube_service.py`, `backend/app/repositories/auth_repository.py`, `backend/alembic/versions/0014_portfolio_project_states.py`, `app/you/applications/sent/page.tsx`, `app/you/saved/page.tsx`
- Risk level: Medium
- Definition of done: Talent dashboard is backed by real user data for profile, applications, saved jobs, and recommended work.
- Suggested next implementation step: Replace mock sent applications and saved jobs with backend-backed endpoints.

### Employer dashboard

- Priority: P1
- Status: ❌ Not done
- Current evidence from the codebase: `/you` has a jobs tab and received applications route, but no employer-specific dashboard route or employer-owned job management surface was found.
- Missing work: Employer overview, posted jobs management, applicant counts/statuses, billing status, and job performance metrics.
- Files/routes/components involved: `components/you/YouHubClient.tsx`, `app/you/applications/received/page.tsx`, `backend/app/api/v1/routers/jobs.py`
- Risk level: High
- Definition of done: Employers can manage posted jobs, applicants, payment status, and account settings from a dedicated server-permissioned dashboard.
- Suggested next implementation step: Define employer dashboard data requirements after single-profile hiring identity and application models are decided.

### Search and filters

- Priority: P1
- Status: 🟡 Partially done
- Current evidence from the codebase: Backend jobs list supports `q`, `platform`, `location`, `start_timeframe`, and status filters. Frontend job grid filters category and start timeframe client-side. Header search input is present but not wired.
- Missing work: Search UI wiring, backend-backed filters, pagination, location/platform filters in UI, URL query persistence, and talent search.
- Files/routes/components involved: `components/Header.tsx`, `components/JobGridClient.tsx`, `backend/app/api/v1/routers/jobs.py`, `backend/app/repositories/job_repository.py`
- Risk level: Medium
- Definition of done: Users can search and filter jobs reliably from the UI, filters are reflected in URLs, and results come from backend queries.
- Suggested next implementation step: Wire the header search and grid filters to backend query params.

### Candidate matching

- Priority: P1
- Status: ❌ Not done
- Current evidence from the codebase: `BackendJob` has optional `match_percentage` mapping in `lib/backendClient.ts`, but no backend matching service/model/endpoint was found.
- Missing work: Match scoring model, candidate discovery endpoint, explainable match reasons, employer filters, and permissions.
- Files/routes/components involved: `lib/backendClient.ts`, future backend matching service/routes
- Risk level: Medium
- Definition of done: Employers can discover talent ranked by transparent match criteria derived from profiles, roles, portfolio, and job requirements.
- Suggested next implementation step: Define a simple deterministic matching spec before implementing ML or complex ranking.

### Notifications

- Priority: P1
- Status: ❌ Not done
- Current evidence from the codebase: Header notification menu exists but displays "Notifications coming soon". No notification backend model or API was found.
- Missing work: Notification model, delivery channels, application/job/payment events, read state, email notifications, and user preferences.
- Files/routes/components involved: `components/Header.tsx`, future `backend/app/models/notification.py`, future notification routes
- Risk level: Medium
- Definition of done: Users receive persisted in-app and email notifications for critical marketplace events.
- Suggested next implementation step: Add notification requirements for applications and payments.

### Form validation

- Priority: P1
- Status: 🟡 Partially done
- Current evidence from the codebase: Auth forms validate username/password basics. Post-job validates title, city, budget range, YouTube identity, about text, and reference URL. Backend Pydantic schemas validate jobs/auth/profile payloads.
- Missing work: Shared validation rules, full validation coverage for future applications/payments/onboarding, clearer server error mapping, and automated tests for edge cases.
- Files/routes/components involved: `components/AuthPage.tsx`, `components/PostJobPage.tsx`, `components/post-job/PostJobForm.tsx`, `backend/app/schemas/*`
- Risk level: Medium
- Definition of done: Every launch form has client and server validation, loading/success/error states, and tests for invalid inputs.
- Suggested next implementation step: Add validation checklist to each future feature ticket and cover current critical forms with integration tests.

### Loading states

- Priority: P1
- Status: 🟡 Partially done
- Current evidence from the codebase: Several local loading flags exist (`busy`, `resendBusy`, `isSubmitting`, profile loading states). No route-level `loading.tsx` files were found.
- Missing work: Consistent route loading states, skeletons for server-rendered job/profile pages, and loading states for future dashboards/search.
- Files/routes/components involved: `components/AuthPage.tsx`, `components/VerifyEmailPage.tsx`, `components/PostJobPage.tsx`, `components/you/YouHubClient.tsx`, `app/**/loading.tsx`
- Risk level: Low
- Definition of done: Each data-fetching route and form has a visible loading state that does not shift or break layout.
- Suggested next implementation step: Add route-level loading states after critical data flows are finalized.

### Empty states

- Priority: P1
- Status: 🟡 Partially done
- Current evidence from the codebase: Job grid, sent applications, public profile tabs, and received applications include empty-state copy.
- Missing work: Empty states are not comprehensive for all future real dashboards and may not distinguish onboarding-required vs truly empty data.
- Files/routes/components involved: `components/JobGridClient.tsx`, `app/you/applications/sent/page.tsx`, `components/you/ReceivedApplicationsClient.tsx`, `components/profile/PublicProfileTabs.tsx`
- Risk level: Low
- Definition of done: Every list/dashboard surface has actionable empty states for new users and zero-result searches.
- Suggested next implementation step: Re-audit empty states after replacing mock application data with real endpoints.

### Error states

- Priority: P1
- Status: 🟡 Partially done
- Current evidence from the codebase: Forms and public profile fallback render error messages. Backend has centralized error handlers in `backend/app/core/errors.py`. No route-level `error.tsx` files were found.
- Missing work: Consistent route error boundaries, production-safe error messages, retry affordances, and error tracking.
- Files/routes/components involved: `backend/app/core/errors.py`, `components/AuthPage.tsx`, `components/PostJobPage.tsx`, `components/you/YouHubClient.tsx`, `app/**/error.tsx`
- Risk level: Medium
- Definition of done: Every data route and critical form has user-safe error handling, retry where appropriate, and server logs/traces for debugging.
- Suggested next implementation step: Add route-level error boundaries for jobs, profiles, and dashboards.

### Mobile responsiveness

- Priority: P1
- Status: 🟡 Partially done
- Current evidence from the codebase: Many components use responsive Tailwind classes (`sm:`, `lg:`, `xl:`) and horizontal overflow for tab/filter bars. The app uses fixed header/sidebar layout with `pl-20 pt-14`.
- Missing work: No automated viewport screenshots or mobile regression checks were found; fixed left rail may need explicit small-screen verification.
- Files/routes/components involved: `app/layout.tsx`, `components/Header.tsx`, `components/Sidebar.tsx`, `components/JobGridClient.tsx`, `components/PostJobPage.tsx`, `components/you/YouHubClient.tsx`
- Risk level: Medium
- Definition of done: Core flows are verified on mobile and desktop viewports with no overlap, clipping, or blocked actions.
- Suggested next implementation step: Add Playwright smoke screenshots for home, job detail, post job, auth, `/you`, and public profile.

### UI consistency and polish

- Priority: P1
- Status: 🟡 Partially done
- Current evidence from the codebase: Existing UI has consistent dark marketplace styling, cards, tabs, tags, and icon usage across jobs/profile/posting. A granular website information architecture audit now exists at `docs/CREATORJOBS_INFORMATION_ARCHITECTURE.md`, covering current routes, page controls, shared navigation, frontend/backend API surfaces, placeholder interactions, dormant components, and IA risks. A flowchart-oriented control map now exists at `docs/CREATORJOBS_FLOWCHART_REFERENCE.md`, documenting which buttons, links, tabs, cards, and form actions lead to which routes, modals, API actions, or placeholder states.
- Missing work: README still boilerplate; some UI copy is development-specific; mock application data and alert-based save/share actions reduce commercial polish.
- Files/routes/components involved: `components/*`, `app/*`, `README.md`, `lib/mockApplications.ts`, `docs/CREATORJOBS_INFORMATION_ARCHITECTURE.md`, `docs/CREATORJOBS_FLOWCHART_REFERENCE.md`
- Risk level: Medium
- Definition of done: No development copy, mock-only interactions, or unfinished commercial surfaces appear in launch paths.
- Suggested next implementation step: Create a UI copy/polish pass after P0 functionality is implemented.

### SEO metadata

- Priority: P1
- Status: ⚠️ Broken / risky
- Current evidence from the codebase: `app/layout.tsx` still uses default metadata: title "Create Next App" and description "Generated by create next app". No route-specific `generateMetadata` was found in inspected pages.
- Missing work: Brand metadata, per-job metadata, per-profile metadata, Open Graph images, canonical URLs, robots/sitemap strategy, and structured data for jobs.
- Files/routes/components involved: `app/layout.tsx`, `app/jobs/[id]/page.tsx`, `app/u/[slug]/page.tsx`
- Risk level: Medium
- Definition of done: All public acquisition pages have production metadata, share previews, canonical URLs, and job/profile-specific titles.
- Suggested next implementation step: Replace root metadata and add `generateMetadata` for job and public profile pages.

## P2 = Polish/Growth

### Analytics/tracking

- Priority: P2
- Status: ❌ Not done
- Current evidence from the codebase: No analytics provider, event tracking, conversion tracking, or analytics env vars were found.
- Missing work: Product analytics, funnel events, payment conversion events, job view/apply/post events, privacy-aware consent approach, and dashboards.
- Files/routes/components involved: future analytics provider in `app/layout.tsx` or a dedicated client component
- Risk level: Medium
- Definition of done: Core funnel events are tracked with privacy-safe identifiers and production dashboards.
- Suggested next implementation step: Define launch metrics and add minimal analytics instrumentation after legal/privacy review.

### Talent discovery/search

- Priority: P2
- Status: ❌ Not done
- Current evidence from the codebase: Public profiles are individually accessible by username, but no talent directory/search route was found.
- Missing work: Talent directory, filters by role/style/platform/location/availability, indexing, privacy controls, and employer access rules.
- Files/routes/components involved: `app/u/[slug]/page.tsx`, `backend/app/api/v1/routers/users.py`, future talent search route
- Risk level: Medium
- Definition of done: Employers can search public talent profiles with privacy-respecting filters and useful ranking.
- Suggested next implementation step: Build a backend public talent search endpoint after profile fields and visibility rules stabilize.

### Saved jobs

- Priority: P2
- Status: ❌ Not done
- Current evidence from the codebase: `app/you/saved/page.tsx` redirects to `/you?tab=saved`, and job card save action only shows an alert. No saved-job model/API was found.
- Missing work: Persisted saves, authenticated save/unsave endpoint, saved jobs dashboard data, and empty states tied to real data.
- Files/routes/components involved: `components/JobCard.tsx`, `app/you/saved/page.tsx`, `components/you/YouHubClient.tsx`
- Risk level: Low
- Definition of done: Signed-in users can persist saved jobs and view them across sessions/devices.
- Suggested next implementation step: Add saved-jobs model and API after application model decisions.

### Reviews/reputation

- Priority: P2
- Status: ❌ Not done
- Current evidence from the codebase: Profile UI displays reviews count/rating placeholders, but no review model/API was found.
- Missing work: Review model, completed collaboration linkage, anti-abuse rules, review display, and moderation.
- Files/routes/components involved: `app/u/[slug]/page.tsx`, `components/profile/PublicProfileTabs.tsx`, `components/you/YouHubClient.tsx`
- Risk level: Medium
- Definition of done: Reviews can be created only from legitimate completed collaborations and are displayed on profiles.
- Suggested next implementation step: Defer until real application/hiring lifecycle exists.

## P3 = Later Scale Features

### Advanced admin dashboard

- Priority: P3
- Status: ❌ Not done
- Current evidence from the codebase: No admin routes, admin role model, admin-only API dependencies, analytics dashboard, payment operations surface, audit-log UI, support tooling, or moderation queues were found.
- Missing work: Advanced analytics, payment operations, full audit logs, support tooling, moderation queues, bulk actions, internal notes, and operational reporting.
- Files/routes/components involved: future `app/admin/*`, `backend/app/api/v1/routers/admin.py`, `backend/app/models/user.py`
- Risk level: Medium
- Definition of done: Advanced admin surfaces help operate a scaled marketplace without replacing the P0 requirement for basic protected moderation controls.
- Suggested next implementation step: Add only after basic admin/moderation, applications, payments, and support requirements are clear.

### Advanced candidate matching

- Priority: P3
- Status: ❌ Not done
- Current evidence from the codebase: No matching service exists beyond unused/mapped `match_percentage` support in frontend data types.
- Missing work: Ranking features, feedback loop, employer preferences, saved searches, explainability, and anti-bias review.
- Files/routes/components involved: future matching service/routes
- Risk level: Medium
- Definition of done: Matching improves discovery while remaining explainable, testable, and privacy-safe.
- Suggested next implementation step: Start with deterministic scoring in P1 before considering advanced matching.

### Team/agency accounts

- Priority: P3
- Status: ❌ Not done
- Current evidence from the codebase: Jobs have `posted_by_agency` and `agency_profile_slug` fields, but no organization/team membership model was found.
- Missing work: Organizations, members, roles, invite flow, shared billing, agency profile pages, and ownership transfer.
- Files/routes/components involved: `backend/app/models/job.py`, future organization models/routes
- Risk level: Medium
- Definition of done: Agencies can manage jobs, applicants, and billing across multiple team members with clear permissions.
- Suggested next implementation step: Defer until single-user employer flow is stable.

### Platform expansion

- Priority: P3
- Status: 🟡 Partially done
- Current evidence from the codebase: UI mentions YouTube and Instagram, and icon/data mapping includes other platforms. Verified identity flow is YouTube-specific.
- Missing work: Instagram identity verification, platform-specific follower verification, API/provider integrations, and platform-specific posting requirements.
- Files/routes/components involved: `components/PostJobPage.tsx`, `components/JobCard.tsx`, `components/profile/PlatformLogosRow.tsx`, `backend/app/services/youtube_service.py`
- Risk level: Medium
- Definition of done: Each supported platform has equivalent verification and data trust rules.
- Suggested next implementation step: Keep YouTube strong first; add Instagram verification only after P0 payment/applications are complete.
