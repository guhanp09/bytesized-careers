# CreatorJobs

A full-stack hiring marketplace for the creator economy: creators and hiring teams
find talent, freelancers showcase their work, and both sides manage applications
and conversations in one workspace.

Built with **Next.js, React, TypeScript, FastAPI, SQLAlchemy, and PostgreSQL**.

**Status:** pre-launch, under active production hardening. This is a working
engineering portfolio, **not a claim that the service is ready for real customers**.
Release assessment: `NO-GO`. Remaining implementation and launch gates are tracked
in the [execution ledger](docs/PRODUCTION_READINESS_EXECUTION.md).

## Start here

- **Reviewing the project?** The [reviewer guide](docs/REVIEWER_GUIDE.md) connects
  product workflows to source, tests, and development history.
- **Running it?** The [local setup guide](docs/local-auth-testing.md) supports a
  real-backend email/password demo without paid providers or hosted credentials.
- **Understanding it?** Read the [architecture guide](docs/ARCHITECTURE.md).
- **Continuing development?** See [contributing](CONTRIBUTING.md), the
  [documentation index](docs/README.md), and the [handoff](docs/PRODUCTION_READINESS_HANDOFF.md).

## Product workflows

| Audience | Implemented workflows |
| --- | --- |
| Recruiters, creators, agencies | Multi-step job posting, recoverable drafts, screening questions, talent discovery, saved items, applicant management |
| Talent | Public profiles, portfolio projects, job discovery, applications, saved jobs, application history |
| Both sides | Conversations, Pipeline status changes, interview coordination, private notes, notifications, engagement/review workflows |
| Administrators | Strong-authentication controls, reports, moderation, audit records, compliance primitives |
| AI-assisted posting | Text/URL extraction into a private draft, field review, and the canonical Post Job flow—never automatic publication |

These capabilities are implemented, not universally launch-certified. Durable AI
execution, browser credential isolation, production storage/shared realtime, and
complete invite/privacy customer journeys still have open work. Manual posting
and application workflows do not depend on an AI provider.

## AI capabilities: implemented and planned

### Implemented in the application

- **AI Job Import:** turn pasted job text or a supported public job URL into
  structured fields for a private draft. Source evidence, contextual inference,
  missing information, and conflicting values remain distinguishable.
- **Draft Assistant (Bea):** clarify unresolved details one question at a time,
  save answers for resumption, and hand off to the existing Post Job editor.
  Recruiters can edit or continue manually; importing never publishes a job.
- **Brand-description enrichment:** optionally fill an empty company/channel
  About field using existing descriptions or source-grounded website summaries.
  Identity/evidence checks and stale-result guards protect recruiter-written text.

These are implemented capabilities, **not a production-readiness certificate**.
Provider calls require configured access and can incur costs. Import safeguards
already include authentication, bounded fetching, quotas, retry limits, and a
server-side pause gate; durable execution and complete shared cost controls remain
unfinished. The clarification flow uses server-owned rules, not an unrestricted chatbot.

### Planned, not yet implemented

- **Recruiter assistance:** job-brief clarity review, missing-information prompts,
  suggested screening questions, and side-by-side edits requiring approval.
- **Talent assistance:** application clarity suggestions, portfolio-description
  editing, and unanswered-question prompts using only user-selected facts.
- **Production completion:** durable workers, progress/cancellation, atomic spending
  reservations, and coordinated worker/admission controls before wider AI use.

Future assistance is opt-in, separately budgeted, and human-reviewed—not automatic
applications, messages, publishing, candidate ranking, or hiring decisions. See the
[AI feature guide](docs/AI_FEATURES.md) for source/test evidence and the
[release and feature roadmap](docs/PRODUCTION_RELEASE_ROADMAP.md) for dependencies.

## Early access companion site

