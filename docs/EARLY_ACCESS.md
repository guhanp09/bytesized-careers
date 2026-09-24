# Early access companion project

Public page: [ByteSized Careers — Join Early Access](https://bytesizedcareers.com/early-access).

The early-access site introduces the product and collects interest from people
seeking creator-economy work, hiring talent, or both. It is a **standalone waitlist**,
not the full CreatorJobs marketplace. Joining it is not the same as creating a
marketplace account, receiving a beta invitation, or gaining access to all features.

## What is implemented in the companion project

- A brand landing page at `/` and a dedicated signup journey at `/early-access`.
- Progressive capture of name/email, role, interests, relevant work/hiring context,
  optional phone/channel choices, and a note, with saved progress and a resume flow.
- Email-verification integration and separate development/test behavior.
- A responsive “The Brief” panel that reflects the visitor's answers. This is
  deterministic presentation logic, **not AI matching or AI-generated recommendations**.
- An authenticated administrator waitlist view with filtering and controlled CSV
  export, plus campaign/referral attribution handling.
- Separate privacy, terms, and storage/cookie information under `/early-access/*`.

The inspected current flow saves/validates phone input but does not verify phone
ownership. Channel choices do not imply active WhatsApp, SMS, or voice delivery.
The waitlist should not be presented as automated matching, a job guarantee, or a
certification that the marketplace is production-ready.

## Architecture and repository boundary

The companion uses Next.js/TypeScript, Tailwind, Drizzle/PostgreSQL, authenticated
admin access, and its own email integration and tests. Its
[source repository](https://github.com/guhanp09/bytesized-careers-waitlist) is now
**public**, following the owner's explicit publication request. Start with its
[reviewer guide](https://github.com/guhanp09/bytesized-careers-waitlist/blob/main/docs/REVIEWER_GUIDE.md),
[architecture](https://github.com/guhanp09/bytesized-careers-waitlist/blob/main/docs/ARCHITECTURE.md),
and [current evidence](https://github.com/guhanp09/bytesized-careers-waitlist/blob/main/docs/PROJECT_STATUS.md).
Public source does not make subscriber records or administrator access public.

The local checkout is the sibling directory `../bytesized-careers-waitlist` relative
to the maintainer's `creator-jobs-phase1` checkout. It is not part of this Git tree.
The projects retain separate code, repository history, deployments, databases,
environment settings, credentials, and user-data boundaries. No code, signup records,
CSV exports, database snapshots, or secrets from the waitlist were copied here.

For local changes, read the separate checkout's `README.md`.
Public reviewers can follow these source links without administrator credentials:

| Path in the companion repository | Responsibility |
| --- | --- |
| [Early-access page](https://github.com/guhanp09/bytesized-careers-waitlist/blob/main/src/app/early-access/page.tsx) | Page and metadata |
| [Waitlist flow](https://github.com/guhanp09/bytesized-careers-waitlist/blob/main/src/components/waitlist/waitlist-flow.tsx) | Progressive flow, saved progress, resume behavior |
| [Brief model](https://github.com/guhanp09/bytesized-careers-waitlist/blob/main/src/components/brief/brief-model.ts) | Deterministic answer-to-brief presentation |
| [Server actions](https://github.com/guhanp09/bytesized-careers-waitlist/tree/main/src/lib/actions) | Server-side capture and validation |
| [Admin workspace](https://github.com/guhanp09/bytesized-careers-waitlist/tree/main/src/app/admin/waitlist) | Protected lead administration |
| [Attribution link](https://github.com/guhanp09/bytesized-careers-waitlist/blob/main/src/lib/attribution/early-access-link.ts) | Bounded campaign parameters between pages |
| [Browser scenarios](https://github.com/guhanp09/bytesized-careers-waitlist/blob/main/tests/e2e/waitlist.spec.ts) | Signup, validation, and resume |

## Inspection evidence and limitations

On 2026-09-24, the local companion checkout was read-only inspected at
`0179605ceb2ce1465bd5edea39ec32586dece4a1`. A read-only public HTTPS request to
`https://bytesizedcareers.com/early-access` returned **200** with the title
“Join Early Access | ByteSized Careers”. This proves page reachability at that time,
not the deployed commit, end-to-end signup, email delivery, accessibility, legal
approval, or production configuration. No signup was submitted and no subscriber
records were inspected. Tests were not rerun during that initial inspection.

In the subsequent owner-authorized publication task on the same date, the companion
became public at documentation commit `5c55f93`. Unit tests139/139, typecheck and
lint passed; source, all-ref history and commit-message secret scans found no leaks.
Clean-install validation reproduced an existing missing-lockfile-entry failure;
PostgreSQL/browser suites were not rerun because Docker was unavailable. See its
project-status document for exact commands, evidence, and limitations. No lead
data was copied; the owner authorized the normal documentation-push redeployment.

Any future waitlist-to-beta invitation connection needs an explicit, consent-aware
integration design. Do not silently import leads into marketplace accounts or
treat a waitlist entry as a consumed/approved invitation. Marketplace onboarding
remains tracked in [R4 of the release roadmap](PRODUCTION_RELEASE_ROADMAP.md).
