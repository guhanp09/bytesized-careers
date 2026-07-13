# CreatorJobs QA Persona Testing Guide

This guide explains how to test CreatorJobs as several real persisted users on
one local machine. It is written for someone who is new to development.

The QA workspace is not mock mode. Every action uses the FastAPI backend and a
disposable local SQLite database. Nothing in this guide connects to Vercel,
Render, Neon, or another hosted service.

## What The System Does

An authorized controller signs in normally, opens the `QA personas` control,
and temporarily acts as one deterministic user. The encrypted NextAuth session
keeps the original controller identity so `Return to Guhan` does not require a
second login.

The backend is the authority:

- the feature must be explicitly enabled in both frontend and backend
- only `staging` and isolated `test` environments are accepted
- production is always refused
- the controller email must be allowlisted
- only registered deterministic persona keys can be selected
- persona tokens are short lived and have no refresh token
- an exited persona session is revoked immediately
- switches, exits, restores, and successful persona writes are audit logged
- request bodies, passwords, and tokens are not written to the QA audit log

## Fastest Automated Check

From the repository root, run:

```bash
npm run test:e2e:qa
```

This command starts a disposable local backend on port 8100 and a production
Next.js build on port 3200. It creates the controller and all fixtures, runs the
browser workflows, then stops both servers.

The database is `backend/.local-data/qa-playwright.db`. The startup script drops
and recreates only a SQLite database whose URL contains `qa-playwright`.

## Interactive Local Setup

Use this when you want to click through the product yourself.

### Terminal 1: start the disposable backend

Open Terminal, then paste:

```bash
cd /Users/guhanpurushothaman/creator-jobs-phase1/backend
APP_ENV=test \
ENABLE_QA_PERSONA_SWITCHER=true \
QA_PERSONA_CONTROLLER_EMAILS=qa-controller@example.com \
QA_PERSONA_ACCESS_TOKEN_MINUTES=30 \
QA_TEST_CONTROLLER_EMAIL=qa-controller@example.com \
QA_TEST_CONTROLLER_PASSWORD='LocalQaController123!' \
DATABASE_URL=sqlite+aiosqlite:///./.local-data/qa-playwright-manual.db \
CORS_ORIGINS='["http://127.0.0.1:3200"]' \
MEDIA_ROOT=.local-data/qa-playwright-manual-media \
PORT=8100 \
.venv/bin/python scripts/start_qa_test_server.py
```

Leave that Terminal window open. The script refuses non-test environments,
non-SQLite databases, and database paths without `qa-playwright`.

### Terminal 2: start the frontend

Open a second Terminal window, then paste:

```bash
cd /Users/guhanpurushothaman/creator-jobs-phase1
APP_ENV=test \
NEXT_PUBLIC_APP_ENV=test \
ENABLE_QA_PERSONA_SWITCHER=true \
NEXT_PUBLIC_USE_LOCAL_MOCKS=false \
NEXT_PUBLIC_ENABLE_DEV_DATA_SWITCH=false \
NEXT_PUBLIC_ENABLE_EMAIL_AUTH=true \
NEXTAUTH_URL=http://127.0.0.1:3200 \
NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3200 \
NEXTAUTH_SECRET=qa-manual-local-secret \
BACKEND_URL=http://127.0.0.1:8100/api/v1 \
NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8100/api/v1 \
DATABASE_URL=file:./qa-playwright-manual-prisma.db \
npm run dev -- --hostname 127.0.0.1 --port 3200
```

Leave this Terminal window open too.

### Sign in as the local controller

1. Open `http://127.0.0.1:3200/auth?mode=login` in Chrome.
2. Enter email `qa-controller@example.com`.
3. Enter password `LocalQaController123!`.
4. Click `Log in`.
5. Look for the small `QA personas` control near the lower-left corner.

These credentials belong only to the disposable local test harness. They are
not staging credentials and are never configured on hosted services.

## Using The QA Drawer

The drawer has four views:

- **Personas:** select the user whose permissions and data you want to use.
- **Scenarios:** restore one deterministic group of records.
- **Guide:** open the recommended product surface for common handoffs.
- **System:** confirm environment, controller, persona count, and fixture health.

When switched, the control reads `QA · <name>`. All product API calls now use
that persisted user's authorization. Click `Return to Guhan` before restoring a
scenario or beginning a different workflow when you want a clear mental reset.

Entering `QA Moderator` requires an additional confirmation.

## Persona Catalogue