The public [ByteSized Careers early-access page](https://bytesizedcareers.com/early-access)
collects interest from people seeking work, hiring talent, or doing both. It is a
**separate waitlist application**, not a live demonstration of the full marketplace
or an automatic marketplace account/invitation.

Its source lives in the separate, private `bytesized-careers-waitlist` repository;
it is not bundled here. The [early-access project note](docs/EARLY_ACCESS.md) explains
its flow, architecture, and separation from this project. Subscriber data and
credentials are not included in this public repository.

## Architecture at a glance

```text
Browser
  └─ Next.js App Router — pages, forms, server routes, NextAuth
       └─ FastAPI /api/v1 — authorization and domain rules
            ├─ Services → repositories → SQLAlchemy → PostgreSQL
            ├─ Email outbox → delivery worker → provider
            ├─ Private AI import state → reviewed canonical draft
            └─ Realtime events → database-backed HTTP reconciliation

Local review: disposable SQLite + deterministic scenarios + test providers
```

This shows responsibilities, not a completed server-only browser authentication
migration: some browser API consumers still use backend access tokens (`AUTH-007`).
Persistent import state exists, but the durable execution worker remains open
(`AI-001`). See [architecture and tradeoffs](docs/ARCHITECTURE.md).

## Repository map

| Path | Responsibility |
| --- | --- |
| [`app/`](app/) | Next.js pages, layouts, server routes, metadata, loading/error states |
| [`components/`](components/) | Posting, discovery, profiles, applications, messaging UI |
| [`lib/`](lib/) | Typed API access, frontend contracts, validation, drafts, scenario adapters |
| [`backend/app/`](backend/app/) | API routers, schemas, domain services, persistence, security |
| [`backend/alembic/`](backend/alembic/) | Versioned database migrations |
| [`tests/`](tests/) | Node unit/contract tests and Playwright browser/real-backend QA |
| [`backend/tests/`](backend/tests/) | Backend API, security, migration, concurrency tests |
| [`fixtures/creator_scenarios/`](fixtures/creator_scenarios/) | Deterministic scenarios for mock/backend parity |
| [`scripts/`](scripts/) and [`backend/scripts/`](backend/scripts/) | Development, validation, release, operational exercises |
| [`.github/workflows/`](.github/workflows/) | CI/security checks and their evidence limitations |
| [`docs/`](docs/) | Architecture, reviewer guide, operations, readiness program |
| [`reference-homepage/`](reference-homepage/) | Historical design reference; not the main application runtime |

## Local development

Use **Node.js 24**, **Python 3.12**, and **uv**. Install from the committed
`package-lock.json` and `backend/uv.lock`.

```bash
# From a fresh clone
npm ci
cp -n .env.example .env.local
npx prisma generate
cd backend
uv sync --locked --all-groups
cp -n .env.example .env
```

Follow the [two-terminal setup](docs/local-auth-testing.md) to start the backend
and frontend, seed demonstration data, and verify a local account through
`/dev/emails`. The backend template's `postgres` hostname is for Docker; the local
walkthrough explicitly uses SQLite. Demo accounts are synthetic, not customers.

## Validation

```bash
# Repository root
npx tsc --noEmit
npm run lint
node --test --experimental-strip-types tests/*.test.mjs
npm run build:release

# From backend/
APP_ENV=test DATABASE_URL=sqlite+aiosqlite:///:memory: .venv/bin/python -m pytest
.venv/bin/ruff check app tests
APP_ENV=test DATABASE_URL=sqlite+aiosqlite:///:memory: .venv/bin/python -m alembic heads
```

The backend suite uses its own disposable SQLite test database through conftest;
the explicit URL also protects application bootstrap from inheriting a hosted DB.
SQLite is **not** PostgreSQL locking/migration proof. Those gates use the separate
[disposable harness](backend/scripts/test_interaction_status_postgres.sh).

Browser suites share `.next`; run them **sequentially**:

```bash
npx playwright install
npm run test:e2e
npm run test:e2e:qa
npm run test:e2e:a11y
```

Dated results and limitations are in the [publication checkpoint](docs/PORTFOLIO_PUBLICATION.md)
and [engineering handoff](docs/PRODUCTION_READINESS_HANDOFF.md). A workflow file is
not proof of a green hosted run. No unsupported customer, uptime, or capacity
claim is made here.

## Security and project status

Public eligibility checks cover suspension and deletion hiding while preserving
authorized private history. Disabled production email **pauses** delivery; it
cannot become mock success. Development personas and email links are not production
features. Provider keys and real data stay outside source control.

See [security reporting](SECURITY.md) and the [R0–R11 release roadmap](docs/PRODUCTION_RELEASE_ROADMAP.md).
F1–F7 are optional recruiter/talent improvements, not claims of shipped features.

## History and attribution

Maintained by **Guhan Purushothaman**. The actual development history is preserved.
Evaluate the code, tests, decisions, and limitations alongside the commit history.

No open-source license has been selected by this publication step. Publication
does not relicense third-party dependencies, reference material, or assets.
