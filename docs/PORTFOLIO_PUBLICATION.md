# Public repository publication checkpoint

Prepared 2026-09-24. Requested destination: a **new public repository named
`bytesized-careers`**. The application keeps its existing CreatorJobs name; this
task does not authorize a product rebrand or deployment.

## Publication status

**LOCAL CHECKPOINT — push verification follows.** Authentication is now confirmed
as `guhanp09` through GitHub CLI, including repository/workflow scopes. The user
explicitly authorized creating public `guhanp09/bytesized-careers`, pushing all
legitimate source/history, and connecting the current local branch to it. The new
name was confirmed absent before creation. Existing `origin` remains
`guhanp09/skizh`; no write to that remote is authorized. This checkpoint does not
yet claim an uploaded repository or successful hosted CI run.

A separate process created commit `68403a7` (`first commit`) during preparation,
containing the initial documentation, scanner configuration, and two search-test
updates. It has been preserved, not amended/rebased. The subsequent explicit
instruction to continue publication supplies authority for the next local
checkpoint. Its contents match the preparation files; no unrecognized overlapping
edits remain.

## What “all work” means here

- Publish the complete tracked project: frontend, backend, migrations, fixtures,
  assets, tests, scripts, workflows, and documentation.
- Preserve the original reachable commit history. At starting commit `28f9695`,
  it contained 442 commits; **every local branch was already an ancestor**.
  This includes the work on the frozen recovery/experimental branches without
  changing or deleting those local references.
- Use `main` in the new repository as the review entry point. Do not rename the
  local integration branch or repoint the original remote.
- Do not include `.env` files, credentials, private databases, installed dependencies,
  caches, generated builds, private source maps, or temporary validation reports.
  These are local/generated/private material, not missing project source.
- No open-source license was added. Dependencies/reference assets retain their
  existing provenance; publication does not establish new redistribution rights.

## Reviewer-facing organization

The [README](../README.md), [reviewer guide](REVIEWER_GUIDE.md),
[architecture](ARCHITECTURE.md), [documentation index](README.md),
[local walkthrough](local-auth-testing.md), [contribution guide](../CONTRIBUTING.md),
and [security policy](../SECURITY.md) provide navigation without moving working code.
Historical plans remain available but are separated from current release authority.

## Checks actually run

These checks concern this publication preparation, not a complete release certificate.

| Check | Observed result |
| --- | --- |
| TypeScript | `npx tsc --noEmit`: exit 0 |
| ESLint | `npm run lint`: exit 0; 0 errors, 32 existing warnings |
| Frontend unit/contract | 1,362 passed, 0 failed/skipped after correcting two outdated source-location assertions |
| Focused search contracts | 10 passed, 0 failed/skipped |
| Backend/security focus | 102 passed, 0 failed/skipped: public visibility, production email pause, health privacy, strong-auth encryption, TOTP |
| Scanner configuration tests | 8 passed, 0 failed/skipped |
| Ruff | Full `app tests` check passed |
| Release artifact build | `npm run build:release` passed under explicitly local/test settings; 449 maps collected, 75 public maps stripped |
| Local HTTP demo | Health, DB health, roles, API docs, synthetic seed, register, verify, login: all HTTP 200; dev-inbox capture confirmed |
| Initial history scan | Gitleaks 8.30.1 scanned 440 patch-bearing commits (442 reachable Git commits), six reviewed nonsecret findings |
| Reviewed history scan | Zero findings with narrowly scoped exceptions; repeated at `68403a7` across 441 patch-bearing commits |
| Reviewed tracked snapshot | Zero findings; source archive scanned separately from generated reports |
| Negative scanner probes | Two synthetic nonworking secret patterns correctly detected: new value in an exception-bearing file, and known fixture in an unapproved path |

The build used loopback backend URLs, blank provider credentials, `APP_ENV=test`,
and a local release label. It is optimized-artifact proof, **not** validation of
production credentials/configuration. The HTTP smoke used a fresh database/media
directory under `/tmp`, an isolated working directory, and no real recipients or
provider calls. Only the processes started for this check were stopped.

Full backend, Playwright/QA/accessibility, hosted CI, dependency audits, PostgreSQL
contention/migrations, cloud providers, and restore/load drills were **not rerun**
as part of this documentation/publication task. Docker was previously unavailable.
The engineering handoff preserves broader earlier evidence separately.

### Search test corrections

`tests/deepSearchContract.test.mjs` and
`tests/integratedImportSearchRelease.test.mjs` still expected inline predicates in
the search repository after `b675235` centralized them. Isolated failures confirmed
the stale source-location contract. The tests now verify both repository wiring
and the shared implementation, retain publication/private-field checks, and add
deletion-hiding checks. No test was removed, skipped, or weakened to hide a runtime
failure. The existing 42-case behavioral visibility suite also passed.

### Secret-scan review

[`.gitleaks.toml`](../.gitleaks.toml) retains the default rule set. Its four
exceptions require an exact value **and** an exact reviewed location, covering
six findings:

- A FastAPI `docs_url=None` source expression in `backend/app/main.py`.
- A public RFC 6238 SHA-1 vector in two cryptography test files.
- A synthetic leak-detection marker in the health privacy test.
- One dummy recovery-code line in two frontend authentication tests.

No directory, commit, or credential class is excluded. Negative probes demonstrate
that other secret-like material is still detected. An early snapshot recheck
accidentally included a generated scanner report; the corrected check used a clean
source-only archive. No scanner report or probe fixture is included in the repository.
Automated scans reduce risk; they do not prove all material is safe or establish
legal permission for every reference asset.

## Resume publication safely

1. Confirm the separate writer has finished. Inspect branch, HEAD, diff, worktrees,
   and the frozen refs in the [handoff](PRODUCTION_READINESS_HANDOFF.md).
2. Authenticate through the connected GitHub integration or run the following
   interactively in the account owner's terminal; never paste tokens into chat:

   ```bash
   gh auth login --hostname github.com --git-protocol https --web
   gh auth status
   gh api user --jq .login
   ```

3. Finish local review, stage only owned explicit paths, commit, and rerun the
   history/snapshot scan against the exact candidate. Verify a clean tree.
4. Verify that `bytesized-careers` is available under the intended authenticated
   owner. Create it empty and public. If it already exists, inspect ownership and
   contents; never overwrite history or assume it is the requested fresh repo.
5. Add a **separate** remote (for example `portfolio`) after checking that name is
   unused. Preserve `origin`, the local branch, and frozen references.
6. Push only the reviewed full-history candidate to new remote `main` with an
   explicit `HEAD:refs/heads/main` refspec. No mirror, force push, or broad ref push.
7. Verify the public URL, visibility, default branch, exact remote SHA, and history
   count. Record real CI run URLs/results if runners execute. Existing workflows
   contain checks, not deployment steps; no hosting integration is authorized here.

If authentication is still unavailable, stop at a documented local checkpoint;
do not claim publication succeeded. The product release assessment remains **NO-GO**.
