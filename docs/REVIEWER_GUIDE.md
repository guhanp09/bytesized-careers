# Reviewer guide

CreatorJobs is a two-sided marketplace maintained by Guhan Purushothaman. This
repository makes its source, tests, migrations, tradeoffs, and development history
inspectable. It does not claim production customers, revenue, or capacity certification.

## A ten-minute reading path

1. Read the [overview](../README.md) and [architecture](ARCHITECTURE.md).
2. Follow one job/application/conversation from component to API, service, and tests.
3. Review a security repair and its regression evidence below.
4. Inspect the [ledger](PRODUCTION_READINESS_EXECUTION.md) and
   [handoff](PRODUCTION_READINESS_HANDOFF.md) for unfinished work.

## Representative work

| Area | Source | Tests/evidence |
| --- | --- | --- |
| Posting and reviewed AI drafts | [`PostJobPage.tsx`](../components/PostJobPage.tsx), [`job_import_service.py`](../backend/app/services/job_import_service.py) | [`integratedImportSearchRelease.test.mjs`](../tests/integratedImportSearchRelease.test.mjs), [`test_job_import_readiness.py`](../backend/tests/test_job_import_readiness.py) |
| Two-party applications/messages | [`messaging_service.py`](../backend/app/services/messaging_service.py), [`ApplicationsWorkspace.tsx`](../components/you/ApplicationsWorkspace.tsx) | [`test_application_end_to_end.py`](../backend/tests/test_application_end_to_end.py), [`test_messaging.py`](../backend/tests/test_messaging.py) |
| Shared visibility policy | [`account_state.py`](../backend/app/core/account_state.py), [`public_visibility.py`](../backend/app/repositories/public_visibility.py) | [`test_public_account_visibility.py`](../backend/tests/test_public_account_visibility.py) |
| Email pause and durable intent | [`notifications/`](../backend/app/notifications/), [email architecture](NOTIFICATIONS.md) | [`test_email_production_pause.py`](../backend/tests/test_email_production_pause.py), [`test_email_outbox_worker.py`](../backend/tests/test_email_outbox_worker.py) |
| Reproducible checks | [CI workflows](../.github/workflows/), [migration harness](../backend/scripts/test_interaction_status_postgres.sh) | [CI evidence limitations](../.github/workflows/README.md), [publication checkpoint](PORTFOLIO_PUBLICATION.md) |

Commit `b675235` fixes public browse/search visibility for deletion-hidden accounts
while retaining authorized private history. Its tests reproduced the original defect.
Commit `28f9695` prevents disabled production email from consuming rows through mock
success, with pause/resume and last-send-boundary tests. Neither change is relabeled
as a complete production release.

## Local product walkthrough

Follow [local setup](local-auth-testing.md) using synthetic data. Core workflows
need no paid provider or hosted change.

1. Browse `/jobs`, `/talent`, and `/search`; open listing/profile details.
2. Register separate recruiter and talent accounts in two browser profiles.
   Verify each through the development-only `/dev/emails` page.
3. As recruiter, create a job at `/post-job`, complete required fields/screening,
   review the draft, and explicitly publish.
4. As talent, submit that job's **internal** application. An external-link click
   is not a submitted application.
5. Inspect both participants' applications workspace, submitted answers,
   conversation, and recruiter Pipeline.
6. Edit a profile/portfolio, save a listing, and inspect the workspace state.

AI processing can incur charges. Without configured provider access, demonstrate
manual posting and inspect deterministic import tests; never label a fixture a live
model result. The QA suite has controlled multi-role personas in its isolated local
harness, not a public login backdoor. Do not expose it on the internet.

## Verify history

```bash
git log --graph --oneline --decorate -30
git show b675235 --stat
git show 28f9695 --stat
git log --oneline -- backend/app/services/messaging_service.py
git log --oneline -- backend/alembic/versions
```

All local branches were ancestors of the integration branch at publication
preparation. Publishing that history preserves accepted work without making
recovery/experimental branch names the main review experience. Commit metadata
supports inspection; discussion of design decisions remains important for assessing
an author's contribution.

## Limitations

The service is `NO-GO` for real-customer launch. Browser token isolation, complete
invite/privacy journeys, worker reliability, production storage/shared realtime,
capacity/recovery evidence, and operational/legal gates remain open. The ledger,
not this abbreviated list, is authoritative. F1–F7 are proposed additions, not
existing feature claims.
