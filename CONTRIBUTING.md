# Working on CreatorJobs

Start with [architecture](docs/ARCHITECTURE.md), [local setup](docs/local-auth-testing.md),
and the [current handoff](docs/PRODUCTION_READINESS_HANDOFF.md). Public visibility
does not grant a new open-source license or permission to change hosted services.

## Change scope

- Keep changes coherent; preserve canonical posting/application/messaging/profile
  contracts and Backend/Mock parity.
- Explain the problem, intended behavior, affected roles, and compatibility risk.
- Keep unrelated refactors separate; preserve accepted history.
- Use committed lockfiles. Upgrade dependencies for an identified reason with
  migration notes and focused validation.
- Use additive, tested migrations with coherent model/API/client transitions.

## Before a commit or pull request

1. Add a regression test for a defect and reproduce the original failure.
2. Run focused and risk-appropriate broader [checks](README.md#validation).
3. Review the complete diff and run `git diff --check`.
4. Stage explicit files; exclude credentials, real data, databases, and local reports.
5. Record exact results including skips and external limitations. Do not weaken
   assertions, add arbitrary sleeps, or hide exceptions to pass tests.
6. Update the ledger/handoff for readiness work.

Backend tests share disposable state within a run; do not start concurrent pytest
processes against that database. Browser suites share `.next` and ports; run them
serially. PostgreSQL proof requires the owned disposable harness, not SQLite or
a production database.

## Safety

Code work does not imply permission to deploy, use production credentials, mutate
hosted data, run paid providers, or change recovery references. Never enable dev
personas, mock data, or email-link capture for customers. Preserve the frozen refs
listed in the handoff. Report vulnerabilities through [SECURITY.md](SECURITY.md).
