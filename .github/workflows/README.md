# CI workflows — what they prove, and what they do not

## Evidence status

**IMPLEMENTED.** `ci.yml` and `security.yml` encode the release gates this
repository requires. Every command they invoke exists here — nothing was
invented to make a workflow look complete.

**LOCALLY VALIDATED.** Both files parse as YAML, every job has steps, every
referenced script exists in `package.json` or `backend/scripts/`, and each gate
has been run locally on this machine where the local environment supports it.

**NOT REMOTELY EXECUTED.** No GitHub-hosted runner has ever run these
workflows, because nothing has been pushed and remote execution is not
authorised. Tracked as `BLOCKED_EXTERNAL` under `RELEASE-001`.

That distinction matters more than it looks. A workflow can be structurally
valid, invoke real commands, and still fail on a fresh runner — a missing system
package, a service container that binds differently, a browser dependency that
is present locally and absent there. **Do not describe these workflows as
passing.** They are written and locally exercised; the first real run will be the
first real run.

## Job boundaries follow state, not speed

Two backend pytest processes sharing a database produce failures that describe
the harness rather than the product, and this repository has already lost time
to exactly that. So:

- `backend` and `backend-postgres` are separate jobs on separate runners, each
  with its own disposable database. Parallel is safe because nothing is shared.
- Inside `browser`, the standard, QA, and cross-browser accessibility Playwright
  suites run **sequentially**. They build from the same `.next` directory and
  the QA suite binds fixed ports. Running them together would be faster and the
  evidence would be worthless.

Speed is never worth invalid evidence.

## Why the PostgreSQL job exists

Several behaviours cannot fail on SQLite: row locking, `SKIP LOCKED`, and the
atomic claims in the AI import queue and the notification quota. Their tests pass
under SQLite even when rewritten as a read-then-write race — this is documented,
and it is why those suites have structural tests as well.

The `backend-postgres` job runs the migration sequence the local harness runs
(up, down to the pre-interaction revision, seed legacy rows, up again), because a
fresh-database upgrade cannot show that a migration works on data that existed
before it.

**Important:** the workflow containing PostgreSQL is not the same as empirical
PostgreSQL proof. Those concurrency blockers close when the job actually runs
green on a real runner, not when it is written.

## Artifacts

Uploaded: backend and PostgreSQL `junit-*.xml`, Playwright reports and traces,
SBOMs, and release-keyed private source maps. The source-map artifact is kept
for 30 days and contains application source, so it follows repository artifact
access; `build:release` removes every client map and map hint from `.next/static`
before the runtime can ship.

The junit files are uploaded on success as well as failure, deliberately. A suite
that silently loses tests still passes, so the collected count is evidence even
when everything is green — and this repository has had a file overwritten,
removing 47 tests without a single failure.

Never uploaded: `.env`, database files, credentials, environment dumps. An
artifact is downloadable by anyone who can read the run.

## Dependency audits

`npm audit --omit=dev` and a pinned `pip-audit` against requirements exported
from the locked `--no-dev` production set. The backend gate does not audit the
active developer environment: doing that reports advisories for pytest and
Pygments, which never ship, and can miss what does ship if the two sets have
drifted. Its one analysed exception is exact by package, version, and all known
advisory aliases; it fails if the finding changes or disappears. The exception
is backed by the enforced HMAC-only JWT configuration, not by a severity
threshold or a blanket ignore flag.

## What is still external

- GitHub-hosted execution of any of this (`RELEASE-001`).
- Branch protection and required-check configuration — repository settings, not
  files.
- The Docker image build and vulnerability scan; only source-level container
  assertions run here.
