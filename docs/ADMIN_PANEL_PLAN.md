# CreatorJobs Admin Panel — Product & Implementation Plan

> **Status of this document:** planning reference, written 2026-07 from a full audit of the
> codebase plus external trust-and-safety research. Nothing in this document is implemented
> unless its status flag says so. It is written so a future agent or developer can build the
> panel **without re-auditing the platform**.
>
> **Implementation addendum (2026-07-05):** Phases 1 and 2 — plus the self-contained Phase-3
> items — are now BUILT: the `/admin` shell (session-gated, 404 for non-admins) with Overview,
> Reports v2 (enum actions, hydration, pagination, triage ladder incl. warn/suspend/reopen),
> Verification queue (approve/reject/revoke with job-badge re-derivation), Users directory
> (suspend/unsuspend/warn, `last_active_at`), Listings state actions, Conversations Tier-1
> metadata + volume signals, Platform (notices via `platform_notice`, entitlements,
> registry/outbox views), append-only `AdminAuditLog` on every mutation, RBAC permission-key
> scaffold (`app/core/admin_permissions.py`), message reporting (`message` target) with the
> audited Tier-2 reported-conversation view and hide/unhide (`Message.deleted_at`), the
> user-facing report reason picker, the `is_verified` hardening fix, suspension enforcement
> (auth 403 + public-content exclusion), and `backend/scripts/grant_admin.py`. Migration:
> `backend/alembic/versions/0032_admin_panel.py`. Tests: `backend/tests/test_admin_panel.py`
> (16) + `tests/e2e/admin-panel.spec.ts` (9). Still `FUTURE` (product features first):
> compliance/deletion pipeline, appeals, block/mute visibility, payment disputes,
> assignee/SLA fields, role storage beyond the single ADMIN type, and in-Inbox message-report
> UI (backend accepts message reports; the chat surface entry point is deferred).
>
> Companion docs: `docs/CREATORJOBS_LAUNCH_READINESS.md` (P0-09 "Basic admin/moderation
> controls"), `docs/BETA_LAUNCH_READINESS.md` (founder daily-review checklist),
> `docs/POST_BETA_ROADMAP.md` ("Admin moderation overhaul"), `docs/NOTIFICATIONS.md`
> (notification pipeline the panel will hook into).

---

## Status flags used throughout

| Flag | Meaning |
| --- | --- |
| `NOW` | Implementable today against existing endpoints/data. |
| `PARTIAL` | A slice works today; the rest of the module needs new work. |
| `MOCK` | Can be demonstrated with seeded/demo data only (dev personas, seeded reports). |
| `NEEDS-BACKEND` | Data model exists (or mostly exists); needs new admin endpoints. |
| `NEEDS-MODEL` | Requires a new DB model/column + migration before endpoints. |
| `FUTURE` | Depends on a product feature that does not exist yet (any backend). |
| `DEV-ONLY` | Must exist only in development/test environments, never production. |

In the panel UI, every non-`NOW` module still renders — as a finished-looking section with a
quiet `Planned` state (the `DisabledFutureRow` pattern from Settings, not an empty page). The
admin panel is deliberately a **live roadmap**: what's greyed out is what remains.

---

## 1. Product summary

CreatorJobs is a dark, premium, minimalist **two-sided creator-economy job marketplace**
(India-first beta, INR). One account can act in two modes:

- **Talent** — creates a public profile + portfolio projects, publishes a *talent listing*,
  applies to jobs, receives *hiring requests*, manages everything in the Applications
  workspace (`/applications`: Inbox + Pipeline views, compact chat dock).
- **Recruiter / creator team** — posts *jobs* (optionally under a verified **hiring
  identity**: an individual channel or agency-represented channel on YouTube/Instagram),
  receives applications, sends hiring requests to talent, manages an applicant pipeline
  (stages: new / reviewing / shortlisted / interviewing / hired / rejected / archived, with
  quiet-by-default stage moves and user-confirmed status updates into chat).

Supporting systems: real messaging (conversations anchored to an application/hiring
request), an in-app notification pipeline with a mocked email outbox
(`docs/NOTIFICATIONS.md`), drafts (a `status="draft"` on listings, not a separate model),
saved jobs/talent, launch-free **entitlements** (checkout placeholder), user **reports** on
jobs/talent listings, and extensive dev tooling (personas, seed scenarios, workflow tester,
mock/backend data switch).

Stack: Next.js 16 App Router frontend (`app/`, `components/`, `lib/backendClient.ts`) +
FastAPI/SQLAlchemy backend (`backend/app/`), NextAuth session wrapping a backend JWT.

## 2. What the admin panel is for

1. **Beta operations.** `docs/BETA_LAUNCH_READINESS.md` commits the founder to reviewing
   reports and new listings **daily**. Today that means raw DB access or a bare
   `/admin/moderation` page. The panel is the daily operating surface: triage reports,
   review verification, inspect users/listings, act, and leave a trail.
2. **Trust enforcement.** CreatorJobs' core promise is that jobs and talent are real.
   The panel owns the levers: hide/pause listings, review hiring-identity evidence,
   revoke badges, (later) suspend accounts.
3. **Support.** "My listing disappeared", "I can't find my draft", "this recruiter is
   pressuring me off-platform" — the panel is where an operator answers those with facts.
4. **Accountability.** Every admin action is attributed, justified, and logged
   (see §15) — required by `CREATORJOBS_LAUNCH_READINESS.md` P0-09's definition of done
   ("moderation actions leave enough notes/logging to diagnose who changed what").
5. **Roadmap mirror.** Modules that can't work yet are visible in a `Planned` state, so the
   panel itself tracks what remains before/after beta.

It is explicitly **not** an analytics product, a growth dashboard, or a CRM. Vanity metrics
are excluded by design; §7.1 defines the small operational metric set.

## 3. Current platform audit (what exists today)

### 3.1 The one existing admin surface

- **Frontend:** `app/admin/moderation/page.tsx` (server component) →
  `components/marketplace/AdminModerationClient.tsx`. A flat list of `status="open"`
  report cards with three fixed buttons: `dismiss`, `pause_listing`, `hide_listing`.
  No filters, search, pagination, tabs, sorting, or bulk actions. Acted-on reports stay
  in the list (state is replaced in place). Action failures are silently swallowed.
- **Gating:** the page checks only that a session exists; admin-ness is inferred from the
  backend returning **403** on `listAdminReports` → renders "Admin access required."
  There is **no session-side `accountType === "ADMIN"` check**, no admin nav entry
  anywhere (Sidebar/Header), and `/admin/` is disallowed in `app/robots.ts` (good).
- **Backend endpoints:** exactly two admin routes exist —
  `GET /api/v1/admin/reports?status=` and `PATCH /api/v1/admin/reports/{id}`
  (`backend/app/api/v1/routers/marketplace.py`, `Depends(require_admin)`), plus the public
  `POST /api/v1/reports` (rate-limited 30/10min per IP; **unauthenticated reports are
  allowed** via `get_optional_current_user`; target existence is not validated).
- **Report model** (`backend/app/models/marketplace.py`, table `reports`):
  `reporter_user_id` (nullable), `target_type` (`job | talent_listing | profile`),
  `target_id` (string), `category` (free string ≤64), `note`, `status`
  (`open | dismissed | action_taken`), `admin_note`, `resolved_by_user_id`, `resolved_at`,
  `action` (free string), timestamps.
- **Report side effects** (in the PATCH handler): `hide_listing` → target soft-deleted
  (`deleted_at`) + `status="archived"`; `pause_listing` → `status="paused"` + `paused_at`.
  Only for `job`/`talent_listing` targets — **`profile` reports have no side effect**.
  `backend/app/core/marketplace.py` declares
  `REPORT_ACTIONS = ("dismiss", "hide_listing", "pause_listing", "mark_verified",
  "mark_rejected")` but **the schema does not enforce it** — `action` accepts any string.
- **Report submission UI:** single "Report this listing" buttons on job detail
  (`components/job-details/JobActionsPanel*.tsx`) and talent detail
  (`components/TalentListingActionsClient.tsx`), always sending
  `category: "suspicious_or_inaccurate"`, `note: null`. **No reason picker, no note field,
  no profile-report UI** despite `profile` being a valid target type.

### 3.2 Admin authorization model

- Single boolean: `User.account_type == "ADMIN"`
  (`backend/app/core/account_types.py: is_admin`, `require_admin` in
  `backend/app/api/deps.py`). No roles, scopes, or granular permissions.
- **No assignment path.** Public signup/onboarding cannot select ADMIN
  (`PublicAccountType` excludes it; `/me/account-type` never writes it). The only ADMIN in
  existence is the dev persona `dev-admin` (`backend/app/db/seed_data_personas.py`),
  created by dev/test-gated seeders. Production admin requires a direct DB write today.
- **Implicit admin override** exists throughout ownership checks: `require_job_owner`,
  `require_profile_owner`, `require_application_participant`, talent-listing edit/delete,
  application/interest status + bulk endpoints all allow ADMIN. So an admin can already
  *do* most moderation acts through normal endpoints — invisibly and **unlogged**.
- Frontend awareness: NextAuth session carries `session.user.accountType`
  (`lib/auth.ts`), and `GET /me` exposes `profile_capabilities.isAdmin`. Neither is used
  to gate UI today.

### 3.3 Adjacent systems the panel will manage

| System | What exists | Admin-relevant gap |
| --- | --- | --- |
| Users (`backend/app/models/user.py`) | email/username, `account_type`, `email_verified_at`, `hiring_verification_status` (string, default `"unverified"`), profile/hiring fields, `privacy_settings` | **No suspension/ban/deactivation fields, no `deleted_at`, no `last_active`/`last_login`**, no admin list/search endpoint |
| Jobs (`backend/app/models/job.py`) | `status` (`draft/published/paused/closed/archived`), `deleted_at`, `paused_at`, `closed_at`, `featured_until`, `is_verified` | No admin list endpoint; **`is_verified` is client-writable** (see §3.4) |
| Talent listings (`backend/app/models/marketplace.py`) | same lifecycle + `is_featured` | No admin list endpoint; no verified concept at all |
| Hiring identities (`backend/app/models/hiring_identity.py`) | `verification_status` (`UNVERIFIED/PENDING/VERIFIED/REJECTED`), `verification_method` (incl. **`MANUAL_ADMIN_REVIEW` — defined but unused**), `proof_url`, attempt counts, error strings, `verified_at` | Verification is self-service only (YouTube OAuth / Instagram bio-code); **no admin review endpoints, no queue** |
| Messaging (`backend/app/models/conversation.py`) | `Message.deleted_at` column exists | **No endpoint reads/writes `deleted_at`** — no hide/remove-message capability, no reported-thread view |
| Notifications (`backend/app/notifications/`) | registry + dispatch + mocked email outbox; category `"moderation"` reserved in `core/marketplace.py` but never emitted | No admin broadcast/send, no delivery inspection beyond dev outbox viewer |
| Entitlements | `Entitlement` model + launch-free checkout + `GET /me/entitlements` | No admin listing/grant/revoke |
| Drafts | not a model — listings with `status="draft"` | Support visibility = a filtered listing view (no content exposure needed) |
| Counts | dev-gated `GET /dev/status` (users/jobs/listings/applications/notifications) | **No production counts endpoint** for an overview dashboard |
| Audit | nothing | **No audit log model** |
| Dev tooling | 8 personas incl. `dev-admin`; seed scenarios incl. `reports` (2 open reports); workflow tester driving real handlers; dev email inbox/outbox; DevToolsPanel + mock/backend switch | Env-gated (`app_env in {development,test}`), not admin-gated — correct as-is |

### 3.4 Security/trust findings (fix inside admin Phase 1)

1. **`Job.is_verified` is client-writable.** It is a field on `JobCreate`/`JobUpdate`
   (`backend/app/schemas/job.py`) and `job_service.py` only overwrites it when a hiring
   identity is attached — a job posted **without** an identity can send
   `is_verified: true` and get a trust badge written to the DB. Fix: strip/ignore the
   client value server-side always; derive exclusively from identity status.
2. **Unlogged admin power.** The implicit admin override (§3.2) means an admin can edit or
   delete any user's listing through normal endpoints with no trace. The audit log (§15)
   must cover these paths, not just `/admin/*` routes.
3. **Report `action` unvalidated.** Free strings are stored; typos silently do nothing.
   Enforce `REPORT_ACTIONS` as a Literal in `ReportAdminUpdate`.
4. **Anonymous reports** are accepted (rate-limited per IP). Acceptable for launch, but the
   queue must show reporter identity when present and treat anonymous volume as a signal,
   not a verdict (see §19 open questions).
5. **Zero test coverage** on `GET/PATCH /admin/reports`, `require_admin` 403s, and the
   hide/pause side effects.

### 3.5 Frontend building blocks available

Reusable today: `StateCard`, `PageHeader`, `PageLoading`, `Section`, `StatRow`, `MetaRow`,
`TagPill`/`ToolChip`, `ConfirmDialog` (the one modal), `AnchoredGlassPopover` (the one
popover), `IconTooltip`; settings-local kit worth extracting (`StatusPill` with
active/danger/future/readonly/neutral tones, `SettingRow`, `ToggleSwitch`,
`DisabledFutureRow`); the Pipeline board's funnel-chip + tracked-caps section-heading
patterns.

**Missing primitives an admin panel needs (must be built):** a data table, a right-hand
detail drawer, a filter bar, pagination, shared tabs. The whole app is card-lists —
there is no `<table>` anywhere. §16 specifies these.

## 4. Planned platform assumptions

The panel is designed for the *finished* platform. Features assumed and flagged `FUTURE`
until their product work lands:

- **Account suspension/deactivation + warnings** (no fields today).
- **User-facing block/mute** (nothing today).
- **Account deletion & data export** (Settings shows disabled rows; no pipeline).
- **Message reporting** (reports today target only job/talent_listing/profile).
- **Appeals** on moderation decisions.
- **Talent-side verification** (talent listings/profiles have no verified concept).
- **Payments/payouts** (entitlements are launch-free placeholders).
- **Job alerts / saved searches** (a homepage email-capture stub exists at
  `app/api/job-alerts/route.ts`, file-persisted, unintegrated).

## 5. External patterns considered

Research pass over trust-and-safety and internal-tools literature (Stream, Tremau,
Sendbird on moderation; Refine/Lowcode on marketplace admin IA; KYC tooling writeups —
ShadowDragon, Ondorse — on verification review; Hubifi/Mattermost on audit trails; plus
ATS conventions from Greenhouse/Lever). What survived contact with CreatorJobs:

1. **Risk-tiered queues with SLA targets.** Reports aren't equal: an off-platform payment
   scam in messages ≠ a mis-categorized listing. The queue gets a priority derived from
   category + target type, with SLA hints (e.g. scam/safety: same day; quality: 72h).
   During solo-founder beta, this is a *sort order*, not a staffing model.
2. **One action queue, consistent standards across surfaces.** Users experience the
   marketplace holistically; enforcement must read the same on listings, profiles, and
   (later) messages. Reports of all target types live in one queue with one triage ladder
   (§10) — not per-content-type silos.
3. **Operational vs strategic split on the dashboard.** The Overview shows only what an
   operator acts on today (open reports, pending verification, new listings/users, system
   health). Trend analytics are explicitly out of scope until Phase 3.
4. **≤3 clicks for the common action.** Report triage = open queue → drawer → action.
   Detail drawers keep the queue in view (the Greenhouse/Lever pattern) instead of
   navigating away per item.
5. **Manual-review verification loop.** Approve / reject / request-more-info, with
   reviewer notes, decision history, and revocation — the standard KYC-lite shape, mapped
   onto the existing `HiringIdentity` fields (`MANUAL_ADMIN_REVIEW` is already an enum
   value waiting for this).
6. **Append-only, attributed audit log.** Actor, action, target, before/after, and a
   required justification on destructive actions. "user:42 updated record:98" is useless
   six months later; entries embed human-readable target labels.
7. **Minimum RBAC designed early, built late.** Owner/Admin/Moderator/Support/Analyst as
   a documented permission matrix now (§14), single ADMIN in code until a second operator
   actually exists.

Deliberately **not** copied: heavyweight ML auto-moderation, multi-level moderator
hierarchies, and config-driven policy engines — wrong scale for a founder-operated beta,
and `POST_BETA_ROADMAP.md` explicitly warns that beta manual review should reveal the
right tools before overbuilding.

## 6. Information architecture

Eight production sections + a dev area. Queues first (daily work), records second,
oversight last. Left rail navigation inside a `/admin` shell, each section keyed by a
badge count where meaningful (open reports, pending verification).

```
/admin
├── Overview            operational dashboard (counts, queues, health)        PARTIAL
├── Reports             the moderation queue (all target types)               PARTIAL
├── Verification        hiring-identity review queue                          NEEDS-BACKEND
├── Users               directory, detail, safety actions                     NEEDS-BACKEND
├── Listings
│   ├── Jobs            all jobs, lifecycle + moderation                      NEEDS-BACKEND
│   ├── Talent          all talent listings, lifecycle + moderation           NEEDS-BACKEND
│   └── Profiles        public profiles + portfolio review                    NEEDS-BACKEND
├── Conversations       applications / hiring requests / messages (privacy-gated)  FUTURE (metadata: NEEDS-BACKEND)
├── Platform
│   ├── Notifications   registry view, outbox inspection, broadcast           PARTIAL (dev) / NEEDS-BACKEND (prod)
│   ├── Entitlements    launch-free grants, future billing                    NEEDS-BACKEND
│   └── Compliance      deletion/export/retention                             FUTURE
├── Audit log           every admin action, append-only                       NEEDS-MODEL
└── Dev tools           personas / seed / workflows / emails                  DEV-ONLY (exists)
```

Why not more top-level items: "Safety" is a lens, not a place — safety actions live on
users/reports; block/mute lands inside Users when the product feature exists. Drafts are a
filter on Listings, not a section. Applications/messages merge into one privacy-sensitive
"Conversations" section rather than two tempting-to-browse ones.

Access: the `/admin` layout is a server component that checks
`session.user.accountType === "ADMIN"` and returns `notFound()` otherwise (no admin
existence leak), while **every** data call still hits `require_admin` backend routes —
UI gate for UX, backend gate for security. An "Admin" entry appears in the header account
menu only when `profile_capabilities.isAdmin` is true. `/admin` stays in `robots.ts`
disallow.

## 7. Module specifications

Layout grammar shared by all modules (see §16): toolbar (search + filter chips + sort) →
dense table/list → right-hand **detail drawer** (record context + actions + history) →
confirm dialog for destructive acts (with required justification where flagged).

### 7.1 Overview — `PARTIAL`

Purpose: the operator's morning page. Operational only.

- **Action queue strip** (the reason to open the panel): Open reports `n` · Pending
  verification `n` · New users (7d) `n` · New listings (7d) `n` — each a link into the
  filtered queue. `NEEDS-BACKEND` (new `GET /admin/overview` counts endpoint; today the
  only counts live in dev-gated `/dev/status`).
- **Recent activity feed**: last 20 platform events (new user, job published, report
  filed, verification requested). `NEEDS-BACKEND`.
- **System health**: backend reachable, DB (`/health`, `/health/db` exist — `NOW`), email
  mode (log/smtp + `EMAIL_DELIVERY_ENABLED` state — `NEEDS-BACKEND` to expose), rate-limit
  posture, environment banner (`development` / `test` / `production`).
- **Moderation workload**: reports resolved this week, median time-to-resolution.
  `NEEDS-MODEL` (derivable once reports carry consistent resolution data — partially
  possible from `resolved_at` today).
- Explicitly excluded: growth charts, GMV-style vanity metrics, message volume graphs.

### 7.2 Reports — the moderation queue — `PARTIAL`

The heart of the panel. Exists in miniature today; the upgrade is the first
implementation slice.

**Queue list** (works against existing endpoints once extended):
- Columns: priority dot · target (type icon + resolved title/name, not a bare UUID) ·
  category · reporter (name or "Anonymous") · age · status.
- Filters: status (`open` default / dismissed / action_taken / all), target type,
  category, reporter-known, age. Search by target id/title. Sort: priority, oldest-first
  (default for `open` — the SLA order).
- Priority is **derived**, not stored (Phase 1): category map (scam/safety/impersonation →
  high; spam → medium; suspicious_or_inaccurate/quality → normal) × target reach
  (published listing > draft). Stored priority + assignee are `FUTURE` (multi-operator).
- Pagination: `NEEDS-BACKEND` (current endpoint caps at 100, no offset).

**Detail drawer** for a report:
- Target snapshot card (listing title, owner, status, created; deep link "View public
  page" opening in new tab) — `NEEDS-BACKEND` (target hydration; today the queue shows
  only `target_id`).
- Report context: category, note, reporter, **other reports on the same target** (count +
  list — repeated-report signal), prior actions taken on this target (from audit log).
- Timeline: filed → viewed → resolved, with `admin_note` history.

**Actions** (triage ladder, §10): Dismiss · Contact owner (`FUTURE` — needs admin
messaging/notice) · Pause listing (`NOW`) · Hide listing (`NOW`) · Warn user (`FUTURE`) ·
Suspend user (`NEEDS-MODEL`) · Escalate (`FUTURE`, meaningless until >1 operator) ·
Reopen (`NEEDS-BACKEND`, trivial). Every action requires/records `admin_note` and writes
an audit entry. Backend hardening in the same slice: enforce `REPORT_ACTIONS` enum,
handle `profile` targets (at minimum: no-op with explicit "no automated side effect"
labeling in UI), validate target existence on `POST /reports`.

### 7.3 Verification — hiring-identity review — `NEEDS-BACKEND` (model ready)

The trust program's admin half. The `HiringIdentity` model already carries everything the
queue needs; what's missing is admin endpoints + UI.

- **Queue**: identities with `verification_status="PENDING"` (and a "recently rejected /
  resubmitted" filter). Columns: identity (display name + platform icon + handle) ·
  owner · method (`YOUTUBE_OAUTH` / `INSTAGRAM_LINK_IN_BIO` / `VERIFICATION_CODE` /
  `MANUAL_ADMIN_REVIEW`) · attempts · age.
- **Drawer**: evidence panel — `proof_url` (opens externally, clearly marked as external),
  `verification_code` + expiry, `verification_last_error`, attempt count, the owner's
  other identities and their statuses, jobs posted under this identity (and whether
  `is_verified` snapshots exist).
- **Actions**: Approve (`verification_status=VERIFIED`, `verified_at`, method
  `MANUAL_ADMIN_REVIEW` when manual) · Reject (reason required, stored) · Request more
  info (`FUTURE` — needs a user-facing notice channel; until then rejection reason doubles
  as the request) · **Revoke** (VERIFIED → REJECTED/UNVERIFIED; must also re-derive
  `is_verified` on that identity's jobs) · internal reviewer notes (`NEEDS-MODEL` —
  a notes field or reuse of audit-log justification).
- History: all status transitions for the identity, from the audit log.
- Scope honesty: **agency/brand verification beyond the two identity types, and any
  talent-side verification, are `FUTURE`** (no models). User-level
  `hiring_verification_status` (a loose string on User) should be reconciled with
  identity-level status during this work — flagged in §19.

### 7.4 Users — `NEEDS-BACKEND` (directory) / `NEEDS-MODEL` (safety actions)

- **Directory**: search by email/username/display name; filters: mode (talent-active /
  recruiter-active / both — derived from listings+identities, since `account_type` is
  legacy), email-verified, has-published-listings, reported (has reports as target
  subject), created-at window. Columns: user (avatar+name+username) · email ·
  verified-email dot · listings `n` · applications `n` · reports `n` · joined.
  `last_active` column is `NEEDS-MODEL` (no tracking today — add `last_active_at`
  touched by auth/api middleware).
- **Drawer**: profile snapshot (public-view link), counts (jobs, talent listings,
  applications sent/received, hiring requests, portfolio items — assembled from existing
  tables), hiring identities + verification statuses, entitlements, reports *by* and
  *about* them, moderation history (audit log), email-verification state.
- **Actions**:
  - View public profile / listings (`NOW` — links).
  - Verify/unverify hiring identity → jump to Verification drawer (`NEEDS-BACKEND`).
  - Warn (`FUTURE` — needs the notice channel; a warning is a recorded notice, not a chat
    message).
  - **Suspend/unsuspend** (`NEEDS-MODEL`: `suspended_at`, `suspension_reason`,
    `suspended_by`; enforcement: auth dependency rejects suspended users; public content
    hidden while suspended).
  - **Deactivate/delete** (`FUTURE` — belongs to the compliance pipeline, §7.8).
  - Impersonation: **rejected for production.** Dev personas already provide safe
    account-switching in dev/test; a production impersonation primitive is a standing
    security liability. Support debugging uses the drawer's read-only views instead.

### 7.5 Listings — Jobs / Talent / Profiles & Portfolio — `NEEDS-BACKEND`

Three tabs sharing one table grammar.

- **Jobs**: filters status (draft/published/paused/closed/archived + deleted), category,
  platform, location, verified-badge, has-identity, reported, budget outliers
  (`< ₹500` or `> p95` — heuristic flag, `NEEDS-BACKEND`), "missing key info"
  (no budget/description-thin — reuses listing-strength logic from
  `RecommendedChecklistPopup` heuristics). Columns: job · owner/channel · status ·
  verified · applications `n` · reports `n` · posted.
  Drawer: full listing snapshot, owner, application count, reports, lifecycle timeline,
  entitlement used. Actions: View public (`NOW`) · Pause/Unpause · Hide (soft-delete) /
  Unhide · Close · Mark spam (`NEEDS-MODEL` — a `moderation_flag` or reuse of
  hide+audit-reason; do not invent a parallel status) · Contact owner (`FUTURE`) ·
  Admin-edit (exists implicitly via owner-override today — surface it **only** as
  "fix category/typo" level corrections, always audited; content rewrites are not an
  admin function).
- **Talent listings**: same grammar; filters add role/niche/format/platform, portfolio
  count, availability. No verified concept exists (`FUTURE` if talent verification ships).
- **Profiles & Portfolio**: directory of public profiles (talent + recruiter view),
  flagged-content lens: bio/headline/links, portfolio projects with external links and
  thumbnails. Actions: hide portfolio item / remove project (`NEEDS-BACKEND` — no admin
  endpoint; `PortfolioItem` has owner-scoped CRUD today), flag profile (`NEEDS-MODEL`),
  request edits (`FUTURE` — notice channel). Until endpoints exist this tab is a
  read-only directory built on public profile reads (`PARTIAL` possible).

### 7.6 Conversations — applications, hiring requests, messages — metadata `NEEDS-BACKEND`, content `FUTURE`

The privacy-sensitive module; designed around **graduated disclosure**:

1. **Tier 1 — metadata (default view):** application/hiring-request records — parties,
   job/listing, status, stage history, timestamps, counts. No message bodies. Enough for
   most support ("did the recruiter ever respond?") and abuse-pattern review (mass
   outreach: one recruiter → N interests in T hours; spam applications likewise).
   `NEEDS-BACKEND` (admin list endpoints over existing tables).
2. **Tier 2 — reported-thread view:** message content becomes visible **only** through a
   report on that conversation/message, and opening it writes an audit entry (who viewed,
   which report justified it). `FUTURE` — requires message reporting (new report target
   type) first.
3. **Tier 3 — actions:** hide message (uses the existing dormant `Message.deleted_at`
   column — `NEEDS-BACKEND`), warn/suspend participants (→ Users), close thread
   (`FUTURE`).

Never built: free browsing of arbitrary user conversations. The UI must make the
justification requirement structurally unavoidable, not a policy footnote.

### 7.7 Platform — Notifications / Entitlements — `PARTIAL`/`NEEDS-BACKEND`

- **Notifications**: read-only registry view (event keys, channels, priorities — render
  from `backend/app/notifications/registry.py` via a small admin endpoint); outbox
  inspection (statuses `queued/mocked/sent/failed` — the dev viewer
  `GET /dev/emails/outbox` exists `DEV-ONLY`; production inspection `NEEDS-BACKEND`);
  resend failed (`FUTURE` — meaningless until real delivery is enabled); **platform
  notice / broadcast** (`NEEDS-BACKEND` — a `platform_notice` event through the existing
  dispatch pipeline; the `"moderation"` notification category is already reserved).
  Event *testing* stays in Dev tools, not production.
- **Entitlements**: list/filter launch-free grants (kind, user, target, status, expiry),
  revoke/extend (`NEEDS-BACKEND`); payment disputes `FUTURE`.
- **Drafts support**: a saved filter on Listings (status=draft) showing owner + updated-at
  only — supports "I lost my draft" tickets without exposing content. `NEEDS-BACKEND`
  (same listing endpoints).

### 7.8 Compliance — `FUTURE`

Deletion requests queue (request → grace window → anonymize/purge with per-table
strategy), export requests, retention log, legal-hold override. Nothing exists today
(Settings rows are disabled placeholders). The panel reserves the section with a
`Planned` state describing the intended pipeline so the roadmap is visible. Depends on:
deletion-request model, anonymization strategy per table (reports/audit entries keep
pseudonymous references), and a policy decision on message retention for counterparties.

### 7.9 Audit log — `NEEDS-MODEL`

See §15. UI: filterable timeline (actor, action key, target type, date range), entry
drawer with before/after diff and justification. Read-only forever; no delete/edit path
in any role.

### 7.10 Dev tools — `DEV-ONLY` (exists)

Already built and correctly env-gated: persona switcher (incl. `dev-admin`), seed
scenarios (`reports` seeds 2 open reports; `full_demo` everything), cross-persona
workflow tester (drives real handlers), dev email inbox + notification outbox viewer,
mock/backend data switch. The admin shell links to them **only when
`isDevToolsAllowed()`**, clearly badged "Development". Production builds never render the
section. New dev utilities worth adding with the panel: "generate N test reports" and
"generate pending verifications" scenarios (both trivial extensions of
`seed_data_personas.py` — `MOCK`).

## 8. Implementation status matrix

| Capability | Status | Blocking dependency |
| --- | --- | --- |
| Admin shell `/admin` + nav + session gate | `NOW` | none (session has `accountType`) |
| Reports queue (list, filter open/all) | `NOW` | existing `GET /admin/reports` |
| Reports: pagination, richer filters, target hydration | `NEEDS-BACKEND` | extend admin reports endpoint |
| Reports: dismiss/pause/hide actions | `NOW` | existing PATCH (+ enum enforcement recommended) |
| Reports: profile-target handling, reopen | `NEEDS-BACKEND` | small handler changes |
| Reports: warn/suspend/escalate/assign | `NEEDS-MODEL` / `FUTURE` | suspension fields; notice channel; multi-operator |
| Report reason picker + note (user-facing) | `NEEDS-BACKEND` (UI + category enum) | none serverside (category is free string) |
| Overview counts | `NEEDS-BACKEND` | new `GET /admin/overview` |
| Overview health (API/DB) | `NOW` | `/health`, `/health/db` |
| Users directory + drawer | `NEEDS-BACKEND` | new `GET /admin/users` (+detail) |
| Suspend/unsuspend | `NEEDS-MODEL` | User suspension columns + auth enforcement |
| `last_active` | `NEEDS-MODEL` | column + touch middleware |
| Jobs/Talent admin lists + lifecycle actions | `NEEDS-BACKEND` | new admin list endpoints (actions partly exist via owner-override — must be routed through audited admin endpoints instead) |
| Portfolio/profile moderation actions | `NEEDS-BACKEND` | admin portfolio endpoints |
| Verification queue + approve/reject/revoke | `NEEDS-BACKEND` | admin identity endpoints (model complete, `MANUAL_ADMIN_REVIEW` reserved) |
| Request-more-info loop | `FUTURE` | user-facing notice channel |
| Conversations metadata (apps/requests) | `NEEDS-BACKEND` | admin list endpoints over existing tables |
| Reported-message view + hide message | `FUTURE` / `NEEDS-BACKEND` | message report target; endpoint for dormant `Message.deleted_at` |
| Platform notice/broadcast | `NEEDS-BACKEND` | `platform_notice` event via existing dispatch |
| Outbox inspection (prod) | `NEEDS-BACKEND` | admin outbox endpoint (dev viewer exists) |
| Entitlements admin | `NEEDS-BACKEND` | admin entitlement endpoints |
| Compliance/deletion/export | `FUTURE` | product pipeline + models |
| Block/mute visibility | `FUTURE` | user-facing feature first |
| Audit log (write + view) | `NEEDS-MODEL` | `AdminAuditLog` table |
| RBAC (5 roles) | `FUTURE` | second operator; permission column/claims |
| `is_verified` hardening | `NEEDS-BACKEND` (bugfix) | strip client value in `job_service.py` |
| Admin minting procedure | ops decision | documented script/migration (never public API) |
| Dev utilities (personas/seeds/workflows) | `NOW` (`DEV-ONLY`) | exists |

## 9. Data/backend dependencies (the concrete new surface)

**New router: `backend/app/api/v1/routers/admin.py`** (mounted under `/api/v1/admin`,
every route `Depends(require_admin)`, every mutation writing an audit entry):

- `GET /admin/overview` — counts: users (total/new-7d), jobs + talent listings by status,
  applications/interests (total/new-7d), open reports, pending verifications, email mode +
  delivery flag, env.
- `GET /admin/users` — search + filters + pagination (limit/offset, ≤100/page);
  `GET /admin/users/{id}` — drawer payload (counts, identities, entitlements, reports,
  audit refs).
- `GET /admin/jobs`, `GET /admin/talent-listings` — includes drafts + soft-deleted
  (explicit `include_deleted` flag), filters per §7.5;
  `PATCH /admin/jobs/{id}/state`, `PATCH /admin/talent-listings/{id}/state` — pause/
  unpause/hide/unhide/close with required `reason` (replaces silent owner-override use).
- `GET /admin/reports` v2 — pagination, target-type/category filters, hydrated target
  summaries, sibling-report counts; `PATCH /admin/reports/{id}` — enum-enforced actions,
  reopen support, profile-target explicit no-op.
- `GET /admin/hiring-identities?status=PENDING`, `PATCH /admin/hiring-identities/{id}` —
  approve/reject/revoke (+ reason), setting `verification_method=MANUAL_ADMIN_REVIEW` on
  manual approvals and re-deriving `is_verified` on the identity's jobs on revoke.
- `GET /admin/applications`, `GET /admin/talent-interests` — metadata only (Tier 1);
  `POST /admin/messages/{id}/hide` — sets `Message.deleted_at` (Tier 3, later).
- `GET /admin/audit-log` — filterable, paginated.
- `POST /admin/notices` — platform notice via `dispatch_notification`
  (`platform_notice` event, category `"moderation"`/`"system"`).

**New models/migrations:**

1. `AdminAuditLog` (§15) — first migration of the workstream; everything else writes to it.
2. `User` safety columns: `suspended_at`, `suspension_reason`, `suspended_by_user_id`,
   `last_active_at` (+ enforcement in `get_current_user`: suspended → 403 with distinct
   error code; public queries exclude suspended users' content).
3. Later: `deletion_requests`, warning/notice records, report `priority`/`assignee`.

**Hardening in the same workstream:** strip `is_verified` from client job payloads;
`Literal` enforcement for report actions (+ a `ReportCategory` enum shared with a new
user-facing reason picker); target-existence validation on `POST /reports`.

**Admin minting:** a documented operator procedure only — `backend/scripts/` one-off (or
alembic data migration) that sets `account_type="ADMIN"` for a named email, run manually
on the production DB. Never an API. Dev keeps the `dev-admin` persona.

**Frontend:** `lib/backendClient.ts` gains matching `admin*` functions; new
`components/admin/` primitives (§16); `/admin` layout gate via `getServerSession` +
`accountType === "ADMIN"` → `notFound()`.

## 10. Moderation workflows (reports)

**Daily loop:** Overview → Reports (open, oldest-first within priority) → for each: open
drawer → check target + sibling reports + prior actions → act → note → next. Target: inbox
zero on `open` daily during beta (per `BETA_LAUNCH_READINESS.md`).

**Triage ladder** (one consistent standard across listings/profiles/messages):

| Step | When | Effect | Status |
| --- | --- | --- | --- |
| Dismiss | no violation / duplicate / bad-faith report | report closed, note kept | `NOW` |
| Correct | metadata-level fix (category/typo) | audited admin edit | `NEEDS-BACKEND` (audited route) |
| Pause | needs owner action; recoverable | listing hidden from marketplace, owner keeps access | `NOW` |
| Hide | clear violation | soft-delete + archived | `NOW` |
| Warn | behavior issue, first offense | recorded notice to user | `FUTURE` (notice channel) |
| Suspend | repeated/severe | account locked, content hidden | `NEEDS-MODEL` |
| Escalate | legal/safety-critical | flag for owner review | `FUTURE` (multi-operator) |

Priority defaults (derived): scam / off-platform payment pressure / impersonation /
safety → **High (same-day)**; spam / fake listing → **Medium (48h)**;
suspicious_or_inaccurate / quality → **Normal (72h)**. Repeated reports on one target
auto-raise one tier.

**Resolution requirements:** every non-dismiss action requires an `admin_note`; all
actions write audit entries; the reporter is *not* auto-notified in Phase 1 (a
"thanks/outcome" notice is `FUTURE` with the notice channel — see §19).

## 11. Verification workflows

1. User requests verification (existing self-service: YouTube OAuth or Instagram
   bio-code) → auto-verifies on success; failures/timeouts leave `PENDING` with
   `verification_last_error`.
2. **Admin queue** picks up `PENDING` (and flagged `VERIFIED` — see revocation): inspect
   evidence (`proof_url`, code state, attempts, owner's history, jobs under the identity).
3. Decide: **Approve** (method → `MANUAL_ADMIN_REVIEW`, `verified_at` set) · **Reject**
   with reason (stored; user sees status + reason on their identity card) · request more
   info (`FUTURE`).
4. **Revocation:** on fraud discovery — status → REJECTED, jobs' `is_verified` snapshots
   re-derived, audit entry with justification, optionally paired with report/suspension
   actions.
5. Every transition lands in the audit log; the identity drawer shows full decision
   history. Rejected users may resubmit; attempt counts surface repeat abuse.

## 12. User management workflows

- **Support lookup:** search → drawer → answer from read-only facts (listing status,
  application record, verification state, notification/outbox trail). No impersonation.
- **Progressive enforcement:** note (internal) → warn (`FUTURE`) → suspend
  (`NEEDS-MODEL`; reason required; reversible; content hidden while suspended) →
  deactivate/delete (`FUTURE`, compliance pipeline §7.8). Each step audited; the user
  drawer shows the full enforcement history.
- **Dual-mode reality:** treat "talent vs recruiter" as *activity lenses* (derived from
  listings/identities/applications), not the legacy `account_type` value — one account
  can be both, and enforcement applies to the account, not a mode.

## 13. Safety & compliance workflows

- **Abuse patterns** (Phase 2 queries, no ML): mass outreach (interests/hour per
  recruiter), application spam, link-heavy new profiles, repeated-report targets,
  re-registration after suspension (email/handle similarity — `FUTURE`).
- **Block/mute:** when the user-facing feature ships, admin gets read visibility
  (block counts as a signal on the user drawer) — admin does not create blocks.
- **Deletion/compliance:** request queue → identity verification of requester → grace
  period → anonymize (reports/audit keep pseudonymous refs; counterparty conversations
  keep redacted placeholders) → purge log. All `FUTURE`; the panel shows the planned
  pipeline as a disabled section so it stays on the roadmap.
- **Appeals:** `FUTURE`; design constraint now = every enforcement action already stores
  actor/reason/evidence, which is what an appeal review needs.

## 14. Admin roles & permissions

Ship Phase 1 on the existing single `ADMIN` boolean. Design (and document in code
comments) the target matrix so RBAC can be added without IA changes — each module action
maps to a permission key:

| Permission | Owner | Admin | Moderator | Support | Analyst |
| --- | --- | --- | --- | --- | --- |
| view.overview / view.queues | ✓ | ✓ | ✓ | ✓ | ✓ |
| reports.resolve (dismiss/pause/hide) | ✓ | ✓ | ✓ | — | — |
| verification.decide / revoke | ✓ | ✓ | ✓ | — | — |
| users.view detail | ✓ | ✓ | ✓ | ✓ | read-only |
| users.suspend | ✓ | ✓ | — | — | — |
| conversations.tier2 (reported content) | ✓ | ✓ | ✓ (logged) | — | — |
| listings.state (pause/hide/close) | ✓ | ✓ | ✓ | — | — |
| platform.notices / entitlements | ✓ | ✓ | — | — | — |
| compliance.deletion | ✓ | ✓ | — | — | — |
| admin.manage-roles | ✓ | — | — | — | — |
| audit.view | ✓ | ✓ | ✓ | ✓ | ✓ |

Mechanism when needed: a `permissions` claim resolved server-side per route (extend
`require_admin` → `require_permission("reports.resolve")`), roles as presets. Until a
second operator exists this table is documentation, not code.

## 15. Audit log plan

**Model `AdminAuditLog`** (append-only; the first thing built):

```
id UUID · actor_user_id FK · action String(64) (e.g. report.hide_listing,
identity.approve, user.suspend, job.state.pause, conversation.view_reported)
· target_type String(64) · target_id String(64) · target_label String(255)
(human-readable at write time: "Job — 'Shorts editor for…'")
· before_json / after_json (state diff where applicable)
· justification Text (REQUIRED for destructive/privacy actions; UI enforces)
· report_id FK nullable (the report that legitimized the action, esp. Tier-2 views)
· request_id String · created_at
```

Rules: written in the same transaction as the action; **no update/delete path** in ORM or
API (and revoke DB `UPDATE/DELETE` on the table for the app role when Postgres);
Tier-2 conversation *views* are logged, not just mutations; the implicit admin-override
paths (§3.2) are refactored to audited admin endpoints — until then, any override use is
interim-logged via the same helper. UI: `/admin/audit` filterable timeline + entry drawer
with diff. Retention: indefinite (it *is* the accountability record); compliance
anonymization replaces user references with pseudonyms rather than deleting entries.

## 16. Design principles & UI direction

**Feel:** the public product's dark, premium calm — tightened for operators. Denser type,
tabular data, zero decoration. It should read as "mission control for a product that
cares", never as a bootstrapped admin template.

Concrete direction (referencing existing tokens/components so the builder matches the
system):

- **Canvas:** `bg-[#0b0b0f]`; surfaces `bg-white/[0.03–0.05]` with `border-white/[0.06–0.1]`;
  overlays `#131419/95 + backdrop-blur` (the bulk-bar/dock treatment). Radii step down
  from the public 24–28px to **rounded-2xl (16px)** for admin density; tables use
  rounded-xl rows.
- **Type scale:** 13px primary row text, 11px meta, tracked-caps 10–11px section labels
  (the Pipeline heading pattern), `tabular-nums` for counts (per `StatRow`).
- **New primitives** (build once in `components/admin/`):
  1. `AdminTable` — sticky header, dense rows (h-12), hover elevation, row → drawer,
     checkbox column for bulk actions (reuse the Pipeline bulk-bar pattern), empty state
     via `StateCard`, skeleton rows for loading.
  2. `DetailDrawer` — right side sheet, `w-[clamp(380px,32vw,480px)]`, same surface as the
     chat dock, sections: snapshot card → context → actions → history. Keeps the queue
     visible; Esc closes; focus-trapped.
  3. `FilterBar` — search input (h-8, the Pipeline search style) + filter chips
     (funnel-chip pattern: dot + label + count) + sort select + active-filter clear.
  4. `Paginator` — quiet "1–50 of 214 · Prev/Next", 11px.
- **Reused:** `PageHeader` (eyebrow "Admin"), `StateCard`, `ConfirmDialog` (destructive
  confirms gain a required justification textarea), `AnchoredGlassPopover` (row overflow
  menus), StatusPill tones extracted from `SettingsClient` (active=emerald,
  danger=rose, future=dim, neutral); `DisabledFutureRow` pattern for `Planned` modules.
- **Status colors** map to existing conventions: open/new = white dot, pending = amber,
  verified/resolved-good = emerald, hidden/rejected = rose (subdued /80 opacities),
  archived/dismissed = white/35.
- **Priority indicators:** 1.5px colored left-edge on queue rows (rose=high, amber=medium,
  none=normal) — visible in scan, silent otherwise.
- **Environment banner:** thin amber strip when `app_env !== "production"` ("Development
  environment — seeded data"); the mock/backend switch stays visible for admins in dev.
- **States:** every list has loading skeletons, an error card with retry (no silent
  empty-on-error — the current moderation page's flaw), and designed empty states
  ("Queue clear. Nothing waiting on you.").
- **Responsive:** desktop-first (operators), functional at 1024px (drawer becomes
  full-height overlay), readable read-only at tablet. No mobile optimization target.
- **Accessibility:** tables with real `<table>` semantics or ARIA grid, drawer focus
  management, keyboard row navigation (↑/↓ + Enter to open, common actions as buttons not
  hover-only), WCAG-AA contrast on the muted text ramps (check white/45+ on the dark
  canvas), `prefers-reduced-motion` respected.

## 17. Implementation phases

### Phase 1 — Pre-beta MVP (the next implementation pass)

Goal: the founder can run daily moderation entirely in the panel.

Backend: `AdminAuditLog` model + migration · `routers/admin.py` with overview counts,
users list/detail, jobs/talent admin lists + audited state actions, reports v2
(pagination/filters/hydration/enum enforcement/profile handling) · `is_verified`
hardening · admin-minting script · tests (403s for non-admin, action side effects, audit
rows written).
Frontend: `/admin` shell (session gate + nav + env banner) · Overview (action-queue strip,
health) · Reports queue with drawer + triage actions · Users directory + drawer
(read-only + links) · Jobs/Talent lists with pause/hide/close · Audit log view ·
`Planned` states for Verification/Conversations/Platform/Compliance · header account-menu
"Admin" entry (capability-gated) · e2e with `dev-admin` persona + `reports` seed.
**MVP cut line:** no suspension, no verification decisions, no message content, no
broadcast — those are visible but `Planned`.

### Phase 2 — Beta operations

Verification queue + approve/reject/revoke (manual review live) · User suspension model +
enforcement + panel actions · report reason picker + note for end users (+ profile report
UI) · Conversations Tier-1 metadata + abuse-pattern saved views · platform notices via
the notification pipeline · entitlements admin list · report reopen + reporter-outcome
notice · dev utilities for generating test reports/verifications.

### Phase 3 — Mature platform

RBAC (permission keys → roles, `require_permission`) · message reporting + Tier-2/Tier-3
message moderation · compliance pipeline (deletion/export/retention) · appeals · block/
mute visibility · analytics beyond operational counts · payment/entitlement disputes ·
assignee/SLA tracking in the reports queue.

**Full scope** = §7 with every flag green. **MVP scope** = Phase 1 exactly.

## 18. Testing & QA plan

- **Backend (pytest, `APP_ENV=test`):** non-admin → 403 on every `/admin/*` route; admin
  persona passes; reports v2 pagination/filtering; action side effects (pause/hide flip
  listing state; enum rejection of unknown actions; profile-target no-op); every mutation
  writes exactly one correct `AdminAuditLog` row (actor/target/before/after); suspended
  users rejected at auth (Phase 2); `is_verified` cannot be client-set.
- **E2E (Playwright, mock-mode server):** sign in as non-admin → `/admin` 404s; seed
  `reports` scenario + `dev-admin` persona → queue shows 2 reports → drawer → hide →
  listing disappears from public list → audit entry visible; overview counts render;
  `Planned` modules render disabled (not broken); no horizontal overflow at 1280/1024.
- **Regression guards:** public marketplace unaffected by admin routes; existing
  `/admin/moderation` redirects into the new shell (or is removed with the shell).
- **Manual QA checklist:** dark-theme contrast pass on dense tables; drawer keyboard trap;
  destructive-confirm justification required; env banner only outside production.

## 19. Known gaps & open product decisions

1. **Admin minting** — confirm the procedure (script vs data migration) and who holds
   production DB access. (Blocker for using the panel in production at all.)
2. **Anonymous reports** — keep allowing? Recommendation: yes at beta (rate-limited), but
   anonymous reports never auto-raise priority and the queue labels them clearly.
3. **Conversation privacy policy** — sign off on the three-tier disclosure model (§7.6)
   and the "views are logged" rule *before* Tier 2 is built; also whether the privacy
   policy must disclose moderation access to reported messages (likely yes).
4. **Suspension vs deactivation semantics** — suspension (admin, reversible, content
   hidden) vs deactivation (user-initiated, `FUTURE`) vs deletion (compliance). Agree
   definitions before the Phase-2 migration.
5. **`hiring_verification_status` on User vs `HiringIdentity.verification_status`** — two
   sources of truth today; recommend deriving the user-level value (or dropping it) during
   verification work.
6. **Reporter feedback** — notify reporters of outcomes? (Trust-building but requires the
   notice channel; recommended Phase 2.)
7. **Talent-side verification** — does the trust program ever cover talent
   listings/portfolios? Affects §7.5 columns and badge design.
8. **Legacy `/admin/moderation`** — replace-and-redirect vs keep during transition
   (recommend: redirect into the new Reports section in Phase 1).
9. **Budget-outlier thresholds** — heuristic values (₹ floor, p95 ceiling) need a real
   decision once live data exists.
10. **Escalation destination pre-RBAC** — with one operator, "escalate" is a starred
    state, not a handoff; confirm that's acceptable for beta.

## 20. Using the admin panel (operator guide, once Phase 1 ships)

- **Open:** `/admin` (visible in your account menu only as an ADMIN; direct URL 404s for
  everyone else). In dev, use the Dev tools panel → persona `dev-admin`, and seed
  `reports`/`full_demo` for data.
- **Daily loop (5–15 min at beta):** Overview → clear the **Reports** queue oldest-first
  (drawer → check target + sibling reports → act with a note) → check **Verification**
  pending (Phase 2) → skim **new users/listings** (7-day filters) for obvious spam.
- **Support ticket:** Users → search email → drawer answers most questions (listing
  states, application record, verification, notification trail). Deep links jump to the
  public pages.
- **Trust decisions:** always from the drawer, always with a justification — everything
  you do is in **Audit log**, which is also where *you* verify what happened last week.
- **What not to rely on yet:** any module badged `Planned` is honest UI over missing
  backend — statuses in §8 are the truth table. Dev tools section only exists in
  development.