| Persona | Modes | Best used for |
| --- | --- | --- |
| Dev New User | Talent | Empty profile, no portfolio, no listings, onboarding and genuine empty states |
| Priya Nair | Talent | Complete profile, portfolio links, applications, saved jobs, received requests |
| Rohan Das | Talent | Incomplete profile, checklist gaps, start/completion engagement handoffs |
| Finance Simplified | Hiring | Verified identity, published jobs, applicants, outreach, notes, engagements |
| BrightLab Media | Hiring/agency | Drafts and represented identity verification states |
| Aditi Verma | Talent and Hiring | Mode switching, received application and received hiring request |
| Kabir Sethi | Talent | Notifications, lifecycle variants, blind and published reviews |
| QA Moderator | Admin | Reports, hidden reviews, suspended fixture, reversible moderation |

Non-switchable fixtures also cover a suspended user, a hidden listing, a hidden
review, and a review whose author is represented as `Former collaborator`.

## Scenario Restore Packs

Restore is intentionally explicit. Select a scenario, click `Restore`, type the
exact phrase, then confirm.

| Pack | Confirmation phrase | Restores |
| --- | --- | --- |
| Profiles and empty states | `RESTORE PROFILES` | Complete, incomplete, both-mode, empty, admin, and suspended profiles |
| Listings and drafts | `RESTORE LISTINGS` | Published, draft, blocked, and paused job/talent listings |
| Applications | `RESTORE APPLICATIONS` | First-message variants and recruiter application stages |
| Hiring requests | `RESTORE REQUESTS` | Recruiter outreach and all talent-side request stages |
| Inbox and pipeline | `RESTORE INBOX` | Applications, outreach, messages, unread state, notes, and lifecycle events |
| Engagements and reviews | `RESTORE REVIEWS` | Start, active, completion, cancellation, blind, hidden, and published reviews |
| Saved items and notifications | `RESTORE SAVED` | Saved jobs, saved talent, and read/unread notifications |
| Verification and moderation | `RESTORE MODERATION` | Agency identities, reports, suspension, and review moderation |
| Full QA baseline | `RESTORE ALL QA DATA` | Every deterministic QA fixture |

Restores use stable IDs, delete in dependency order, and recreate only QA-owned
records. They also clear transient Apply, Hire, status history, idempotency,
delivery intent, message, note, notification, and block data when both the actor
and listing are deterministic QA fixtures. An
ordinary user's records are preserved even when they relate to a seeded listing,
and all QA audit records remain. Running a pack twice is safe. A partially
completed earlier restore can be run again.

## Workflow 1: Application Handoff And Messaging

1. As controller, restore `Inbox and pipeline`.
2. Switch to `Finance Simplified`.
3. Open `/applications?view=pipeline&mode=recruiter&direction=received`.
4. Find Priya Nair under `Shortlisted`.
5. Move her to `Reviewing`. This is private pipeline organization, so no public
   status notice is required.
6. Click the message icon and send a short reply.
7. Return to controller, then switch to `Priya Nair`.
8. Open `/applications?view=pipeline&mode=talent&direction=sent`.
9. Confirm the finance editor application remains in `Pending`/`New`; the
   recruiter's internal Reviewing stage is private.
10. Switch to Inbox and open the same job. Confirm the recruiter message exists.

Expected result: one persisted application changes state and both participants
see the same persisted conversation. Internal labels remain role-appropriate.

## Workflow 2: Hiring Request Handoff

1. Restore `Hiring requests`.
2. Switch to `Aditi Verma`.
3. Open `/applications?view=pipeline&mode=talent&direction=received`.
4. Find the Finance Simplified request under `New`.
5. Move it to `Accepted` and confirm the consequential shared action.
6. Return to controller and switch to `Finance Simplified`.
7. Open `/applications?view=pipeline&mode=recruiter&direction=sent`.
8. Confirm Aditi appears in the Accepted stage.

Expected result: acceptance creates one idempotent engagement in
`Ready to start`; it is not only a visual stage change.

## Workflow 3: Start, Completion, And Blind Reviews

1. Restore `Engagements and reviews`.
2. Switch to `Finance Simplified` and open the Recruiter Inbox.
3. Open Rohan Das's long-form finance application.
4. Confirm its status says `Start confirmation pending` and click
   `Confirm start`. It should become `Work in progress`.
5. Open Rohan's gaming thumbnail application.
6. Confirm its status says `Completion confirmation pending` and click
   `Confirm outcome`.
7. Click `Leave feedback`, select an overall rating, add concise feedback, and
   submit. The feedback should say it is awaiting publication; Rohan's content
   must not be revealed.
8. Return to controller and switch to `Rohan Das`.
9. Open the same gaming thumbnail application from Talent -> Applications.
10. Submit Rohan's feedback for Finance Simplified.
11. Confirm the status changes to `Feedback published` only after the reciprocal
    submission.
12. Open the appropriate public profile review mode and confirm only published,
    moderation-visible reviews affect its count and average.

Expected result: recruitment status and engagement lifecycle stay separate;
reviews unlock only after mutually acknowledged work and completion.

