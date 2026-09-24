# Public repository publication checkpoint

Prepared 2026-09-24. Requested destination: a **new public repository named
`bytesized-careers`**. The application keeps its existing CreatorJobs name; this
task does not authorize a product rebrand or deployment.

## Publication status

**PUBLISHED AND VERIFIED:** [guhanp09/bytesized-careers](https://github.com/guhanp09/bytesized-careers)
is a newly created **public** repository with default branch `main`.

The first verified upload is `1616c9f39528764859abd5b3bada4bcfdeef1245`:

- GitHub commit SHA equals the local source checkpoint.
- GitHub tree SHA equals local Git tree `6ae92455dbfbbd3d36d1b3d5ea6279673f6563d3`.
- GitHub reports **444 history commits**, matching `git rev-list --count HEAD`
  at that checkpoint; this is not a snapshot-only upload.
- GitHub's untruncated recursive tree contains **1,410 files**, matching local
  tracked files, and no unresolved submodules.
- The entire source/history passed the reviewed Gitleaks scan before upload.
- Existing `skizh` remote refs were read before/after publication and are identical.
  No push or repository setting change was sent to `skizh`.

This evidence-recording commit follows that initial upload. For the current
publication tip, compare `git rev-parse HEAD` with `git ls-remote portfolio
refs/heads/main`. Publication is not a successful hosted CI or production release
claim. The first runs subsequently started; their observed results are below.

### First hosted checks

The [Security run for the first upload](https://github.com/guhanp09/bytesized-careers/actions/runs/36002233432)
passed Gitleaks, SBOM generation, and container source assertions, but **failed**
the production dependency audit. The actual audit output identifies:

- `anyio 4.12.1`: `CVE-2026-63374` / `GHSA-82r6-8w77-94w6`.
- `anyio 4.12.1`: `CVE-2026-64847` / `GHSA-5p39-cfhj-2xmp`.

These are newly observed audit findings requiring a separately tested dependency
remediation; they are not suppressed to make the portfolio look green. The existing
exact ECDSA exception remains separately analyzed by the dependency gate.
The [main CI run](https://github.com/guhanp09/bytesized-careers/actions/runs/36002233377)
was in progress at this observation. Current results may advance; no complete pass
is claimed. The documentation contract test now checks this evidence distinction
instead of asserting that hosted CI has never run.

### Local connection

The local branch remains `integration/import-and-messaging-2026-07-30` and tracks
`portfolio/main`. `origin` still points to the unchanged `guhanp09/skizh` repository.
Branch-specific `pushRemote=portfolio` and an explicit `remote.portfolio.push`
mapping send this integration branch to the new repository's `main`; a plain
`git push --dry-run` confirmed the destination without touching `skizh`.

```bash
git status --short --branch
git remote get-url portfolio
git rev-parse HEAD
git ls-remote portfolio refs/heads/main
git push --dry-run
```

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

Full backend, Playwright/QA/accessibility, dependency audits, PostgreSQL
contention/migrations, cloud providers, and restore/load drills were **not rerun
locally** for publication. Docker was previously unavailable. Hosted checks started
after pushing; their observed results are documented above. The engineering handoff
preserves broader earlier evidence separately.

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

## Publication procedure and future recovery

The initial creation/upload/verification is complete. The checklist below documents
the procedure; do not create another repository or overwrite history when resuming.
Use the existing `portfolio` remote for subsequent reviewed commits.

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

If authentication becomes unavailable, preserve the local checkpoint and restore
access before further pushes. The product release assessment remains **NO-GO**.