## Workflow 4: Needs Attention

1. Restore `Engagements and reviews`.
2. Open Rohan's completion-pending application as Finance Simplified.
3. Click `Needs attention`.
4. Enter at least 10 characters explaining what is unresolved.
5. Click `Return to active`.

Expected result: the engagement returns to active, a private issue note appears
in the conversation timeline, and reviews remain locked.

## Workflow 5: Profiles, Portfolio, Saves, And Notifications

1. Restore `Profiles and empty states` and switch to `Dev New User`.
2. Check `/you`, `/saved`, `/notifications`, and `/drafts` for genuine empty
   states rather than load-error states.
3. Switch to Priya Nair and confirm her Talent profile and portfolio are complete.
4. Open portfolio items from profile/listing/application links. They should use
   the shared portfolio popup rather than a separate detail page.
5. Restore `Saved items and notifications`.
6. As Priya, inspect saved jobs. As Finance Simplified, inspect saved talent.
7. As Kabir Sethi, verify read and unread notification states.

## Workflow 6: Drafts And Verification

1. Restore `Listings and drafts`.
2. Switch to BrightLab Media.
3. Open `/drafts` and verify job and talent draft variants.
4. Open the hiring identity flow and inspect verified, pending, and failed
   represented-channel states.
5. Restore `Verification and moderation` when you need the baseline again.

## Workflow 7: Moderation

1. Restore `Verification and moderation`.
2. Switch to `QA Moderator` and accept the additional warning.
3. Open `/admin/reports`.
4. Verify review reports and deterministic moderation targets are present.
5. Hide/restore only deterministic review content and verify public aggregates
   update accordingly.
6. Confirm the suspended fixture cannot be selected as a persona.

## Permission And Failure Checks

Use these checks when changing auth or QA code:

- Sign out: the drawer must disappear and `/api/qa/*` must return 404.
- Sign in as an ordinary non-allowlisted user: the drawer must not render.
- Set `ENABLE_QA_PERSONA_SWITCHER=false` on the backend: old persona tokens must
  fail immediately.
- Remove the controller email from `QA_PERSONA_CONTROLLER_EMAILS`: switching and
  refresh must fail.
- Exit a persona and replay its old token: the revoked session must be rejected.
- Try an unknown persona key: the backend must reject it.
- Try a restore with the wrong phrase: no data should change.
- Intercept a QA catalogue request with a 500/503: the product remains usable and
  the drawer fails closed.
- Run any seed/restore with `APP_ENV=production`: it must refuse.

## Automated Coverage

The local suites cover:

- environment and controller allowlist gates
- production rejection and registered-key restriction
- short-lived access-only claims, refresh, exit, revocation, and expiry
- controller suspension/removal and successful write auditing
- fresh, repeated, partial, targeted, and complete restores
- preservation of non-QA users and audit rows
- deterministic foreign-key integrity and production seed refusal
- signed-out hiding, persona switching, return without re-login
- application and hiring-request handoffs with real persistence
- real messaging, pipeline stages, engagement start/completion, blind reviews
- moderator confirmation, scenario restore, mobile overflow, keyboard focus
- safe behavior when the QA catalogue is unavailable

Run all repository checks from the root:

```bash
npx tsc --noEmit
npm run lint
npm run build
node --test tests/*.test.mjs
cd backend && APP_ENV=test .venv/bin/python -m pytest
cd .. && npm run test:e2e:qa
```

The ordinary full Playwright suite is separate and may use its own local mock
harness. The QA suite is the one that proves real backend persona persistence.

## Future Hosted Staging Setup (Not Applied)

No environment variables in this section have been applied to Vercel, Render,
or Neon by this implementation.

Future Render staging values:

```env
APP_ENV=staging
ENABLE_QA_PERSONA_SWITCHER=true
QA_PERSONA_CONTROLLER_EMAILS=your-authorized-google-account@example.com
QA_PERSONA_ACCESS_TOKEN_MINUTES=30
```

Future Vercel staging values:

```env
APP_ENV=staging
NEXT_PUBLIC_APP_ENV=staging
ENABLE_QA_PERSONA_SWITCHER=true
NEXT_PUBLIC_USE_LOCAL_MOCKS=false
```

Use a normally authenticated Google account as the controller. Do not share a
persona password and do not expose the drawer to investors by default.

## Emergency Disable

Locally, stop both Terminal processes with `Control+C`, or restart with
`ENABLE_QA_PERSONA_SWITCHER=false`.

On future hosted staging:

1. Disable the backend flag first and redeploy Render.
2. Disable the frontend flag and redeploy Vercel.
3. Remove the controller email from the backend allowlist if access itself is in
   question.

Production has a hard code-level denial in addition to these operational flags.
