# CreatorJobs Production Readiness Handoff

## Resume summary

```text
LAST COMPLETED PHASE: Phase 5 — Invite-only beta and durable transactional email (locally complete and certified; EMAIL-005 remains BLOCKED_EXTERNAL). Phases 2 and 4 were certified earlier under the same terms
LAST COMPLETED PHASE: Phase 8 — Realtime and scalable shared state (locally complete and certified; the broker adapter and real cross-process delivery are BLOCKED_EXTERNAL). Phases 2, 4, 5, 6 and 7 were certified earlier under the same terms
CURRENT PHASE: Phase 9 — Privacy, legal mechanics, support, and moderation
LAST COMPLETED ATOMIC SLICE: Phase 8 certification. Realtime now has a seam a broker plugs into, per-connection duplicate suppression, a publish that cannot fail a write, a production refusal of process-local delivery, and a probe that distinguishes configured from cross-instance.
NEXT ATOMIC SLICE: Phase 9 — privacy, legal mechanics, support and moderation. Read the Phase 9 ledger rows first, and SURVEY BEFORE BUILDING: this codebase already has an admin panel with an append-only audit rule, suspension enforcement, and a report taxonomy (see the admin-panel memory and docs/ADMIN_PANEL_PLAN.md). Counsel approval and legal text stay external; build the versioning/acceptance/export/deletion mechanics that do not depend on them, and mark any retention DURATION that needs legal policy as BLOCKED_PRODUCT_DECISION rather than inventing one.
CURRENT ALEMBIC HEAD: 0064_job_import_quota_counters (single head; 0060, 0061, 0062, 0063_job_import_execution_lease, 0064)
CURRENT ALEMBIC CURRENT: local configured SQLite is unversioned; disposable PostgreSQL upgrade/downgrade/re-upgrade reached 0059 successfully
IMPORTANT NEW ARCHITECTURE (2B): portfolio HTML preview and YouTube/Vimeo oEmbed now call `SafeOutboundFetcher` instead of their own DNS/redirect logic; oEmbed additionally requires an exact built-in endpoint constant, refuses every redirect, accepts only JSON, and caps decoded bodies at 64 KiB, while HTML previews accept only HTML/plain text within 512 KiB; provider host detection matches a domain or its subdomains rather than any suffix, so `notyoutube.com` is no longer treated as YouTube; each metadata field extracted from an untrusted page is length-clamped; unsafe URLs are refused before any request and network/provider failure still returns the manual-entry response. IMPORTANT ARCHITECTURE (2A): `SafeOutboundFetcher` is the one backend boundary for user-influenced public GETs: strict HTTP(S)/80-or-443 URL normalization; public-only IPv4/IPv6 plus tunnel-address checks; DNS answers are copied into an httpcore network backend that connects only to those IPs while the original host remains the HTTP Host/TLS SNI/certificate identity; the connected peer is checked; every redirect gets fresh validation and a fresh cookie-free one-connection pool; environment proxies are ignored; decoded response bytes, content type, redirects, DNS/connect/read/total time, URL length, and header surface are bounded. PublicJobUrlFetcher and PublicBrandUrlFetcher preserve their product parsing/error/retry contracts on top. The Phase 1 verified identity, durable session, encrypted credential, and administrator TOTP architecture remains unchanged
NEW ENVIRONMENT VARIABLES: backend GOOGLE_CLIENT_ID; backend GOOGLE_CLIENT_SECRET; GOOGLE_OAUTH_EXCHANGE_SECRET shared only between NextAuth and FastAPI; OAUTH_CREDENTIAL_KEYS; OAUTH_CREDENTIAL_ACTIVE_KEY_ID; OAUTH_CREDENTIAL_WRITE_MODE; ALLOW_OAUTH_PLAINTEXT_COMPATIBILITY_IN_PRODUCTION; AUTH_SESSION_MODE; ALLOW_LEGACY_REFRESH_COMPATIBILITY_IN_PRODUCTION; REFRESH_REUSE_GRACE_SECONDS; ADMIN_STRONG_AUTH_REQUIRED; ADMIN_STRONG_AUTH_MAX_AGE_MINUTES; STRONG_AUTH_SECRET_KEYS; STRONG_AUTH_SECRET_ACTIVE_KEY_ID; INVITE_ONLY_BETA (default false — leaving it unset preserves open registration exactly); MAX_REQUEST_BODY_BYTES and MAX_MEDIA_REQUEST_BODY_BYTES from RATE-004; EMAIL_WORKER_IN_PROCESS (default false) and EMAIL_WORKER_INTERVAL_SECONDS (default 5) from EMAIL-002; EMAIL_WEBHOOK_SECRET from EMAIL-004 (unset means the delivery webhook refuses everything, which is the intended fail-closed posture, not a bug). These are documented in backend/app/core/config.py rather than backend/.env.example, which tooling may not read or write (BLOCKED_ENVIRONMENT)
NEW DEPENDENCIES: backend now declares its already-locked runtime `httpx==0.28.1` and `httpcore==1.0.9` usage directly; no package version changed
NEW SERVICES: app.services.safe_outbound_fetch shared public-URL boundary; docs/PRODUCTION_READINESS_OUTBOUND_FETCH.md complete caller inventory; plus all previously documented OAuth/session/strong-auth services
OUTSTANDING EXTERNAL REQUIREMENTS: authenticated GitHub fetch/protection inspection; matching production GOOGLE_OAUTH_EXCHANGE_SECRET provisioning; real Google consent-screen scope configuration/verification and live login/incremental-consent/reconnect/refresh/revoke/outage drill; real OAuth/strong-auth keyring provisioning plus rotation drills; hosted credential backfill/encrypted-only verification; a physical authenticator-device drill and lost-all-factors support procedure; email DNS/provider; managed Postgres/Redis/storage; counsel approval; accessibility review; backup/restore; staging soak
KNOWN TEST FAILURES: 17 deterministic standard Playwright failures and 6 real-backend QA failures from the Phase 0 matrix remain unrerun as a whole and are owned by later phases; Phase 2C's 12-case hiring-identity fetch suite, 196-case dependent matrix, and complete uncontended 6,649-case backend suite are green alongside TypeScript, ESLint, the 1,138-case frontend unit suite and the production build; Phase 2B's 29-case link-preview suite, 72-case shared-boundary suite, 175-case dependent matrix, complete uncontended 6,637-case backend suite, TypeScript, ESLint, 1,138-case frontend unit suite, and production build are green; whole-tree Ruff retains unrelated baseline findings while every changed Python file passes; one overlapping pytest run during this session produced 158 shared-test-state failures that vanished on an uncontended rerun — never run a second pytest against the shared test database
COMMANDS TO RESUME: see "Phase 2C atomic checkpoint" and "Important commands"
FILES TO READ FIRST: docs/PRODUCTION_READINESS_EXECUTION.md; docs/PRODUCTION_READINESS_OUTBOUND_FETCH.md; backend/app/services/safe_outbound_fetch.py; backend/tests/test_hiring_identity_public_fetch.py; app/api/profile/organization-identity/route.ts; lib/youtubeIdentity.ts; backend/app/services/profile_service.py
RELEASE ASSESSMENT: NO-GO
```

The machine-readable work status is in `docs/PRODUCTION_READINESS_EXECUTION.md`. The older `docs/PRODUCTION_READINESS.md` predates the current product and audit; treat it as historical context, not the active source of truth.

## WEB-008B CSP origin inventory (gathered Phase 2I, spent in Phase 2J)

The inventory below is what the shipped policy was built from. Two entries were
corrected by inspection when the policy was written: there is no `<iframe>`
anywhere in the tree, so `frame-src` is `'none'` rather than a provider list —
portfolio video is linked and thumbnailed, and the oEmbed `embed_html` a
provider returns is stored but never rendered; and `data:`/`blob:` in `img-src`
are both genuinely required, the first by a `url("data:…")` in the built CSS and
the second by `URL.createObjectURL` upload previews in `components/you/YouHubClient.tsx`.

```text
connect-src   'self' + the configured backend origin from NEXT_PUBLIC_BACKEND_URL,
              plus its ws:/wss: form — lib/realtimeMessaging.ts derives the socket
              URL from getBackendApiBaseUrl() and swaps the scheme. Parse and
              normalize that origin; never interpolate the raw env value into the
              header (tests/securityHeaders.test.mjs enforces this).
frame-src     https://www.youtube.com https://www.youtube-nocookie.com
              https://player.vimeo.com — portfolio/work embeds.
img-src       'self' data: blob: plus remote portfolio media. Creators link work
              anywhere, so a narrow host list is not practical here; decide
              deliberately between `https:` for images only (documented) and a
              proxying approach, and do not let that decision leak into other
              directives.
script-src    The open question. Next App Router inline bootstrap plus the theme
              bootstrap in app/layout.tsx. Nonce via middleware is the correct
              answer if hydration survives it.
style-src     Tailwind ships a stylesheet, but inline styles are used; expect to
              need 'unsafe-inline' for styles and document it.
font-src      'self' — no external font host is referenced anywhere in the tree.
default-src   'self'; object-src 'none'; base-uri 'self'; form-action 'self'.
Not needed    No fonts.googleapis.com, no gstatic, no analytics script. Google
              Places and YouTube Data API are called server-side only, so they do
              not belong in connect-src.
```

## Phase 5I checkpoint (EMAIL-004 — bounces, complaints, and a webhook that cannot be forged)

```text
Commit: "feat(email): stop mailing an address that told us to stop"
Migration: 0062_email_suppressions, parents 0061_beta_invitations, single head. New table only.
        Offline SQL render verified; no PostgreSQL harness in this environment (Docker absent).

THE RULE THAT MATTERS is the asymmetry, and collapsing it is expensive in BOTH directions:
  hard bounce  = a fact about the mailbox. It does not exist. Suppress EVERYTHING, auth included:
                 a reset link to a mailbox that rejects it helps nobody and costs the sending
                 domain its reputation.
  complaint    = a judgement about mail WE chose to send. The person is still there. Suppress
                 everything EXCEPT authentication mail — otherwise reporting one job alert locks
                 someone out of their own account forever.
  soft bounce  = transient. Not a suppression at all; the outbox retry schedule already covers it.
  unknown      = recorded, acts on nothing. Silently dropping mail for a category nobody ruled on
                 is worse than sending it.
This is what AUTH_EVENT_KEYS in notifications/email.py is for; it was added in EMAIL-002 with
exactly this in mind.

WHERE THE CHECK LIVES: in the worker, immediately before the provider is asked — NOT at enqueue.
An address can be suppressed after its mail is queued, and that queued mail is precisely what
must not go out. A suppressed row becomes `skipped`.

THE WEBHOOK IS THE ATTACK SURFACE. It cannot be authenticated the ordinary way (a provider holds
no session), so the signature is the entire gate. Unsigned, this endpoint lets any stranger post
a fabricated hard bounce for any address and silently stop that person's mail, including password
resets — a denial of service against one account at a time that leaves nothing resembling an
attack in the logs. Three properties, each closing a specific hole:
  - HMAC-SHA256 over `timestamp.body`, so the CLAIM is signed, not merely the request;
  - the timestamp is INSIDE the signed material and checked against a 300s window, so a captured
    request is not a lasting credential (a header-only timestamp could be swapped for a fresh one);
  - hmac.compare_digest, because a byte-by-byte comparison leaks how much of a guess was right.
An unset EMAIL_WEBHOOK_SECRET REFUSES every request. "No secret configured, so accept everything"
turns a missing environment variable into an open door, in exactly the deployment nobody watches.

DELIBERATELY PROVIDER-NEUTRAL: no provider has been chosen (EMAIL-005 is BLOCKED_EXTERNAL on the
sending domain), so writing a specific vendor's header scheme now would mean implementing a
verifier for something this codebase has never seen. Mapping a real provider onto this is a small
adapter; the properties above are the part worth getting right first.

Idempotent by construction: providers redeliver webhooks as a matter of contract, so recording is
INSERT ... ON CONFLICT DO NOTHING. A second delivery neither raises on the unique index nor
overwrites the original reason with a later, vaguer one.

Releasing sets released_at rather than deleting: "this address bounced in March" is the context
for April's support conversation, and a deleted row cannot explain why mail stopped.

Tests: tests/test_email_suppression.py, 30 cases. Non-vacuity PROVEN by mutation: neutering the
signature check and the worker's suppression check fails 6 tests, including every forgery case.

BUG FOUND AND FIXED DURING THIS SLICE, worth remembering: the router first imported
`get_db_session` from app.db.session instead of `get_db` from app.api.deps. conftest overrides
ONLY the deps one, so the endpoint ran against the real configured engine and wrote a row into
the local dev.db while the test saw nothing. Symptom: a 200 response with the assertion failing.
The stray dev row was removed. Always take get_db from app.api.deps.

Test note: the endpoint commits on its own session, so a test holding db_session sees a snapshot
from before the request. Read committed rows through a fresh TestSessionLocal session.

NOT DONE HERE: EMAIL-002's removed 503 owed some failure visibility, and a misconfigured provider
is still only visible in worker logs and in rows that reach MAX_ATTEMPTS. An operator view of
failed/suppressed rows belongs with the admin panel work, not in the delivery path.
```

## Phase 5H checkpoint (EMAIL-003 — event email, and the second delivery path is gone)

```text
Commit: "refactor(email): leave one way for an email to be delivered"
Status: COMPLETE. No migration, no new producer.

Most of EMAIL-003 was already true and the ledger row was stale: app/notifications/service.py
already enqueued inside the caller's transaction, and EMAIL-001's worker plus EMAIL-002's runner
gave those rows a way out. What was actually wrong was that TWO delivery paths existed.

REMOVED: notifications/email.py::_process_outbox_row. It marked rows "mocked" — a status the
worker never produces and that eligible_predicate does not know — so a row processed by the old
path landed in a state the rest of the system could not reason about. Its only caller was a test.
One vocabulary now: queued -> sent | failed | skipped. The model comment, the dev-outbox route
docstring and the module docstring said otherwise and were corrected rather than left to mislead.

TEST TRAP, and it cost a wrong-looking pass: SmtpEmailProvider does
`from app.services.email_service import send_auth_email` AT IMPORT TIME. Patching
`email_service.send_auth_email` therefore does NOT affect it — the real sender stays in place and
a test that expected a failure quietly passes on a successful send. Patch
`app.notifications.provider.send_auth_email`. Two existing tests were patching the wrong module.

SECOND TRAP: process_outbox_once claims table-wide, so in a file where earlier tests queue mail,
the batch fills with their rows and the row under test is never attempted. Delete the others
first (see test_external_delivery_failure_after_commit_does_not_rollback_hire) — this is the same
lesson as Phase 5C-fix, in a different disguise.

Rewritten rather than deleted: test_external_delivery_failure_after_commit_does_not_rollback_hire
now drives the real worker. Its old assertion was status == "failed" on the first outage, which
is the wrong contract — a transient outage is retried, so the row is queued with attempts == 1
and a next_attempt_at. The hire standing regardless is still the point of the test.

NEXT: EMAIL-004 (bounce/suppression) — it also owes the failure visibility that EMAIL-002's
removed 503 used to provide, since a misconfigured provider is now only visible in worker logs
and in rows that reach MAX_ATTEMPTS.
```

## Phase 5G checkpoint (EMAIL-002 — auth email goes through the outbox, and something drains it)

```text
Status: COMPLETE for verification and password reset. The invitation email itself is NOT written
        yet: nothing issues invitations over HTTP, so there is no place to send it from. The
        event key `auth.invitation` is reserved for whatever admin path issues them.
Migration: NONE. Reuses the email_outbox table and the 0060 lease columns.

WHAT CHANGED, and why it is not just plumbing:
  Auth email used to be sent inline, AFTER the transaction committed:
      create token -> commit -> send_auth_email()   <- a network call, in the request
  Two failures follow and neither shows up in a happy-path test.
    1. a crash between the commit and the send loses an email nobody knows is owed. The account
       exists and nothing will ever tell its owner how to verify it.
    2. a provider outage raises inside the request, so a signup that fully succeeded reports
       failure to the person who made it. Reset was worse: the person is locked out and waiting.
  Now:
      create token -> queue_auth_email() -> commit    (worker delivers, on its own schedule)
  The enqueue is INSIDE the transaction, so the promise to email lands with the thing it is
  about, or not at all. auth_service.log_* were renamed emit_* because they no longer log — they
  queue. Local link capture and the returned verification_url are unchanged.

REMOVED (deliberately, not overlooked): the three `except EmailDeliveryError -> 503` handlers in
  routers/auth.py. Nothing in those paths can raise it any more, and a handler for a failure that
  cannot happen implies a failure mode that does not exist. The old test asserting 503 on SMTP
  failure was REWRITTEN, not deleted — it now asserts the better contract: the request succeeds,
  the row is queued, and the link is in the row. Losing the immediate 503 does mean a
  misconfigured SMTP is quieter; EMAIL-004 owns making failed rows visible.

THE QUEUE NOW DRAINS. app/notifications/runner.py:
  run_worker_forever(session_factory, provider=, interval_seconds=, stop=asyncio.Event)
    - a FRESH session per pass; a long-lived one holds a transaction open across the sleep and
      turns an idle worker into a lock holder
    - a pass that raises is logged and the loop continues; the claimed rows are unharmed because
      an unfinished lease lapses on its own
    - the interval is `wait_for(stop.wait(), timeout=)`, NOT `sleep()`, so shutdown costs the
      pass in flight rather than a full interval
    - build_provider() returns the mock unless real_delivery_enabled(); an incompletely
      configured deployment records mail rather than half-sending it
  Two ways to run it:
    python -m app.notifications.runner            (preferred in production: its own lifetime)
    EMAIL_WORKER_IN_PROCESS=true                  (local convenience; app/main.py startup)
  In-process is OFF by default. A worker sharing a lifetime with the web server shares its
  restarts and deploys.

Tests: tests/test_auth_email_durability.py (8) + tests/test_email_worker_runner.py (8).
Non-vacuity PROVEN by mutation, twice:
  - restore an inline send inside queue_auth_email -> both TestNoProviderIsContactedDuringARequest
    tests fail. The counting test exists because "the request succeeded" would still pass if the
    send happened inline and worked.
  - drop the runner's try/except and use sleep() instead of the event wait -> the raising-pass
    test and the shutdown-latency test both fail.

NEXT (EMAIL-003): route event email (application, hiring, safety) through the same queue, then
  EMAIL-004 for bounce/suppression and the visibility that the removed 503 used to provide.
```

## Phase 5F checkpoint (INVITE-002 — the gate is wired into both signup paths)

```text
Commit: "feat(invites): check the invitation at both signup doors"
Status: COMPLETE. Registration is refused server-side when the beta gate is on and no valid
        invitation is presented. No migration; behaviour is off by default.
Setting: settings.invite_only_beta (env INVITE_ONLY_BETA), DEFAULT FALSE. Off = today's behaviour
        exactly, which is why every existing environment is unaffected by deploying this.
        NOTE: backend/.env.example could not be updated — that path is denied to tooling
        (BLOCKED_ENVIRONMENT, already recorded). config.py carries the documentation instead.

One gate, called twice:
  require_invitation_for_signup(session, email=, token=) in beta_invitation_service.py
    - returns None when the flag is off (the ONLY case where a missing token is acceptable)
    - raises InvitationError otherwise, reusing invitation_problem() so the wording, and the
      refusal to distinguish "wrong address" from "unknown token", are identical to redemption.
  Call sites, both BEFORE create_user so no account exists when the answer is no:
    - app/services/auth_service.py register_user()                  (password signup)
    - app/services/auth_service.py _exchange_verified_google_oauth() (Google signup)
  Redemption happens in the SAME transaction as user creation, so a crash cannot leave an
  invitation burned with no account, or an account created from an unburned invitation.

Schema/route: invitation_token (str|None, max_length=512) added to RegisterRequest and
  OAuthGoogleExchangeRequest; router maps InvitationError -> HTTP 403.

Two copies of an access rule drift and the weaker one becomes the way in. That is why this is a
single function rather than a check written at each call site.

ALSO IN THIS SLICE — single use is now enforced by the WRITE, not by a read:
  redeem_invitation() previously read "not yet redeemed" and then wrote, which is check-then-act:
  two requests carrying the same token can both pass the read before either writes. That is the
  same defect class as the outbox claim (see Phase 5B) and it was closed the same way —
    UPDATE beta_invitations SET redeemed_at=, redeemed_user_id=
     WHERE id= AND redeemed_at IS NULL AND revoked_at IS NULL RETURNING id
  No row back means someone else won, and the caller gets "already been used". The ORM copy is
  refreshed afterwards because synchronize_session=False leaves it stale and the caller is handed
  that object (the same trap that made the outbox retry counter read 0 forever).
  Address binding already limited the practical exposure — an invitation is valid for one address,
  and users.email is unique — but "another constraint happens to cover it" is not single use.
  test_a_redemption_that_races_another_one_loses reproduces the interleaving by redeeming the row
  out of band while a stale in-memory snapshot is held. Proven non-vacuous by mutation: restore
  the read-then-write and the second redemption SUCCEEDS (pytest.raises reports DID NOT RAISE).

Backend suite after this slice: 6,856 passed / 64 skipped / 0 failed, uncontended (was 6,845/64).
Tests: tests/test_beta_invitations.py, 30 cases. TestRegistrationIsActuallyGated drives the real
  route through the client fixture — a gate that exists but is not called is the usual way
  "invite-only" turns out to be open.
Non-vacuity PROVEN by mutation: replacing both require_invitation_for_signup calls with a stub
  returning None makes the uninvited signup return 200 and fails
  test_registration_is_refused_without_an_invitation. Restored; 3/3 pass.

Two test traps paid for here:
  - the API validates with EmailStr, which REFUSES reserved TLDs. `@example.test` (fine in the
    service tests) is a 422 at the route. API-level tests use @example.com + a uuid suffix,
    because users persist between runs and a fixed address hits a UNIQUE constraint.
  - the autouse _isolate fixture must COMMIT its cleanup, not flush. A flush holds the write
    transaction open, SQLite allows one writer, and the API's own connection then fails with
    "database is locked" — which looks nothing like an invitation problem.

NEXT (EMAIL-002): route auth email (invite, verification, reset) through the outbox instead of
  the direct emitter, so delivery survives a crash. The invitation email is the first real sender.
```

## Phase 5E checkpoint (INVITE-001A — invitation model, migration, service)

```text
Status: COMPLETE for issue/redeem/revoke mechanics. Registration ENFORCEMENT (INVITE-002) is next.
Commit: "feat(invites): bind an invitation to one address and one use"
Migration: 0061_beta_invitations, parents 0060_email_outbox_lease, single head. New table only.
New: backend/app/models/beta_invitation.py, backend/app/services/beta_invitation_service.py
     issue_invitation -> IssuedInvitation(invitation, token)  [token returned ONCE, never stored]
     find_by_token / invitation_problem(pure) / redeem_invitation / revoke_invitation
Tests: 19 cases. Ruff clean on changed files.

Security decisions, each aimed at a specific bypass:
  - token stored as SHA-256 only; the raw value exists in the email and nowhere else, so a backup,
    log or admin screen cannot leak a working credential. Nothing here can recover a token.
  - invitation is BOUND to an email; a forwarded code is refused. Addresses compared casefolded
    and trimmed so the same mailbox in different casing still works.
  - "wrong address" returns the SAME message as "unknown token" — distinguishing them confirms the
    code is real and hands over half the answer. A test asserts the two messages are identical.
  - single use recorded via redeemed_at/redeemed_user_id, so a replay is refused by stored fact.
  - expiry required; revocation keeps a reason for audit; revoking an ALREADY-REDEEMED invitation
    is a deliberate no-op (it would imply un-creating the account, which this does not do).
  - email indexed but NOT unique: re-inviting after expiry is ordinary, and uniqueness would force
    deleting the audit trail or refusing a legitimate second invitation.

Test note: redeemed_user_id is a real FK, so redemption tests need an actual User row — an invented
uuid4 raises IntegrityError. That is the constraint doing its job; there is a `redeemer` fixture.

NEXT (INVITE-002): enforce at registration. Both paths must check server-side — password signup in
backend/app/api/v1/routers/auth.py register(), and the Google path. A UI-only gate is not a gate.
```

## Phase 5D checkpoint (EMAIL-001E/F — provider seam and the worker)

```text
Status: COMPLETE. Commit: "feat(email): actually deliver what the outbox promised"
New: backend/app/notifications/provider.py — EmailProvider protocol, ProviderOutcome
     (SENT/RETRYABLE/TERMINAL/SUPPRESSED), ProviderResult, MockEmailProvider, SmtpEmailProvider.
     backend/app/notifications/worker.py — process_outbox_once(session, *, provider, worker_id,
     limit, now) -> DeliveryRun. One pass, no internal loop or sleep: the caller owns scheduling
     and the retry schedule lives on the row.
Tests: 15 worker cases; 100 including claim/delivery/migration/notifications/interaction-transitions.

FINDING: there was NO production consumer of the outbox at all. `_process_outbox_row` had exactly
one caller — a test. Every notification email was being recorded as intended and never sent. Safe
(better than sending twice) but the queue never drained. The worker closes that.
`queue_notification_email` already writes inside the caller's transaction, so the enqueue half of
EMAIL-001F was already correct; `app/notifications/service.py` is the single enqueue site.

Design notes worth keeping:
  - MockEmailProvider returns SENT, not a separate "mocked" outcome, so dev and production exercise
    one success path. Mock-vs-real belongs in config and logs, not in the state machine.
  - SmtpEmailProvider classifies EmailDeliveryError as RETRYABLE: send_auth_email raises one type
    for everything, and guessing "terminal" on a transient outage silently drops mail, whereas
    retrying is bounded by MAX_ATTEMPTS and then reported.
  - A provider that RAISES is treated as a retryable failure. Letting it escape would leave the row
    leased until expiry with no recorded reason.

NEXT: EMAIL-002/003 (auth + event email through the outbox), EMAIL-004 (bounce/suppression state,
needs provider_message_id which 0060 added), INVITE-001/002. EMAIL-005 stays BLOCKED_EXTERNAL.
```

## Phase 5C-fix (outbox test isolation) — read this before writing more outbox tests

```text
Commit: "test(email): give the outbox suites their own empty table"
The broad checkpoint after three green focused runs produced 21 failures, all in the new outbox
suites, all passing in isolation. Cause was scope, not product: `claim_due_emails` asks the WHOLE
table what is due — right for a worker, wrong for an assertion. `assert claim_due_emails(...) == []`
actually means "nothing anywhere in the database is claimable", so any outbox row another test left
behind broke it.
Fixed with an autouse fixture in both modules that deletes EmailOutbox rows before each test —
real isolation rather than looser assertions.
Full backend after the fix: 6,811 passed / 64 skipped / 0 failed.
Lesson for the next outbox test: assert about the row under test, or empty the table first. Never
assert about the global claim result.
```

## Phase 5C checkpoint (EMAIL-001C/D — attempts, retry, terminal states)

```text
Status: COMPLETE. Commit: "feat(email): bound the retries and separate the failures"
New: backend/app/repositories/email_outbox_delivery.py
     mark_sent / mark_retryable_failure / mark_terminal_failure / mark_suppressed,
     retry_delay_seconds(attempts) pure function.
     MAX_ATTEMPTS=5, BASE_RETRY_SECONDS=60, MAX_RETRY_SECONDS=3600, deterministic (no jitter —
     untestable jitter is not worth it at this size; inject a source if contention ever needs it).
State model: queued (claimable) -> sent | failed | skipped. Retry returns to `queued` with a future
next_attempt_at rather than adding a "retrying" state that could disagree with the timestamp.
Suppressed is separate from failed and consumes NO attempt — withheld on purpose vs attempted and
rejected read differently to an operator.
Tests: 21 cases; 52 across the three outbox suites. Ruff clean.

REAL DEFECT FOUND BY THE LOOP TEST, worth remembering: mark_retryable_failure originally took the
ORM row and read `row.attempts`. Every write here uses synchronize_session=False, so an instance
the caller holds — including one from the claim's RETURNING — keeps its loaded value. A worker
looping would have read a stale 0 forever, never reached MAX_ATTEMPTS, and the retry bound would
not have existed despite every individual test passing. Now takes an id and re-reads.
Re-reading is safe there and NOT safe in claim_due_emails: the caller already holds the lease, so
exclusivity is established. The claim has no such guarantee and must stay one statement.

NEXT: EMAIL-001E/F — provider abstraction (send -> message id | classified error) and moving
`_process_outbox_row` in backend/app/notifications/email.py onto claim + delivery. Note that
queue_notification_email already writes inside the caller's transaction, so the enqueue half of
EMAIL-001F is already satisfied.
```

## Phase 5B checkpoint (EMAIL-001B — atomic claim primitive)

```text
Status: COMPLETE. Commit: "feat(email): claim outbox rows in one statement, not two"
New: backend/app/repositories/email_outbox_repository.py
     claim_due_emails(session, *, worker_id, limit, lease_seconds, now) -> list[EmailOutbox]
     release_lease(session, row_id); eligible_predicate(now) exposed for testing.
Claim is ONE `UPDATE ... WHERE id IN (SELECT ... LIMIT) RETURNING`, with
`.with_for_update(skip_locked=True)` added on PostgreSQL only. Eligibility re-stated on the UPDATE
as well as the subquery, so the claim stays correct on engines without row locking.
Eligibility: status='queued' AND (next_attempt_at IS NULL OR <= now) AND (leased_until IS NULL OR <= now).
`now` is injected everywhere — no test sleeps to watch a lease expire.
Tests: 20 cases; 31 with the migration suite. Ruff clean.

NON-VACUITY, and the reason the structural test exists: mutating the claim into a
read-then-decide-then-write form left ALL 19 behavioural tests passing and was caught only by
`TestTheClaimIsOneStatement`. SQLite serialises writes, so check-then-act is behaviourally
invisible locally — the shape assertion is the only local defence against the RATE-001 defect
being reintroduced here.

STILL BLOCKED_ENVIRONMENT: true concurrent-claim proof needs PostgreSQL SKIP LOCKED. No local
postgres binaries, Docker denied. The SQL contract and predicate are tested; two real workers
racing are not.

NEXT: EMAIL-001C/D — attempt accounting and bounded retry/backoff (mark_sent, mark_failed with
retryable vs terminal classification, next_attempt_at scheduling). Then the provider abstraction,
then migrating `_process_outbox_row` in backend/app/notifications/email.py onto the worker path.
```

## Phase 5A checkpoint (EMAIL-001A — expand-only outbox lease schema)

```text
Status: COMPLETE. Commit: "feat(email): give the outbox the state a durable worker needs"
HEAD before: e4bccb9b6844f315118c34480b7e840ff26f78a0
Migration: 0060_email_outbox_lease, parents 0059_oauth_connection_events, single head preserved.
Adds: leased_by, leased_until, attempts (NOT NULL server_default 0), next_attempt_at,
      provider_message_id; indexes ix_email_outbox_claimable (status, next_attempt_at) and
      ix_email_outbox_leased_until.
Expand-only: every column nullable or defaulted, no status touched, no data statements — schema
and worker can deploy in either order.
Files: backend/alembic/versions/0060_email_outbox_lease.py, backend/app/models/email_outbox.py,
       backend/tests/test_email_outbox_lease_migration.py (11 cases)
Tests: 11 focused; complete backend 6,770 passed / 64 skipped / 0 failed (was 6,759 + 11); Ruff clean.

MIGRATION EXECUTION IS BLOCKED_ENVIRONMENT — do not mistake this for validated.
  No local postgres/psql/initdb binaries, Docker denied, and the chain contains a JSONB column
  SQLite cannot compile (`jobs.platforms`), so `alembic upgrade head` cannot run locally at all.
  Upgrade/downgrade/re-upgrade and SKIP LOCKED semantics all need disposable PostgreSQL.

WHY THE PARITY TEST IS SHAPED THE WAY IT IS: tests build schema with create_all, so a column added
to the model and forgotten in a migration passes all 6,770 tests and is absent in production.
There is no other local signal, because migrations cannot execute. The test therefore compares the
model's FULL column set against PRE_LEASE_COLUMNS plus what 0060 adds. A first version compared a
hardcoded list to itself and passed a deliberately injected model-only column — verified by
mutation, rewritten, and re-verified failing with `assert not {'drift_probe'}`.
```

## Phase 5 gap analysis — EMAIL-001 durable outbox (research done, start here)

Do not begin by designing an outbox. One already exists and is wired in; the gap is narrower
than the ledger row implies.

```text
EXISTS: backend/app/models/email_outbox.py (EmailOutbox)
  id, user_id, to_email, event_key, template_key, subject, preview, body, cta_url,
  metadata_json, dedupe_key (UNIQUE -> idempotency already covered),
  status (queued|mocked|sent|failed|skipped), error, created_at, processed_at
  Consumers: app/db/qa_scenarios.py, app/api/v1/routers/dev_emails.py, app/api/v1/routers/admin.py
  Auth emails deliberately bypass it and use email_service.send_auth_email.

MISSING for EMAIL-001 ("lease, concurrent claim, retry, crash recovery, idempotency"):
  - lease:   leased_until (timestamptz, nullable, indexed), leased_by (worker identity)
  - retry:   attempts (int, default 0), next_attempt_at (timestamptz, indexed)
  - provider: provider_message_id — needed later by EMAIL-004 to correlate bounces
  - the atomic claim itself: SELECT ... FOR UPDATE SKIP LOCKED, or an UPDATE ... RETURNING
    guarded on (status='queued' AND next_attempt_at <= now() AND (leased_until IS NULL OR
    leased_until < now())). A read-then-write claim has the same defect RATE-001 is blocked on.
```

**Next slice is a migration**, so: `alembic heads` is `0059_oauth_connection_events` (single head)
and the new revision parents it. Expand-only — add nullable columns with server defaults, leave
`status` alone, and do not touch the three existing consumers in the same slice. The atomic claim
and its concurrency tests are the slice after, and those want the disposable PostgreSQL harness
(`backend/scripts/test_interaction_status_postgres.sh`) because SQLite will not exercise
`SKIP LOCKED`.

EMAIL-005 (SPF/DKIM/DMARC, real provider) stays BLOCKED_EXTERNAL and must not gate any of this.

## Phase 6H checkpoint (AI-002 proof + AI-003 quota; AI-004 partly blocked on a product decision)

```text
COMMITS: "test(import): prove a repeat never buys a second draft" (8e27b61)
         "feat(import): bound how many imports one person may start"
MIGRATION: 0064_job_import_quota_counters, parents 0063, SINGLE HEAD, new table only.
BROAD: full backend 7,022 passed / 64 skipped / 0 failed. COLLECTION 7,065 -> 7,086 (+21, all new).

AI-002: creation idempotency ALREADY existed (client_request_id) and was already tested —
concurrent duplicate source/draft requests return one record. What was missing was the expensive
half, now asserted as a CALL COUNT: a repeat after success calls no provider and consumes no
attempt. No second identifier invented.

AI-003 QUOTA — one statement, and that is the whole point:
  UPDATE counters SET used = CASE WHEN window stale THEN 1 ELSE used + 1 END,
                      window_started_at = CASE WHEN window stale THEN now ELSE unchanged END
  WHERE user_id = :u AND (window stale OR used < :limit) RETURNING used
  No row back = refused. Read-then-decide-then-write lets ten simultaneous requests all read
  "3 of 20" and all proceed, and the window reset has the same trap: "reset if stale, then
  increment" is two steps, and two requests at the rollover both reset and both start at one.
  JOB_IMPORT_DAILY_QUOTA default 25, JOB_IMPORT_QUOTA_WINDOW_HOURS default 24.
  PER USER, not per draft: the cost is the provider's, and one person with fifty drafts is
  exactly what a per-draft limit misses.
  Charged BEFORE the lease, refunded when no provider call happens — the unit stands for a call.
  A repeat on a finished draft returns before the charge at all, so refreshing your own draft
  cannot lock you out of importing. Both directions are tested through the route.
  Refused with 429 JOB_IMPORT_QUOTA_EXCEEDED.
  Mutation-proven: a read-then-write rewrite passes every behavioural test and fails only the
  two structural ones. As with the claim, structure is the only witness on SQLite.

AI-004 IS NOW SPLIT HONESTLY. Allowlist and output cap are done. Spend is bounded in ATTEMPTS,
which is the unit this codebase can actually count. A budget denominated in CURRENCY is marked
BLOCKED_PRODUCT_DECISION: it needs real per-model prices, and inventing them would produce a
number that looks like control and is not.

NEXT READY: AI-009 (provider privacy — inspect the actual payload; much may already hold),
AI-010 (evaluation corpus incl. prompt injection), AI-005/AI-007/AI-008 survey-then-close.
```

## Phase 6G checkpoint (AI-001E + AI-006 — the sweep runs, and readiness can see it)

```text
SLICE: AI-001E (run the sweep) + AI-006 (queue readiness).
COMMIT: "feat(import): run the sweep, and let readiness say whether anything will"
MIGRATION: none. BROAD: full backend 7,001 passed / 64 skipped / 0 failed.
COLLECTION: 7,048 -> 7,065 (+14 sweeper, +3 readiness). Accounted for.

RUNNING IT: JOB_IMPORT_SWEEPER_IN_PROCESS (default FALSE) +
JOB_IMPORT_SWEEPER_INTERVAL_SECONDS (default 30). Same posture as the email worker, for a
sharper reason: a sweeper that shares a lifetime with the web server shares its restarts, and
the stranded rows it exists to rescue are created by exactly those restarts. Own process:
  python -m app.services.job_import_sweeper
app/main.py shutdown now stops BOTH background loops through one list, so adding a third cannot
leave the second unstopped.

READINESS reports `sweeper_configured` SEPARATELY from `ready`, and that separation is the
point: an import can be started and finished in-request with no sweeper at all. What is missing
without one is RECOVERY. Folding it into `ready` would send an operator hunting for a broken
provider when nothing is broken. The probe also cannot see a sweeper running as its own process,
so it reports what it knows ("this API hosts one") rather than asserting none exists.
Provider health is still deliberately NOT probed — a probe that called the provider would bill a
request every time a load balancer looked.

AI-001 is now IMPLEMENTED, not VALIDATED, and the ledger says why: live multi-worker concurrency
cannot be raced here (no PostgreSQL harness, Docker absent). The contract is implemented and
tested; the distributed race is not empirically proven.

NEXT READY: AI-002 (idempotency — review against the EXISTING client_request_id contract rather
than inventing a second one), then AI-003 quotas, AI-004 spend budget (now that
processing_attempts is a durable per-draft record), AI-010 evaluation corpus.
```

## Phase 6F checkpoint (AI-001D — the sweep for imports nobody is watching)

```text
SLICE: AI-001D. COMMIT: "feat(import): settle the imports nobody is watching"
MIGRATION: none. FILES: app/services/job_import_sweeper.py (new),
  settle_as_failed() added to job_import_execution_repository, tests/test_job_import_sweeper.py (14).
FOCUSED: sweeper 14, plus claim/lease/terminal/checkpoint dependents green.

THE DESIGN DECISION, and it is the whole slice: THE SWEEP NEVER CALLS THE PROVIDER.
It settles a stranded attempt into processing_failed and schedules when it may be tried again;
it does not try again itself. Re-running an import unattended would spend money for someone who
is not there to see the result and hand them a draft they did not ask for. The recruiter, or
their next request, decides whether to spend again.
That also answers the kill-switch-while-queued question BY CONSTRUCTION rather than by a flag:
an incident switch must stop provider work already queued, and a sweep that invokes no provider
cannot violate that. Running it while the switch is off is actively useful — rows stop claiming
to be in progress while the feature is paused. A test asserts both halves.

SESSION FACTORY IS INJECTED, never imported. A worker that reaches for the configured engine
cannot be pointed at a disposable database by a test — which is exactly how a test once wrote a
row into dev.db. A structural test asserts the module never imports SessionLocal.

NOT WIRED TO STARTUP YET. run_import_sweeper_forever exists and is tested; nothing runs it. That
is the next slice, and it should follow the EMAIL_WORKER_IN_PROCESS pattern (off by default, own
process preferred) rather than silently starting a second background loop in the API.

NEXT READY: AI-001E — run the sweeper (setting + startup wiring, mirroring Phase 5), then AI-006
queue readiness now that a queue exists, then AI-002 idempotency review against client_request_id.
```

## Phase 6E checkpoint (AI-001C — the claim is wired into the request path)

```text
SLICE: AI-001C. COMMIT: "feat(import): take the import before calling the provider"
MIGRATION: none. BROAD: full backend 6,984 passed / 64 skipped / 0 failed.
COLLECTION: 7,018 -> 7,048 (+24 AI-001B claim tests, +6 new). Fully accounted for.

HONEST SCOPE — read this before claiming AI-001 fixed "loading forever":
app/core/job_import_attempt_liveness.py ALREADY settled a stale `processing` row when someone
read it. That covers the recruiter who comes back and refreshes. What ownership adds, and what
these tests cover, is narrower and real:
  - two concurrent requests produce ONE provider call (previously bounded only by a
    transaction-scoped mutation token, which says nothing once the transaction ends);
  - attempts are bounded by the claim, counted AT CLAIM so a process that dies mid-attempt still
    spent one — a crash reports nothing, so counting failures cannot bound a crash loop;
  - a queryable lease, so a sweep can find stranded rows WITHOUT a reader;
  - a failure schedules its own retry.

TWO DESIGN CORRECTIONS FOUND BY THE EXISTING TESTS, both worth keeping:

1. THE CLAIM MUST NOT WRITE processing_status. It did at first, and begin_processing's
   allowed-from set is {awaiting_processing, processing_failed} — so the claim made the very next
   transition illegal and every import failed. Ownership (lease) and lifecycle (status) are two
   axes. The eligibility rule now reads: nobody holds the lease AND the work is still wanted.
   This is also why the status is briefly stale by construction: ownership is taken first.

2. BACKOFF BINDS THE SWEEP, NOT A PERSON. Scheduling a 30s retry after a failure made the
   recruiter's "try again" wait out a machine's delay — an existing test caught it.
   claim_draft_for_processing defaults honour_retry_schedule=False; claim_stranded_drafts
   defaults True. A person pressing the button is watching, wants it now, and is already bounded
   by the attempt ceiling and the route rate limit.

CONTRACT PRESERVED: a second request while one is running still returns 200 with
outcome="already_processing" (_current_outcome), NOT a 409. The new 409s are only for cases the
old contract never had: JOB_IMPORT_ATTEMPTS_EXHAUSTED and the narrow window where ownership is
taken but the status transition has not landed.

NEXT READY: AI-001D — the sweeper that drains stranded imports (reuse the Phase 5 runner shape;
give the worker an injectable session factory, NOT app.db.session directly), plus deciding
kill-switch-while-queued semantics from the ledger.
```

## Phase 6D checkpoint (AI-001B — the atomic claim)

```text
SLICE: AI-001B — one-statement claim + stranded sweep. Not wired into the request path yet.
COMMIT: "feat(import): claim an import in one statement, not two"
MIGRATION: none. FILES: app/repositories/job_import_execution_repository.py (new),
  tests/test_job_import_execution_claim.py (new, 24 cases).

CONTRACT:
  claim_draft_for_processing(session, draft_id, worker_id=, now=)  -> draft | None
  claim_stranded_drafts(session, worker_id=, limit=, now=)         -> [draft]
  release_expired_claim(session, draft_id, now=)                   -> bool
  All three are UPDATE ... WHERE eligible ... RETURNING. Never read-then-write: two callers both
  reading a draft as free and both writing is one import becoming two provider calls and two
  bills. Same defect class as RATE-001 and the invite redemption.
  The batch claim re-checks eligibility INSIDE the write; the subquery only proposes candidates.
  PostgreSQL adds FOR UPDATE SKIP LOCKED so a second worker steps over rather than queues.

ATTEMPTS ARE COUNTED AT CLAIM, not at failure. A process that dies mid-attempt reports nothing,
so counting failures would let a crash loop retry forever — and the attempt may already have
reached the provider and been billed. Counting claims makes the ceiling bound spend.

DRIFT GUARD: the eligibility rule exists twice (pure Python for callers, SQL for atomicity).
TestTheSqlRuleAndThePythonRuleAgree writes all 189 state combinations, offers each to the claim,
and compares against may_start_attempt. It also asserts the matrix produces BOTH answers, so an
all-ineligible matrix cannot pass vacuously.

MUTATION RESULT WORTH KNOWING: rewriting the claim as select-then-decide-then-write passes EVERY
behavioural test — SQLite on one connection cannot show the race — and is caught only by
TestTheClaimIsOneStatement. Structural tests are not optional here; they are the only witness.
Live concurrency proof remains unavailable (no PostgreSQL harness, Docker absent): the CONTRACT is
implemented and tested, the distributed race is not empirically proven. Do not claim otherwise.

NEXT READY: AI-001C — wire the claim into the processing path (lease on start, release/settle on
finish, failure -> bounded retry schedule), then AI-001D worker + kill-switch-while-queued.
RESUME: cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_job_import_execution_claim.py -q
```

## Phase 6C checkpoint (AI-001A — durable execution state for an import attempt)

```text
SLICE: AI-001A — schema + pure execution rules. No behaviour change yet.
STATUS: committed. AI-001 stays IN_PROGRESS.
COMMIT: "feat(import): let a stranded import be found and retried"
MIGRATION: 0063_job_import_execution_lease, parents 0062, SINGLE HEAD. Expand only: four
  nullable/defaulted columns + two indexes on job_import_drafts. No data statement, so schema and
  code deploy in either order. Offline SQL render verified; no PostgreSQL harness (Docker absent).

THE DEFECT: an import is a request-thread operation. If the process died mid-call the draft stayed
at processing_status='processing' and nothing had reason to look at it again — the recruiter's
screen said "preparing your draft" forever. That is worse than an error: it is indistinguishable
from slow success, so nobody reports it and nothing retries it.

NEW COLUMNS (job_import_drafts): processing_lease_expires_at, processing_worker_id,
  processing_attempts, processing_next_attempt_at.
  The lease EXPIRES rather than being released — a process that crashes releases nothing.
  LEASE_SECONDS=300, deliberately > provider ceiling (90s) x2: reclaiming a merely-slow attempt
  turns one import into two provider calls and two bills. A test pins that inequality.
  attempts moved OUT of provider_metadata JSON into a column, because a bound in a JSON blob
  cannot be enforced by a query and the rows worth finding are the ones nobody is loading.
  Existing rows start at 0 — no backfill, since no consumer reads the column yet.

RULES: app/core/job_import_execution.py — pure, no session. may_start_attempt / is_stranded /
  lease_is_live / retry_delay_seconds. MAX_ATTEMPTS=5, backoff 30s..900s, deterministic.
  Deliberately does NOT fold in the kill switch or ownership: three questions in one function is
  a function trusted for none of them.

TESTS: tests/test_job_import_execution_rules.py (20) + tests/test_job_import_execution_lease_migration.py (7).
  The migration guard derives "columns some migration creates" by PARSING THE MIGRATION CHAIN,
  never from the model — a model-derived baseline agrees with itself. Proven non-vacuous by
  mutation: an injected model-only column fails it with assert not {'drift_probe'}.
  It also guards its own parser (a regex matching nothing would make everything vacuously pass).

NEXT READY: AI-001B — atomic claim (UPDATE ... WHERE eligible RETURNING; never read-then-write),
  then AI-001C wiring, AI-001D worker + kill-switch-while-queued semantics.
RESUME: cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_job_import_execution_rules.py -q
```

## Phase 6B checkpoint (AI-004 partial, AI-006 partial — a model allowlist and a readiness probe)

```text
Commit: "feat(import): refuse a model nobody chose, and say so before a recruiter waits"
Both rows are IN_PROGRESS, not VALIDATED, and the ledger says which half is missing. Claiming
either as complete would be the more comfortable lie.

WHY AN ALLOWLIST. OPENAI_MODEL was a free-form string validated by a character pattern. A pattern
cannot distinguish a typo from a different model: the typo failed every import SLOWLY, at the
provider, after the recruiter had pasted a job and watched a progress bar, and a valid-but-
unintended name SUCCEEDED — calling a model nobody chose, at whatever that model costs. The
allowlist turns both into an answer available before any request is billed.
  OPENAI_MODEL_ALLOWLIST, comma separated. Empty = the single shipped default.
  Deliberately narrow: a deployment running another model must name it. Inventing a list of
  plausible-looking model identifiers would be worse than useless — it would authorise calls to
  models nobody has chosen.
  Enforced in app/api/deps.get_job_import_provider, i.e. at the last point before a name can
  become a billed request. Reporting it on the probe alone assumes somebody reads the probe
  first, and nothing makes them.

READINESS: GET /api/v1/health/job-import -> {ready, enabled, problems[]}
  - configuration only, NO provider call: a probe that asked the provider would bill a request
    every time a load balancer looked, and would report an outage nothing here could fix.
  - always 200, including unready. A probe that 503s takes the whole process out of rotation
    over one feature.
  - switched off reports enabled:false with NO problems, so a deliberately paused feature does
    not read as a broken one on a dashboard.
  - does not echo the configured model or key; it is unauthenticated, and configuration is not
    something to hand out. A test asserts neither value appears in the body.

Nothing here refuses to boot. Import already has a kill switch, and taking the whole API down
over one feature's configuration trades a small outage for a large one.

Tests: tests/test_job_import_model_allowlist.py, 14 cases. Non-vacuity PROVEN by mutation:
removing require_allowed_model from the provider factory fails the test that builds it with an
unlisted model.

NEAR-MISS WORTH RECORDING: these tests were first written to tests/test_job_import_readiness.py,
which ALREADY EXISTED — 2,249 lines of it — and the write silently replaced the lot. Nothing
failed: the suite stayed green, because the destroyed tests simply stopped existing. It was
caught only by comparing the total against the previous run (6,930 collected where 6,977 was
expected), and restored with git checkout. Two habits follow. Check whether a test file exists
before writing one, and treat a DROP in the collected total as a failure, because a suite cannot
report tests it no longer has.

STILL MISSING, explicitly: AI-004's spend budget and thresholds need somewhere to record spend,
which does not exist yet; AI-006's queue readiness cannot exist until AI-001 does. The
token/output cap AI-004 asks for was already in the adapter before this work (max_output_tokens),
and so was store=False, the measured 90s timeout and the single transient-only retry — which is
why AI-005 and AI-009 should be surveyed before being implemented rather than after.
```

## Phase 6A checkpoint (AI-011 — the switch that actually turns AI job import off)

```text
Commit: "feat(import): give AI job import a switch that actually turns it off"
Setting: JOB_IMPORT_ENABLED, DEFAULT TRUE. No migration.
Taken out of order: the ledger lists AI-011 as depending on AI-001, but a kill switch is worth
more BEFORE a durable queue exists than after, and it depends on nothing AI-001 provides.

WHAT WAS ACTUALLY MISSING: `ENABLE_JOB_IMPORT` in lib/importJob/flag.ts hides the frontend entry
point and leaves every /api/v1/job-imports route open. Anyone with a session or a saved request
can still spend provider budget, so ending an incident meant shipping a deploy — the slowest
response to the fastest kind of problem.

WHAT "OFF" MEANS, deliberately narrow: no NEW provider work starts. It does NOT confiscate work
already done. A prepared draft can still be read and carried into Post Job, because that draft
exists, it cost what it cost, and taking it away helps nobody. Reading stored state has always
resolved to "read stored state and render it" (the pause invariant), so this fits the existing
model rather than bolting a second one beside it.

TWO PROVIDER ENTRY POINTS, both closed:
  app/services/job_import_processing_service.py  process()  -> refuse_if_disabled(), 503
  app/services/job_import_conversation_service.py may_call_provider() -> False when disabled
The check lives inside may_call_provider rather than beside its callers, for the same reason the
state rules do: a second copy of "may we call the provider" drifts, and the weaker copy becomes
the way in. app/core/job_import_availability.py is the one home for the switch, read at CALL time
— captured at import time it would need a restart, and a switch that needs a restart is not one.

UI: components/import-job/ImportJobPageClient.tsx maps JOB_IMPORT_DISABLED to its own sentence.
This is required, not cosmetic. That component deliberately refuses to render backend prose for
import failures, so without a case the refusal falls through to "try again" — the one thing that
cannot work while the feature is off, and an invitation to keep retrying through the incident
that caused it to be switched off. The backend message stays provider-neutral too; a test asserts
it names no provider, model, or flag.

TESTING LESSON WORTH KEEPING: the first version drove conversation/begin over HTTP and asserted
the provider call count stayed at zero. It passed with the switch REMOVED — the fixture drafts
sit in states that never start provider work, so the assertion could not fail. Replaced with a
direct check on may_call_provider for the two states that DO start work (source_received,
resuming), which fails correctly under mutation. The HTTP sweep is kept as a safety net for a
future route that starts work without asking, and is labelled as exactly that.

Non-vacuity PROVEN by mutation: removing refuse_if_disabled fails 3 tests; removing the
conversation gate fails both parametrised gate tests.

NOT COVERED BY A UNIT TEST, stated plainly: the frontend copy. readableImportError is private to
ImportJobPageClient.tsx and is not exported, so reaching it would mean extracting it from a
mature component — a bigger change than this slice justifies. It is typechecked, and the code
string it matches is asserted on the backend side.
```

## Phase 7D checkpoint (MEDIA-004 — a request may not decide where media lives)

```text
COMMIT: "fix(media): stop letting a request decide where media lives"
MIGRATION: none. BROAD: full backend 7,096 passed / 64 skipped / 0 failed. COLLECTION 7,157 -> 7,160.

A REAL VULNERABILITY, and a STORED one rather than reflected. Uploads built their URL from
`request.base_url`, which Starlette derives from the Host header. A request arriving with
`Host: evil.example` therefore wrote `https://evil.example/media/avatars/...` into that profile
row — persisted, and served to every later visitor of the profile. The attacker needed no access
to the account, and the poisoned URL outlived the request that planted it.

FIX: canonical_media_base_url() prefers MEDIA_PUBLIC_BASE_URL and falls back to the request only
as a development convenience. validate_production_settings() now REFUSES TO BOOT in production
without the setting, so the fallback cannot quietly become the production behaviour.
A CDN hostname is simply what that setting holds; the CDN itself is external.
Mutation-proven: preferring the request origin again fails two tests, including one that drives
the real route with a hostile Host header.

NOTE for whoever adds settings later: tests/test_config.py::_safe_production_settings is the
fixture that must gain any new production requirement, or every production-validation test fails
at once — which is what happened here and is the intended signal.
```

## Phase 7C checkpoint (MEDIA-005 partial — replacement no longer orphans)

```text
COMMIT: "feat(media): stop keeping the avatar someone replaced"
MIGRATION: none. BROAD: full backend 7,093 passed / 64 skipped / 0 failed.
COLLECTION: 7,148 -> 7,157 (+9). Accounted for.

THE DEFECT: replacing an avatar left the previous file on disk for ever. The row pointed
somewhere new and nothing pointed at the old object, so nothing could ever decide to remove it.
Storage that only grows is a bill that only grows, and every orphan is a copy of someone's face
that outlived their decision to change it.

HOW: key_from_url() resolves the superseded object from the stored URL, and returns None for
anything that is not ours — a YouTube channel image, a pre-seam URL, or a path under our prefix
that does not look like a key we would have written. That last case matters: a stored URL is
data, and data that arrives looking like a traversal must not become a delete.
ORDER: noted before the row changes, deleted AFTER it commits, so a crash in between leaves an
orphan rather than a profile pointing at a file that is gone. Cleanup can never fail the upload —
the profile is already correct and the person is waiting; a surviving file is tidiness, an error
here would be their upload appearing to fail after it worked.
Mutation-proven: removing the cleanup call fails the end-to-end test.

STILL OPEN in MEDIA-005, and named rather than implied: deleting a person's objects when their
account goes, and sweeping objects orphaned by an earlier crash. Both want a stored key column on
the row rather than parsing it back out of a URL, which is a migration and a slice of its own.
```

## Phase 7B checkpoint (MEDIA-001 — uploads go through a seam, not to a directory)

```text
COMMIT: "feat(media): put uploads behind a seam the filesystem does not own"
MIGRATION: none. BROAD: full backend 7,084 passed / 64 skipped / 0 failed.
COLLECTION: 7,123 -> 7,148 (+25 storage). Accounted for.

WHY: media goes to the application's own filesystem, which works until there is a second instance
or a redeploy onto fresh disk — then half the avatars are missing on half the requests. This does
not fix that; an object store does. It makes the fix a CONSTRUCTOR SWAP rather than a rewrite,
and pins the contract before the swap so the adapter has something to satisfy.

app/services/media_storage.py:
  MediaStorage protocol — url_for / put / delete / exists, and a test asserts it has not grown.
    Every method here is one every future adapter must implement, and the ones that are easy on a
    filesystem are the awkward ones on an object store.
  LocalMediaStorage — what runs today; its docstring says plainly it is not a production answer,
    and a test asserts the docstring still says so.
  build_object_key(prefix, owner_id, extension) -> "prefix/owner-hex/random.ext"
    Owner in the path so an object can be attributed and swept WITHOUT a database lookup — a
    deletion that has to join back to a table stops happening when the table is what is being
    cleaned up. Random suffix so knowing an account id does not let you enumerate its uploads.
  validate_object_key — refused at EVERY entry point, not just put, plus an independent
    is_relative_to check after resolution. The regex already excludes traversal; the second check
    is for the day someone loosens the regex.

The real object-store adapter (S3/R2) is BLOCKED_EXTERNAL: bucket, credentials, bill. A fake
in-memory adapter satisfying the protocol is exercised in the tests, so substitutability is
demonstrated rather than asserted.

NEXT READY: MEDIA-005 (object lifecycle — replacement currently ORPHANS the previous avatar,
which is now cheap to fix through the seam), then MEDIA-004 canonical delivery, MEDIA-002 upload
grants. Then Phase 8.
```

## Phase 7A checkpoint (MEDIA-003 — an upload is what its bytes say, not what it claims)

```text
COMMIT: "feat(media): decide what an upload is from its bytes, not its label"
MIGRATION: none. BROAD: full backend 7,059 passed / 64 skipped / 0 failed.
COLLECTION: 7,098 -> 7,123 (+25 media validation). Accounted for.

TWO REAL DEFECTS, both live before this:
  1. The stored file's extension came from the CALLER'S content_type. Anyone could declare
     image/png, upload something else, and have it served from this application's own origin at
     a .png path. What a browser does with same-origin bytes depends on how it sniffs them, and
     "depends" is not a security property.
  2. Bytes were stored exactly as received, EXIF included. A creator uploading an avatar taken on
     a phone was publishing the GPS coordinates of where they took it, next to their face.

NOW: app/services/media_validation.py — sniff the format from the bytes, refuse a declared type
that disagrees, derive the extension from the sniffed type, cap PIXELS as well as bytes (a
200-byte PNG can declare 60,000x60,000; the byte ceiling cannot see that at all), and strip
metadata. Fails CLOSED: a container it cannot parse is refused, because "we could not tell" and
"it is fine" are different answers.

NOT DONE, and it is the strongest version: RE-ENCODING. Decoding and re-emitting neutralises
anything hiding in a container this code parses correctly but a decoder reads differently. It
needs an imaging library (no Pillow in the venv), which is a dependency decision against a locked
contract, not a coding one. Everything above is what can be done exactly with no new dependency.
GIF metadata is passed through — its extensions interleave with frame data and a wrong rewrite
corrupts the image; GIFs carry no EXIF, so the exposure that motivated this is absent there.

FOUND ON THE WAY: the banner test fixture was a CORRUPT PNG — its IDAT length field said 11 while
the chunk was 13 bytes (CRC-verified). Nothing had ever parsed it, so it passed. Replaced with a
valid generated PNG. If another image fixture starts failing, check the file before the parser.
```

## Phase 8B checkpoint (REALTIME-003 + REALTIME-002 — degraded operation, and what typing already did)

```text
COMMIT: "feat(realtime): keep the record when the hint does not arrive"
MIGRATION: none. BROAD: full backend 7,121 passed / 64 skipped / 0 failed.
COLLECTION: 7,178 -> 7,185 (+5 degraded, +2 typing). Accounted for.

REALTIME-003: the claim "realtime is a hint, not a record" is easy to make and easy to stop being
true — one publish moved above a commit and a broker outage loses a message. So it is tested from
the OUTSIDE: a completely broken bus, a real message sent through the real route, and then the
message must exist, read back over HTTP, and still count as unread. That read-back IS the
reconnect path, which is why no separate replay mechanism is needed.
Mutation-proven: removing the publish try/except fails three tests, including both end-to-end.

GET /api/v1/health/realtime -> {configured, cross_instance, problem}
  `configured` and `cross_instance` are deliberately separate: an operator needs to distinguish
  "a broker is delivering across instances" from "this process is talking to itself", and those
  look identical from every other angle. Leaks no URL or credential — it is unauthenticated.

REALTIME-002: typing ALREADY had a 6-second expiry, disconnect cleanup, and multi-tab handling
("typing elsewhere") before this phase. Now pinned: a disconnect must tell the other side typing
stopped, and the expiry must stay short — a stuck "typing…" is a lie that persists, and a
long one is the same lie more slowly.
PRESENCE HAS NO PRODUCT SURFACE. No endpoint, model or UI exposes online status. There is nothing
to give TTL semantics to, and building one would be inventing a feature rather than hardening
one. Recorded in the ledger as such rather than left looking unfinished.

Test note: typing events are conversation-scoped, so a test recipient must SUBSCRIBE to the
conversation before it can observe them. An unsubscribed socket sees nothing and the test reads
as a missing feature.

NEXT READY: Phase 8 certification, then Phase 9 (privacy/legal/moderation mechanics).
```

## Phase 8A checkpoint (REALTIME-001 — the seam a second instance plugs into)

```text
COMMIT: "feat(realtime): give events a seam a second instance can plug into"
MIGRATION: none. BROAD: full backend 7,114 passed / 64 skipped / 0 failed.
COLLECTION: 7,160 -> 7,178 (+18 realtime bus). Accounted for.

WHAT WAS ALREADY RIGHT — do not rebuild it: app/realtime/events.py emits only AFTER the database
commit, payloads already carry event_id, and authorization (including the blocking check) is
decided server-side per recipient. The architecture the phase asks for was already the one in
place: DB commit -> durable truth -> realtime hint -> client reconciles.

WHAT WAS MISSING: publish_to_user delivered only to sockets in THIS process. With a second
instance that fails silently — someone connected to instance 2 never sees a message sent through
instance 1, nothing errors, and the symptom is a conversation that looks dead until reload.

NOW: app/realtime/bus.py
  RealtimeEvent(event_id REQUIRED, user_id, payload, conversation_id) — an event without an id
    cannot be deduplicated, and "usually unique" is not an identity.
  RealtimeBus protocol + InProcessRealtimeBus (exactly the previous behaviour).
  DeliveryDeduplicator — PER CONNECTION, not per user: two tabs are two audiences. Bounded
    OrderedDict (256) because an unbounded set lives as long as an idle socket; a redelivered
    event is refreshed so it cannot age out and arrive again as new.
  publish_to_user never raises: the message is already committed and the client reconciles over
    HTTP, so a broker hiccup must not report a failed send.
  build_realtime_bus() REFUSES in production unless ALLOW_PROCESS_LOCAL_REALTIME_IN_PRODUCTION.
    Two instances each talking to themselves look healthy from every angle. Configuring a bus
    name that is not implemented also refuses rather than falling back — silent process-local
    delivery wearing the name "redis" is the exact failure, disguised.

Mutation-proven: removing the dedupe check fails the duplicate-delivery test.

BLOCKED: the Redis/NATS adapter and real cross-process delivery proof (no broker available).
The CONTRACT is implemented and tested; multi-process delivery is not empirically proven.

NEXT READY: REALTIME-003 (degraded operation — reconnect reconciliation over HTTP), then
REALTIME-002 (typing/presence TTL; typing expiry already exists in the manager, check before
building).
```

## Phase 9B checkpoint (PRIV-006 — what a person can switch off)

```text
COMMIT: "feat(consent): let people switch off the mail we chose to send them"
MIGRATION: 0066_notification_preferences, parents 0065, SINGLE HEAD, new table only.
BROAD: full backend 7,161 passed / 64 skipped / 0 failed. COLLECTION 7,201 -> 7,225 (+24).

THE ASYMMETRY, which mirrors the Phase 5 suppression rule deliberately:
  ESSENTIAL (transactional + all auth mail) is always sent. Let someone unsubscribe from these
  and they can lock themselves out of their own account by clicking a link at the bottom of an
  email they did not want — the reset they request next never arrives and nothing explains why.
  OPTIONAL (lifecycle, digest) is theirs to refuse completely.
  An UNKNOWN event key is treated as ESSENTIAL. The failure directions are not symmetric: wrongly
  sending one email is a nuisance, wrongly withholding a password reset is a lockout.
  selectable_categories() never offers an essential one — a switch that does nothing is worse
  than no switch, because the person believes they unsubscribed.

STORED AS OPT-OUT: absence of a row means subscribed. The other way round, a category added next
year arrives switched off for every existing account — a feature nobody can find, failing
silently. A row per (user, category), idempotent, so a link clicked twice or prefetched by a mail
client means one refusal.
A user_id of None (mail to someone with no account, e.g. an invitation) has refused NOTHING;
reading that as "refused everything" would stop the one message that matters most.

ENFORCED IN THE WORKER, beside suppression and for the same reason: someone can unsubscribe after
their mail is queued, and that queued mail is exactly what must not go out.
Mutation-proven: removing the consent check fails the opted-out test.

TWO TESTING LESSONS FROM THIS SLICE, both worth keeping:
1. The Phase 5C outbox trap AGAIN: process_outbox_once claims the WHOLE table, so these tests
   passed alone and failed in the suite by counting other tests' queued mail (claimed=10, sent=10).
   Any test that runs the worker needs the autouse delete(EmailOutbox) fixture.
2. The character-counting method used to verify collection movement is only valid on a log with
   NO tracebacks — failure output is prose, and prose is full of "s" and "E". It reported 7,673
   total and 357 skips for a run that actually had 15 failures. The count check now asserts the
   log contains no FAILED/ERROR before trusting the numbers.

UNSUBSCRIBE LINK (same phase, next commit): app/services/unsubscribe_tokens.py + POST
/api/v1/unsubscribe. UNSUBSCRIBE_TOKEN_SECRET, unset = refuse.
  - HMAC over (user_id, category). The obvious version carries a raw user id, and anyone who saw
    one URL could switch off a stranger's mail by changing it — no login, no trace, and a victim
    who only notices when something they wanted stops arriving.
  - NO EXPIRY, deliberately and unlike every other signed link here: it lives as long as the
    email holding it, and someone clearing a two-year-old inbox is exactly who should be able to
    use it. A test asserts the absence so a future "harden it" change has to argue with the
    reason.
  - Scoped to ONE category, so a digest's link cannot switch off everything.
  - POST only. Mail clients and scanners follow links to prefetch them, so a GET that changes
    state means being unsubscribed by your own spam filter. A test asserts GET does nothing.
  - An essential category is refused even if a token names one.
  Mutation-proven: removing the signature comparison fails four tests.

NEXT READY: PRIV-002 export, PRIV-003 deletion. Both are large; decompose. Survey first — the
admin panel already has an append-only audit rule and suspension enforcement.
```

## Phase 9A checkpoint (PRIV-001 — versioned legal acceptance)

```text
COMMIT: "feat(legal): record which version someone agreed to, not that they agreed"
MIGRATION: 0065_legal_acceptances, parents 0064, SINGLE HEAD, new table only.
BROAD: full backend 7,137 passed / 64 skipped / 0 failed. COLLECTION 7,185 -> 7,201 (+16).

WHY A TABLE AND NOT A FLAG: the question asked later is never "did they accept". It is "what did
they accept, and when", usually by someone establishing whether a specific person saw a specific
clause. A boolean overwritten at the next version change cannot answer that and cannot be
reconstructed afterwards. Rows are written, never updated.

THE RULE (app/core/legal_documents.py, pure): outstanding_documents(accepted) compares against
the CURRENT version, so someone who accepted last year's terms is treated exactly like someone
who accepted nothing. Anything softer lets a change to the terms take effect without agreement.
Mutation-proven: relaxing it to "any acceptance counts" fails two tests.

VERSIONS LIVE IN CODE, not in the database. A document's wording ships with the release that
references it, so the version a running server asks for is always one whose text exists. A
database-held current version could name a document this build cannot render.
Versions are DATES (2026-06-01) rather than counters: acceptance records get read by people
asking "what were they shown in June".

IDEMPOTENT BY CONSTRUCTION: INSERT ... ON CONFLICT DO NOTHING on (user, document, version). A
double-click or client retry is ONE agreement; a second row would suggest a separate act of
consent that never happened. Not "select then insert", which races exactly the double-click it
is meant to survive.

DELIBERATELY ABSENT: any legal wording. A test asserts the module contains none — writing and
reviewing the text is LEGAL-001/002 and external, and a build must not ship prose nobody
approved. The version registry is the machinery that will carry whatever the wording becomes.

NEXT READY: the acceptance API surface (present outstanding documents, record acceptance), then
PRIV-006 notification consent, PRIV-002 export, PRIV-003 deletion. SURVEY FIRST — the admin
panel already has an append-only audit rule and suspension enforcement.
```

## Phase 8 certification — LOCALLY COMPLETE

```text
Scope: realtime and shared state. The important finding is what did NOT need building.
app/realtime/events.py already emitted only after the database commit, decided authorization per
recipient (including the blocking check), and sent hints rather than records. The phase's target
principle was already the implementation, so the work was a seam and its guarantees.

  REALTIME-001  IMPLEMENTED  RealtimeBus seam, event envelope with a REQUIRED id, per-connection
                             at-least-once dedupe, publish that can never fail a write, and a
                             production refusal of the process-local bus.
  REALTIME-002  VALIDATED    typing expiry/disconnect/multi-tab already existed and is now
                             pinned. PRESENCE HAS NO PRODUCT SURFACE — nothing to give TTL to.
  REALTIME-003  IMPLEMENTED  canonical state proven to survive a total realtime outage through
                             the real route; /api/v1/health/realtime separates "configured" from
                             "cross_instance".

Evidence, uncontended and local:
  backend      7,121 passed / 64 skipped / 0 failed   (Phase 8 start: 7,096)
  frontend     1,181 passed / 0 failed;  tsc --noEmit exit 0
  ruff         clean on every changed file (app/realtime/events.py carries a pre-existing
               import-order finding, untouched by this phase and part of the known baseline)
  alembic      single head 0064; Phase 8 added no migration
  collection   7,160 -> 7,178 -> 7,185, every delta accounted for

NOT PROVEN, and not claimed: real cross-process delivery. No broker is available, so the bus
contract is implemented and tested while multi-instance delivery is unverified. The refusal in
build_realtime_bus() is what stops that gap being discovered in production instead of here.

Three decisions worth carrying:
  - dedupe is PER CONNECTION. Two tabs are two audiences; per-user dedupe would silence the
    second tab, and per-process dedupe would silence a reconnect.
  - a publish that fails is logged and swallowed. The message is already committed and the client
    reconciles over HTTP, so raising would report a failed send for a message that was sent.
  - configuring a bus that is not implemented REFUSES rather than falling back. Silent
    process-local delivery wearing the name "redis" is the same failure in disguise.
```

## Phase 7 certification — LOCALLY COMPLETE

```text
Scope: durable media. Two real defects were found and fixed here, neither of which was on the
ledger as a known bug — they were found by reading the upload path.

  MEDIA-001  IMPLEMENTED   MediaStorage seam + LocalMediaStorage + owner-scoped unguessable keys
                           validated at every entry point. Object-store adapter BLOCKED_EXTERNAL.
  MEDIA-002  DEFERRED_WITH_RATIONALE  grants/quarantine protect a direct-to-bucket architecture
                           that does not exist here; every byte is validated before storage.put.
  MEDIA-003  IMPLEMENTED   format decided by BYTES, mismatch refused, pixel caps, EXIF/XMP/text
                           stripped. Re-encoding not done: needs an imaging library.
  MEDIA-004  IMPLEMENTED   stored URLs come from MEDIA_PUBLIC_BASE_URL; production will not boot
                           without it.
  MEDIA-005  IN_PROGRESS   replacement no longer orphans. Account-deletion cascade and an orphan
                           sweep remain, and want a stored key column.

THE TWO DEFECTS, stated plainly because they were live:
  1. The stored file's extension came from the caller's declared content_type, so anything could
     be uploaded as image/png and served from this application's own origin at a .png path.
  2. Stored media URLs were built from the request Host header, so a poisoned Host was PERSISTED
     into a profile and served to every later visitor. Stored, not reflected.
  A third, smaller: an avatar taken on a phone published its GPS coordinates. Now stripped.

Evidence, uncontended and local:
  backend      7,096 passed / 64 skipped / 0 failed   (Phase 7 start: 7,034)
  frontend     1,181 passed / 0 failed;  tsc --noEmit exit 0
  ruff         clean on every changed file
  alembic      single head 0064; Phase 7 added no migration
  collection   7,098 -> 7,123 -> 7,148 -> 7,157 -> 7,160, every delta accounted for

Found on the way, worth knowing: a test fixture PNG was CORRUPT — its IDAT length field disagreed
with the chunk by two bytes (CRC-verified). Nothing had ever parsed it, so it passed for as long
as it existed. If an image fixture starts failing after a parser change, check the file first.
```

## Phase 6 certification — LOCALLY COMPLETE

```text
Scope: AI Job Import production hardening. The feature is unchanged as a product — source text,
interpretation, a canonical draft, the SAME Post Job flow, human review, publication. Nothing was
made "safe" by making it useless: no inference was removed, no second review surface added, and
no route can publish.

  AI-001  IMPLEMENTED  durable execution: lease, atomic claim, bounded attempts, retry schedule,
                       sweep. Live multi-worker race NOT proven (no PostgreSQL harness).
  AI-002  VALIDATED    creation idempotency predates this work; the expensive half now asserted
                       as a call count — a repeat buys no second draft and spends no attempt.
  AI-003  IMPLEMENTED  per-user quota consumed in one statement, window reset inside it.
                       Migration 0064. Same concurrency caveat as AI-001.
  AI-004  IN_PROGRESS  allowlist + output cap done; spend bounded in ATTEMPTS. A budget in
                       CURRENCY is BLOCKED_PRODUCT_DECISION — needs real per-model prices.
  AI-005  VALIDATED    by survey: measured 90s timeout, one transient-only retry, retry-after.
  AI-006  VALIDATED    /api/v1/health/job-import: credential, model, queue recovery. No provider
                       call — a probe that asked the provider would bill a load balancer.
  AI-007  VALIDATED    by survey: no route publishes; can_publish_directly asserted False in
                       three suites; injection cannot write publication state.
  AI-008  VALIDATED    by survey: URL import inherits SafeOutboundFetcher from Phase 2.
  AI-009  VALIDATED    payload minimization PINNED — permitted fields enumerated so the payload
                       fails when it grows; extra="forbid" proven; store=False asserted.
  AI-010  IMPLEMENTED  large corpus predates this phase, including prompt injection.
  AI-011  VALIDATED    real server-side kill switch (JOB_IMPORT_ENABLED).

Evidence, uncontended and local:
  backend      7,034 passed / 64 skipped / 0 failed   (Phase 6 start: 6,913 / 64)
  frontend     1,181 passed / 0 failed;  tsc --noEmit exit 0
  ruff         clean on every changed file
  alembic      single head 0064_job_import_quota_counters; 0063 and 0064 render both ways offline

Collection movement across the phase was checked at EVERY broad run and every delta accounted
for: 6,977 -> 7,018 -> 7,048 -> 7,065 -> 7,086 -> 7,098. A drop is treated as a failure even at
zero reported failures — that rule exists because a file overwrite once removed 47 tests silently.

Three design decisions worth carrying forward:
  - the sweep NEVER calls the provider. Unattended retries spend money for someone who is not
    there to see the result, and it is what makes the sweep safe to run while the kill switch is
    off — which is exactly when someone is trying to stop provider work.
  - backoff restrains the machine, not the person. A recruiter pressing "try again" does not wait
    out a delay the system invented for itself.
  - ownership (lease) and lifecycle (status) are separate axes. Conflating them made the very
    next state transition illegal and broke every import; the tests caught it immediately.

Two structural lessons: on SQLite a read-then-write rewrite passes EVERY behavioural test for
both the claim and the quota. Structure is the only witness there, which is why those tests
exist and why they are mutation-checked.
```

## Phase 5 certification — LOCALLY COMPLETE

```text
Scope: invite-only beta and durable transactional email.
Status: every row VALIDATED except EMAIL-005, which is BLOCKED_EXTERNAL and cannot be closed from
        this machine. Certifying the rest does not certify EMAIL-005 and must not be read that way.

  INVITE-001  VALIDATED  invitation bound to one address and one use; single use enforced by the
                         write (redeemed_at IS NULL), not by a read
  INVITE-002  VALIDATED  one gate, called before create_user on BOTH the password and Google
                         paths; redemption in the same transaction as the account
  EMAIL-001   VALIDATED  lease/claim in one statement, bounded retries, provider seam, worker
  EMAIL-002   VALIDATED  auth mail queued inside the transaction; runner.py drains the queue
  EMAIL-003   VALIDATED  event mail proven queued-to-sent and retried; second delivery path removed
  EMAIL-004   VALIDATED  asymmetric bounce/complaint suppression; signed, replay-resistant webhook
  EMAIL-005   BLOCKED_EXTERNAL  sending domain, SPF, DKIM, DMARC, bounce domain, provider staging
                         send. Needs DNS and a paid provider; both are outside the mandate.

Evidence, all uncontended, all local:
  backend      6,903 passed / 64 skipped / 0 failed   (Phase 5 start: 6,845 / 64)
  frontend     1,181 passed / 0 failed  (node --test)
  typescript   tsc --noEmit, exit 0
  ruff         clean on every changed file; whole-tree findings remain the known baseline
  alembic      single head 0062_email_suppressions; 0060, 0061, 0062 upgrade AND downgrade render
               offline. No PostgreSQL harness was run: Docker is unavailable here, and that is an
               environment limitation, not a passing result.

Non-vacuity was proven by mutation for every protection added in this phase, not assumed:
  gate removed from both signup paths      -> uninvited signup returns 200, test fails
  redemption returned to read-then-write   -> the same invitation is redeemed twice, test fails
  inline send restored                     -> the two provider-call-counting tests fail
  runner error guard and event wait removed-> survive-a-bad-pass and shutdown-latency tests fail
  signature and suppression checks removed -> 6 tests fail, including every forgery case

What is deliberately NOT built, so nobody mistakes it for an oversight:
  - the invitation EMAIL. Nothing issues invitations over HTTP yet, so there is no place to send
    it from; the event key auth.invitation is reserved and the queue is ready.
  - an operator view of failed/suppressed rows. EMAIL-002 removed a 503 that made a provider
    outage loud in the request; a misconfigured provider is now visible only in worker logs and
    in rows reaching MAX_ATTEMPTS. That view belongs with the admin panel.
  - anything that would need a real provider, a real domain, or DNS.

Posture on deploy: every new switch is off by default. INVITE_ONLY_BETA unset preserves open
registration exactly; EMAIL_WORKER_IN_PROCESS unset means the API hosts no worker; an unset
EMAIL_WEBHOOK_SECRET refuses every delivery report rather than accepting unsigned ones. Deploying
this phase changes no behaviour until someone turns something on, which is the point.
```

## Phase 4 certification — LOCALLY COMPLETE

```text
Certified at: Phase 4 certification commit (self-resolve with `git log -1 --format=%H`)
TypeScript: PASS. ESLint: 0 errors / 33 known warnings.
Frontend unit: 1,181 passed / 0 failed.
Standard browser (parallel): 466 passed / 4 failed  (baseline was 447 / 23)
QA browser (parallel):       289 passed / 1 failed / 2 skipped  (baseline was 285 / 5)
Serial re-run of all 5:      32 passed / 0 failed  -> every one is parallel-load flake.

DETERMINISTIC FAILURES: 23 -> 0.

Contract reconciliation worth knowing about: `tests/jobCreationUiPolish.test.mjs` pins
PostJobPage source and asserts "remote geography survives hydration", which reads as a
contradiction of the QA contract that a remote job must drop its city. It is not. The polish test
governs hydration and save; the QA test governs a work-mode change. Clearing lives in
`onWorkModeChange` and fires only when the mode crosses the Remote boundary, and hydration strips
only the bare "Remote" sentinel — a deliberately typed "Remote, India" survives both. The source
assertions now state that reconciliation instead of either side being loosened.

Known flaky under parallel load (pass serially, do not chase without reproducing serially first):
  dev-tools.spec.ts:64, post-job-languages.spec.ts:30, settings.spec.ts:428,
  talent-browse.spec.ts:73, qa/workspace-performance.spec.ts:108
```

## Phase 4 progress log (families resolved)

```text
adaptive-profile-overview (3 failures) — FIXED, commit "test(profile): point the recruiter views at identities that exist"
  Cause: the demo marketplace fixture was rewritten. `finance-creator`/"Finance Channel" and
  `example-agency`/"Example Creator Agency" no longer exist in fixtures/demo_job_marketplace.json;
  the current identities are anika_demo/"Money & Mindset" (creator-led) and
  northstar_demo/"Northstar Creator Agency" (agency, carries managed_by_agency_name).
  Product contract was correct throughout — only the entities were stale.
  Verified against the running mock server rather than inferred: /jobs/1 renders
  /u/anika_demo?view=hiring and NO external channel link, because JobHero passes
  channelExternalUrl only for agency posts. Job 1 used to be agency-posted, which is why the
  old test asserted a YouTube href.
  Coverage improved rather than reduced: the entry-point test now checks both branches —
  a creator post (profile link only) and an agency post (/jobs/2: agency profile link plus
  the channel's external page).
  7/7 pass serially.
```

candidate-job-experience (3 failures) — FIXED, commit "test(jobs): assert the application contract the product actually has"
  Three separate causes, none a product defect:
  (a) :118 expected "9 requested details"; the rewritten fixture gives job 1 eleven. Count updated.
  (b) :168 asserted job 4 opens https://example.com/... in a new tab. That contract was
      RETIRED on purpose — `applicationPreflightForJob` pins `mode: "internal"` and nulls
      `externalUrl`, commenting that a stored external mode "belongs to some other hiring
      process the platform never saw and cannot record" and that honouring it "let an old
      record send candidates off the platform". The fixture still carries the old field, so
      job 4 is the exact regression case; the test now asserts the stored URL never becomes a
      link and no popup occurs. Safety property preserved, correctly aimed.
  (c) :208 used `getByText(/^Apply by /)`. The deadline is now folded into the application
      instructions by design ("a deadline is part of the instructions, not a row of its own"),
      so the element starts with the how-to-apply sentence. Now asserts the deadline is visible
      and has not lapsed, which is stricter than the anchor was.
  A disclosure I briefly added to JobActionsPanel was reverted once the code showed external
  apply is a removed feature rather than a missing disclosure.
  7/7 pass serially.

beta-review-safety (3) + phase3b-detail-post (1) — FIXED, commit "test(trust): stop treating a real price as a fake trust signal"
  beta-review-safety: all three failures matched ONLY the `USD|\$[0-9]` clause — no fake-review or
  retired-copy hits. That clause dates from a rupees-only demo corpus; the corpus now carries
  genuinely USD/EUR jobs and TRUST-001 requires showing the posted amount and currency, so
  suppressing "$450–$700 per video" would be the fabrication. Clause dropped, everything else kept.
  Whether the correct currency is shown per job is TRUST-001's contract and remains NOT_STARTED.
  phase3b :27: "About the opportunity" became `aboutBrandLabel` → "About {brand}". Asserting the
  brand-named heading is stronger: it proves the job is attributed to a real hiring identity.

  FINDING FOR TRUST-003 (marketplace metrics, NOT_STARTED) — not actioned here, deliberately.
  `JobActionsPanel` renders StatTiles for Applicants / Views / Response rate, and listing cards
  show "284 Views · 11 Applicants · 86% Response rate" plus talent-side "Currently viewing /
  Interested recruiters / Response rate". These are fixture-seeded demo numbers. Two existing
  tests actively assert they stay visible (phase3b :168 "keeping activity stats", :184 "persisted
  job stats remain visible"), so removing them is a product-policy decision that belongs to
  TRUST-003 with its own slice — not something to smuggle into a browser-test repair. Whoever
  takes TRUST-003 should expect to change those two tests as part of it.

smoke (2) + phase3a-polish (1) + post-job-languages (1) — FIXED, commit "test(phase4): follow the screens and titles the product moved to"
  smoke /jobs/1 route text: job 1 was retitled by the fixture rewrite ("Video editor for YouTube"
  -> "Long-form YouTube editor for evidence-led finance stories").
  smoke :452 and phase3a :31: the same two retirements already handled elsewhere — external apply
  is pinned internal, and the currency clause is stale under TRUST-001.
  post-job-languages :30: screening questions moved from the EVALUATION screen to APPLICATION
  REQUIREMENTS (they sit beside the materials an applicant must include). The test now asserts the
  separation in both directions: absent on Evaluation, present on Applications.
  Noted, not fixed: the APPLICATION REQUIREMENTS heading renders twice on that screen, so the
  assertion uses .first(). Whether that duplication should exist is CORRECT-006 (Duplicate UI
  identity), which is NOT_STARTED and owns it.

mobile-overflow (2) + applications-pipeline (1) — FIXED, commit "test(phase4): measure overflow on a form that still exists, and click the row"
  mobile-overflow: both viewports failed on SETUP, not on overflow — the test grew the form by
  adding a Language requirement, and language requirements were deliberately removed from
  post-job (a sibling test asserts their absence). Re-based on the tools tag input, which grows
  the form the same way and exercises a long unbroken token, the harder overflow case at 320px.
  The footer button is labelled "Continue" now, not "Continue to step N". The overflow assertions
  themselves were never the problem and now actually run at both widths.
  applications-pipeline :286: a genuine locator defect. The card is not a button — its profile
  link, checkbox and stage menu all stopPropagation by design — so Playwright's default centre
  click lands on a child and the row handler never fires. Verified by probe: clicking the labelled
  Message button opens the dock, clicking the card centre does not. Switching the test to the
  button would have made it a duplicate of :486 and hidden the row behaviour, so it clicks the
  card's own surface at an offset instead.

PHASE 4 STANDARD BASELINE NOW: 18 deterministic failures -> 0.

QA: craft-ambiguity (1) + post-job-later-steps (1) — FIXED, commit "fix(post-job): stop a remote job from claiming a city"
  craft-ambiguity :76 answered the baseline's open question (did presentation leak into selection,
  or is the test stale?): neither exactly — the TEST read the option chip's whole innerText, which
  now carries a "Likely match" badge on a second line, and compared it to
  primary_role_name_snapshot. The product correctly stores "Video Editor". Expectation now takes
  the label line.
  post-job-later-steps :669 was a GENUINE PRODUCT DEFECT with two layers:
    (1) onWorkModeChange never cleared the city when the mode crossed the Remote boundary, where
        the field changes meaning — office location vs optional candidate restriction. A job moved
        from Hybrid-in-Kolkata to Remote kept advertising Kolkata. Now cleared on crossing, and
        deliberately NOT between On-site and Hybrid where the meaning is unchanged.
    (2) Fixing (1) revealed the value becoming "Remote": the payload writes `location: "Remote"` as
        a sentinel for "remote, no restriction", and rehydration copied it into the
        candidate-location input — storage bookkeeping displayed as recruiter input, and persisted
        as a real restriction on the next save. Rehydration now refuses the bare sentinel.
  31/31 post-job-later-steps pass; craft-ambiguity passes.

QA: qa-personas (2) + draft-assistant (1) — FIXED, commit "test(qa): measure the bubble once it has landed"
  qa-personas :488 was a strict-mode violation, not a product bug: job-apply-button renders twice
  (desktop panel + mobile sticky bar) with exactly one visible per viewport, and every other spec
  already scopes to `:visible`. 29/29 now, including :602 which the baseline had called flaky.
  draft-assistant :581 was a measurement race, not a layout defect. `ui-bubble-in` animates
  translateY(6px) -> 0 over 240ms; the test measured the typing bubble mid-flight while still
  lifted, so the gap read -1.6px. Replaced the instantaneous read with expect.poll on the gap —
  identical bounds, taken once the animation settles. Not a sleep: a deterministic wait for a
  defined end state. 34/34.

QA: applicant-requirements (1) — FIXED, commit "test(qa): give the resume field a link, because it asks for one"
  Diagnosis chain worth keeping: the ARIA snapshot showed no error (it does not render input
  values), so instrumenting the network was decisive — NO POST fired at all, which ruled out the
  server and pointed at client validation. Dumping the modal text showed "Resume or CV link —
  Enter a valid link." Job 1's requirements grew 9 -> 11 in the fixture rewrite, adding `resume`,
  and the test filler only treated `relevant_portfolio` as a URL field, so it typed prose into a
  link input. The product was correct the whole time.
  3/3 pass.

PHASE 4 DETERMINISTIC FAILURES: 18 standard + 5 QA (23 total) -> 0.
Of those 23, exactly ONE was a product defect (the remote-city bug, two layers). Two were real
test-harness defects (pipeline centre click hitting a stopPropagation child; apply-button strict
mode). One was a measurement race against the ui-bubble-in entry animation. The rest were
expectations that had drifted from a rewritten demo fixture or from deliberate product decisions.

## Phase 4 browser baseline — ESTABLISHED (this replaces the stale 17/6 numbers)

Measured after RATE-004, at commit `d3036da`. Both matrices run in full, then the
standard failures re-run serially with `--workers=1` to separate real defects
from parallel-load flake. **Use this, not the Phase 0 numbers.**

```text
QA (real backend)        285 passed /  5 failed / 2 skipped   (19.1m)
Standard (parallel)      447 passed / 23 failed               ( 7.0m)
Standard (serial re-run) 214 passed / 18 failed               ( 6.4m)  <- the baseline
```

**QA — 5 deterministic failures, and this set is trustworthy.** Every one is
from the original recorded Phase 0 list, and no new failure appeared even though
host load reached 19 during the run, which is what makes it credible rather than
lucky:

```text
applicant-requirements.spec.ts:173   submitted application modal never closes
craft-ambiguity.spec.ts:76           persisted role snapshot lacks "Likely match"
draft-assistant.spec.ts:581          typing indicator overlaps the submitted reply
post-job-later-steps.spec.ts:669     onsite→remote retains the city instead of clearing
qa-personas.spec.ts:488              duplicate job-apply-button test IDs
```

The historical sixth item, `workspace-performance.spec.ts:108`, **passes** —
confirmed twice now. The recorded "6 QA failures" is genuinely 5.

**Standard — 18 deterministic failures.** Five of the 23 parallel failures did
not reproduce serially (`settings`, `listing-card-actions`, `seo-filter-routes`,
`workspace-ia`, `you-applications`) and are parallel-load flake. One failure
appeared only in the serial pass (`phase3b-detail-post.spec.ts:164`), which is
the same family as `:27`. Grouped by what they are actually about:

```text
adaptive-profile-overview  :86 :134 :180   recruiter/agency profile views + entry links
applications-pipeline      :286           pipeline row → chat dock handoff
beta-review-safety         / /jobs /jobs/1  beta trust copy on three surfaces
candidate-job-experience   :118 :168 :208  internal/external application behaviour
mobile-overflow            390px 320px    /post-job horizontal overflow
phase3a-polish             :31            search empty/results states
phase3b-detail-post        :27 :164       job detail + card activity stats
post-job-languages         :30            multi-screen Post Job
smoke                      :69 :452       /jobs/1, external apply semantics
```

Failure types: 17 are assertion failures (`toBeVisible`, `element(s) not found`,
`not.toContainText`) — genuine product contracts, not timing. Exactly one is a
`page.goto` timeout and may be contention; re-check that one first.

Two historical items no longer reproduce at all (`dev-data-source`,
`talent-browse`), so the stale list was wrong in both directions.

**Method note for whoever continues.** Host load moved from 3.8 at launch to 19
during the QA run and was still ~14 during the serial pass. The serial numbers
are usable anyway because `--workers=1` removes the contention sensitivity and
because the failures are assertions rather than timeouts — but a genuinely quiet
host would still be better before fixing the one timeout.

**Note on `beta-review-safety` and `phase3b-detail-post`:** several of these
concern *fabricated marketplace metrics* (response rates, activity stats). The
standing product-truth rule says never invent job views, response rates or
demand. Read those tests before "fixing" them — the correct fix may be removing
a metric rather than making one appear.

## Phase 3I atomic checkpoint (RATE-004 — request-body bounds)

```text
Phase: Phase 3, atomic slice 3I / RATE-004 — request-body safety at the ASGI boundary
Status: COMPLETE for the body-size half of RATE-004. Timeout/concurrency ceilings remain, and the concurrency parts still depend on RATE-001
Initial HEAD: c08dd043444ca9c336791b49e61b035a64859cae
Final HEAD: Phase 3I checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(http): bound a request body before it is anything but bytes
Files materially changed: new `backend/app/middleware/request_body_limit.py`; new `backend/tests/test_request_body_limit.py`; `backend/app/core/config.py` (two settings); `backend/app/main.py` (middleware registration)
Migrations: None. Dependency changes: none
DEFECT FIXED: nothing bounded an inbound request body. The nearest thing was `MAX_AVATAR_UPLOAD_BYTES`/`MAX_BANNER_UPLOAD_BYTES` in `profile_service`, which are honest about intent but run at `len(image_bytes)` — after the body has been received, buffered, JSON-parsed and base64-decoded. Every one of those steps allocates, so a few hundred megabytes of JSON was fully in memory before anything objected
ARCHITECTURE: pure ASGI middleware, deliberately not `BaseHTTPMiddleware`, because the guarantee depends on controlling `receive` directly. Two independent rules: (1) a declared `Content-Length` over the ceiling is refused without reading a byte; (2) bytes are counted as each `http.request` message arrives, so omitting `Content-Length` and streaming buys nothing. Rule 2 is the one that matters — treating the declared length as the whole defence means anyone willing to drop the header faces no limit at all. It never buffers: a limiter that reads the body to measure it has moved the unbounded allocation rather than prevented it
PLACEMENT: registered first, so it runs innermost — inside CORS, QA audit and request-id. Nothing outside it reads the body, so the memory guarantee is identical wherever it sits, but from here the 413 travels back out through those layers and therefore carries CORS headers and `X-Request-ID`. A browser cannot read a 413 that CORS never touched
LIMITS, derived rather than chosen: the largest legitimate payload is the **banner**, not the avatar — 8 MiB decoded, which is roughly 10.7 MiB once base64's 4/3 expansion, the data-URL prefix and JSON quoting are counted. Media ceiling is 12 MiB (`MAX_MEDIA_REQUEST_BODY_BYTES`); everything else gets 2 MiB (`MAX_REQUEST_BODY_BYTES`), comfortably above job-import source text at 100,000 characters. A test asserts the media ceiling can still fit a real banner, so a future tightening cannot silently break uploads. Both settings have a floor of 64 KiB so they cannot be configured into uselessness
ROUTE POLICY: exact path equality only, against `{api_v1_prefix}/me/avatar` and `/me/banner`. Prefix or substring matching would let a caller claim the larger allowance with a crafted path; `/me/avatarx` is tested and gets the default. Unrecognized paths fail toward the smaller ceiling
LAYERING: this does not replace the decoded checks in `profile_service` and must not be made to. The outer bound protects the process and cannot know that 9 MiB of base64 decodes to something too large to be an avatar; the inner bound protects product meaning and cannot run before the allocation it is trying to bound
Tests: 25 focused middleware cases covering empty/at-limit/over-limit, declared-length refusal, streamed and many-small-chunk bypass attempts, an under-limit stream arriving intact, malformed `Content-Length` (`-1`, `abc`, empty, 22-digit) never becoming a 500, the media allowance and its ceiling, prefix-match rejection, WebSocket connect, GET, and that the refusal does not echo the body back
NON-VACUITY, proven: removing only the streaming byte count — leaving the `Content-Length` path intact — made both streaming tests return 200 OK. That is exactly the bypass a declared-length-only limiter has. Restored afterwards
ONE ASSERTION CORRECTED, not weakened: the first draft asserted the handler is never entered for a streamed oversize body. That is wrong about ASGI — the application is called when the request starts and the body arrives afterwards. The real guarantee, now asserted, is `bytes_seen == 0`: the handler never completes the read, so no full body is ever assembled. For the declared-length path the handler genuinely is never entered, and that is still asserted
Exact results: middleware suite 25 passed; focused dependent matrix 161 passed (profile, creator profile, realtime blocking, messaging, auth/channels, config, job URL import); complete uncontended backend 6,759 passed / 64 skipped / 0 failed in 310.01s; Ruff clean
Count reconciliation: 6,731 (pre-RATE-004 baseline) + 3 `TestSecurityFloorsHold` cases added after DEP-002E's suite run + 25 new middleware cases = 6,759. No unexplained movement
Manual security review: no Content-Length-only path; no chunked bypass; arbitrary-precision integer parse handles a 22-digit declared length correctly; no buffering or chunk duplication; messages pass through unmodified so nothing is truncated; non-HTTP scopes bypass entirely; exact route matching; the error carries only the limit number and never any body content; response-start is tracked so a late overflow re-raises rather than fails open
Next slice: the remaining RATE-004 surface is timeouts and concurrency ceilings — read the ledger for what it actually asks. Then Phase 4, which needs a fresh browser baseline on a quiet host
```

## RATE-004 request-body bounds — the original finding (spent in Phase 3I; kept for the reasoning)

Investigated at the end of Phase 3H and left deliberately unstarted, because a
global ASGI middleware sits in front of all 6,731 tests and wanted more budget
than remained. The finding is specific and the fix is well-shaped.

```text
Nothing bounds an inbound request body. `rg -n "max_body|content-length" backend/app`
returns only `safe_outbound_fetch.py`, which bounds *outbound* responses (Phase 2A).
There is no inbound equivalent.
```

The reachable path is avatar and banner upload. There are no `UploadFile`
endpoints — the browser sends a base64 **data URL inside a JSON body**
(`readFileAsDataUrl` in `components/you/YouHubClient.tsx` →
`AvatarUploadRequest`). And:

- `backend/app/schemas/profile.py:213` declares `data_url: str` with **no `max_length`**;
- `backend/app/services/profile_service.py:1963` does check `MAX_AVATAR_UPLOAD_BYTES`
  (5 MiB) — but only **after** `len(image_bytes)`, i.e. after the whole body has
  been read, the JSON parsed, and the base64 decoded.

So the size limit exists and is honest about intent, but it runs too late to
protect memory: a multi-hundred-megabyte JSON body is fully materialised before
anything rejects it. That is a denial-of-service surface on an authenticated but
ordinary endpoint.

**Shape of the fix.** An ASGI middleware that bounds the body *before* it is
read: reject on `Content-Length` over the limit as a fast path, and also count
bytes while streaming so a chunked request with no `Content-Length` cannot walk
past it. Answer 413 in this application's canonical `{"error": {code, message}}`
envelope, not FastAPI's default shape. Make the limit configuration with a
server-side default.

**Sizing it.** The largest legitimate body is an avatar/banner upload: 5 MiB
decoded, roughly 6.7 MiB as base64, plus JSON overhead. Job-import source text is
capped at 100,000 characters (`MAX_IMPORT_SOURCE_TEXT_LENGTH`), so ~100 KB. A
10 MiB ceiling is generous for real traffic and still bounds the surface. Verify
against the avatar tests before settling on a number.

**Why it needs the full backend suite:** it is global middleware, so it is in
front of every request every test makes. Expect to run the complete suite, and
check the multipart-free assumption still holds first.

## Phase 3H atomic checkpoint (DEP-002E — the FastAPI/Starlette migration)

```text
Phase: Phase 3, atomic slice 3H / DEP-002E — the framework pair
Status: COMPLETE. DEP-002 is VALIDATED
Initial HEAD: 2f77ef9e084b96748c2417051cce49534ded9d2c
Final HEAD: Phase 3H checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): deps(backend): move the framework pair past the host-header and UNC flaws
Files materially changed: `backend/pyproject.toml`, `backend/uv.lock`, `backend/tests/test_packaging_contract.py`
Migrations: None
Dependency changes: fastapi 0.129.0 → 0.141.1; starlette 0.52.1 → 1.6.0. Manifest floor `fastapi>=0.115.0` → `>=0.141.1`
Lockfile changes: 14 lines. Only those two packages moved — anyio 4.12.1, pydantic 2.12.5, httpx 0.28.1, websockets 16.0 and uvicorn 0.40.0 are all unchanged. A framework major with no transitive drift is the outcome to expect here; a large unexplained lock diff would have meant something else was happening
Advisories resolved (10): GHSA-86qp-5c8j-p5mr and PYSEC-2026-161 (missing Host-header validation poisoning `request.url.path`); GHSA-jp82-jpqv-5vv3 (unvalidated request path concatenated into the authority); GHSA-wqp7-x3pw-xc5r (SSRF and NTLM credential theft via UNC paths in StaticFiles); GHSA-x746-7m8f-x49c (arbitrary HTTP method dispatched to `HTTPEndpoint` attributes); GHSA-82w8-qh3p-5jfq (`request.form()` limits silently ignored); plus PYSEC duplicates
REACHABILITY NOTE: `app/main.py:66` mounts `StaticFiles(directory=media_root)` at `settings.media_base_path`, so the UNC-path advisory was directly reachable in production rather than theoretical. That is the strongest single reason this migration was worth its risk
METHOD — framework primitives proved before the suite ran. A major like this can break one thing every test touches and present as thousands of unrelated product failures, so "does the framework work" was answered separately from "does the product work" using a scratch harness covering: application import, router registration, OpenAPI generation, the StaticFiles mount, TestClient construction and lifespan, header round-trip, the `{"error": {code, message}}` envelope on both validation and not-found, CORS accepting the configured origin and refusing an unlisted one, the middleware stack, an authenticated dependency chain refusing an anonymous caller, and the realtime WebSocket refusing an unauthenticated connection cleanly. All thirteen passed
FRAMEWORK BEHAVIOUR CHANGE FOUND, and worth knowing: Starlette 1.x no longer flattens `include_router` into `app.routes`; included routers nest under a `_IncludedRouter`, so top-level `app.routes` is 7 while `app.openapi()["paths"]` correctly reports 202. Nothing in `backend/app`, `backend/tests` or `backend/scripts` iterates `app.routes`, so no compatibility shim was needed — but code that did would have failed in a way that looked nothing like a dependency problem
Tests run: 13-check framework primitive harness; focused matrix of 155 real tests across realtime/websockets, messaging, interaction transitions, config, packaging, trusted identity, auth, sessions, administrator strong auth and marketplace; complete uncontended backend suite; production-set re-audit; Ruff
Exact results: framework primitives 13/13; focused matrix 91 + 64 = 155 passed; complete backend 6,731 passed / 64 skipped / 0 failed in 318.11s — byte-identical to the pre-migration baseline, so a twelve-minor FastAPI jump plus a Starlette major required no test changes at all; Ruff clean
Vulnerabilities before/after against the locked production set (52 packages): 1 vulnerable package → 1. The remaining entry is ecdsa's Minerva timing attack, which has no fix and none planned upstream, is already classified NOT_REACHABLE_WITH_EVIDENCE, and was made structurally unreachable in Phase 3G by narrowing `jwt_algorithm` to the HMAC family. Every actionable backend advisory is now closed: the programme went 9 vulnerable packages → 0 actionable
New guards: `TestSecurityFloorsHold` asserts the FastAPI and cryptography floors in the manifest and that the lock honours them. Both were verified non-vacuous by lowering the floors to their pre-remediation values, which failed exactly those two assertions; restored afterwards. These exist because a floor is easy to lower while resolving an unrelated conflict, and lowering either silently reintroduces a known vulnerable package
Next slice: DEP-003 (production dependency set — SBOM inspection remains; the clean production sync is done and the Docker image build stays BLOCKED_ENVIRONMENT), then the remaining Phase 3 ledger items, then Phase 4
```

## DEP-002E — starlette: the compatibility research (spent in Phase 3H; kept for the reasoning)

The last vulnerable production package, and the only one left open. Do not
attempt `uv lock --upgrade-package starlette`; it cannot move on its own.

```text
Current:  fastapi 0.129.0  requires  starlette<1.0.0,>=0.40.0   <- the actual blocker
          starlette 0.52.1
Target:   starlette 1.x    (10 advisories)
Requires: fastapi 0.141.1  requires  starlette>=0.46.0          <- no upper bound
```

So this is a twelve-minor FastAPI jump (0.129 → 0.141) taken together with a
Starlette major (0.52 → 1.x). It is a framework migration and deserves its own
session, not the tail of another one.

The advisories it closes are worth the work — they are the most serious findings
left in the backend: `GHSA-86qp-5c8j-p5mr` and `PYSEC-2026-161`, missing Host
header validation that poisons `request.url.path` and can bypass path-based
checks; `GHSA-jp82-jpqv-5vv3`, unvalidated request path concatenated into the
authority; `GHSA-wqp7-x3pw-xc5r`, SSRF and NTLM credential theft via UNC paths
in StaticFiles; `GHSA-x746-7m8f-x49c`, arbitrary HTTP method dispatched to
`HTTPEndpoint` attributes; `GHSA-82w8-qh3p-5jfq`, `request.form()` limits
silently ignored.

Before upgrading, read the FastAPI release notes across 0.129 → 0.141 and the
Starlette 1.0 notes for breaking changes. This application's exposed surface is
wide, so validate at least: dependency injection and `Depends` defaults; the
custom error envelope `{"error": {...}}` and exception handlers; middleware
ordering; CORS; lifespan/startup; WebSockets (`/ws/conversations` — realtime
messaging is a live consumer); streaming responses; file upload; background
tasks; and `TestClient` behaviour, since the whole 6,731-case suite runs through
it and a TestClient change would look like mass product failure rather than a
harness change.

## Phase 3G atomic checkpoint (DEP-002D — ecdsa, and making it unreachable)

```text
Phase: Phase 3, atomic slice 3G / DEP-002D — ecdsa
Status: COMPLETE (DEP-002 remains IN_PROGRESS; starlette is the last vulnerable production package)
Initial HEAD: cfacdd61dfaf03838c564f11e503b60eedc8650e
Final HEAD: Phase 3G checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): deps(backend): patch ecdsa, then make the unpatchable part unreachable
Files materially changed: `backend/uv.lock`, `backend/app/core/config.py`, `backend/tests/test_config.py`
Migrations: None
Version: ecdsa 0.19.1 → 0.19.2 (transitive, via python-jose)
Advisories resolved: GHSA-9f5j-8jwj-x28g and PYSEC-2026-2467 — improper DER length validation, a denial of service
RESIDUAL, and this is the important part: GHSA-wj6h-64fc-37mp / PYSEC-2026-1325, the Minerva timing attack on P-256, is NOT fixed in 0.19.2 and never will be. The OSV record carries `introduced: 0` with no fixed event, and the advisory text states plainly that "the python-ecdsa project considers side channel attacks out of scope for the project and there is no planned fix". Upgrading was therefore never going to clear this one, and no amount of version-chasing will
Classification: NOT_REACHABLE_WITH_EVIDENCE, and the evidence is four-part. (1) The advisory itself scopes the flaw to `SigningKey.sign_digest()`, key generation and ECDH, and says "ECDSA signature verification is unaffected". (2) `jwt_algorithm` defaults to `HS256` and nothing in `backend/app` references ES256/ES384/ES512, EllipticCurve, SECP or ecdsa. (3) Empirically, `ecdsa` is absent from `sys.modules` after a complete python-jose HS256 encode-and-decode cycle — python-jose imports it lazily, so the module is not merely unused, it is not loaded. (4) The one hole in that argument was that `JWT_ALGORITHM` is environment-configurable, so a deployment could have selected ES256 and made the package reachable
That hole is now closed structurally rather than documented: `jwt_algorithm` is a `Literal["HS256", "HS384", "HS512"]`, so the asymmetric families are rejected at configuration parse time. This is not a functional restriction — tokens are signed with `jwt_secret`, a shared secret, and an asymmetric algorithm with a shared secret is a misconfiguration rather than a choice. It converts "not reachable today" into "cannot become reachable", which is the difference between an exception and a guarantee
Tests run: focused config suite; auth/session/strong-auth/OAuth-refresh/session-migration suites; complete uncontended backend suite; Ruff on both changed files; production-set re-audit
Exact results: config 17 passed (including a new case asserting ES256/ES384/ES512/RS256/EdDSA/none/"" are all refused); focused auth 58 passed; complete backend 6,731 passed / 64 skipped / 0 failed in 319.78s — the 6,730 baseline plus the new case; Ruff clean
Vulnerabilities before/after against the real production set: 2 vulnerable packages → 2, but ecdsa's open advisories drop from 4 to 2 and both survivors are now classified with evidence rather than outstanding
Next slice: DEP-002E — starlette, the last one. 0.52.1 → 1.x, 10 issues including missing Host-header validation that poisons `request.url.path` and SSRF/NTLM via UNC paths in StaticFiles. It is a major gated behind FastAPI's supported Starlette range, so FastAPI and Starlette move together; validate middleware, auth, exception handlers, CORS, lifespan, streaming and TestClient behaviour before trusting the full suite
```

## Phase 3F atomic checkpoint (DEP-002C — cryptography)

```text
Phase: Phase 3, atomic slice 3F / DEP-002C — the credential-encryption library
Status: COMPLETE (DEP-002 remains IN_PROGRESS; ecdsa and starlette remain)
Initial HEAD: 3c61a18b6f410472947af44ab2964844f2c66e71
Final HEAD: Phase 3F checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): deps(backend): raise the cryptography floor past the oracle
Files materially changed: `backend/pyproject.toml`, `backend/uv.lock`
Migrations: None
Version: cryptography 46.0.5 → 50.0.0; the declared constraint moves from `>=46.0.5,<47.0.0` to `>=50.0.0,<51.0.0`
Advisories resolved (11, all of them): GHSA-g6cj-pr64-35w5 PKCS#7 EnvelopedData Bleichenbacher oracle (fixed only in 50.0.0); GHSA-jwv3-5hgf-82ww exponential X.509 path building via duplicate self-signed intermediates and GHSA-m2h6-j472-rp4c wildcard DNS escape from permittedSubtrees (both 49.0.0); GHSA-537c-gmf6-5ccf vulnerable OpenSSL bundled in wheels (48.0.1); GHSA-m959-cc7f-wv43, GHSA-p423-j2cm-9vmq and the PYSEC duplicates
WHY THE PIN WAS RAISED RATHER THAN RESPECTED — this was the judgement call of the slice, and the evidence is: (1) `git log -S` shows `<47.0.0` arrived in e18f580 "security(auth): encrypt stored OAuth credentials", i.e. as a conservative major-version guard introduced alongside the feature, not in response to a known incompatibility; (2) nothing downstream caps it — `python-jose[cryptography]` asks only for `>=3.4.0` and google-auth does not bound it either, so the pin was the sole constraint; (3) this codebase touches exactly two symbols from the library, `AESGCM` and `InvalidTag`, in `app/core/oauth_credentials.py` and `app/core/strong_auth_secrets.py`, and that API has been stable since cryptography 2.x. A within-pin bump to 46.0.7 would have closed only 4 of 11 and left the Bleichenbacher oracle, both X.509 escapes and the OpenSSL issue in place. The `<51.0.0` bound is kept deliberately so the *next* major remains an explicit decision rather than a resolver's
Validation appropriate to a security-critical library: the AESGCM round trip and InvalidTag-on-tampered-AAD were exercised directly before any suite ran; then OAuth credential encryption/decryption, the credential migration, the rotation CLI, strong-auth TOTP secrets, strong-auth lifecycle, administrator strong auth and session tests; then the complete uncontended backend suite
Exact results: direct AESGCM/InvalidTag smoke passed; focused crypto/credential/session 58 passed; complete backend 6,730 passed / 64 skipped / 0 failed in 314.60s — identical to the pre-upgrade run, so the major bump changed no observable behaviour
Vulnerabilities before/after against the real production set: 3 vulnerable packages → 2
Remaining and why: ecdsa 0.19.1 → 0.19.2 (DER length DoS and a Minerva timing attack on P-256), which arrives through python-jose and should be a small lock-only slice; starlette 0.52.1 → 1.x (10 issues incl. missing Host-header validation poisoning `request.url.path`, and SSRF/NTLM via UNC paths in StaticFiles), which is a major gated behind FastAPI's supported range and must move as a FastAPI+Starlette pair
Next slice: DEP-002D — ecdsa (small), then DEP-002E — the FastAPI/Starlette pair (framework, needs the full suite plus attention to middleware, auth, exception handlers, CORS, lifespan and TestClient behaviour)
```

## Phase 3E atomic checkpoint (DEP-002B — the low-risk vulnerable group)

```text
Phase: Phase 3, atomic slice 3E / DEP-002B — six transitive/leaf packages with straightforward fixes
Status: COMPLETE (DEP-002 remains IN_PROGRESS; cryptography, ecdsa and starlette remain)
Initial HEAD: ee50d0938bee3f41a516d2d1c7174758001997ec
Final HEAD: Phase 3E checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): deps(backend): close six advisories the lock can fix on its own
Files materially changed: `backend/uv.lock` only
Migrations: None
Versions: click 8.3.1 → 8.4.2; idna 3.11 → 3.18; mako 1.3.10 → 1.4.1; pyasn1 0.6.2 → 0.6.4; pydantic-settings 2.13.0 → 2.15.0; python-dotenv 1.2.1 → 1.2.2. Every one is at or above its earliest fixed version
Advisories resolved (16): click PYSEC-2026-2132; idna GHSA-65pc-fj4g-8rjx + PYSEC-2026-215; mako GHSA-2h4p-vjrc-8xpq and GHSA-v92g-xgxw-vvmm (TemplateLookup path traversal) + 2; pyasn1 GHSA-8ppf-4f7h-5ppj, GHSA-hm4w-wwcw-mr6r, GHSA-jr27-m4p2-rc6r, GHSA-m4p7-r5rc-7g4j (quadratic OID parsing, unbounded recursion, long-form tag DoS) + 4; pydantic-settings GHSA-4xgf-cpjx-pc3j (NestedSecretsSettingsSource symlink escape); python-dotenv GHSA-mf9w-mj56-hr94 (symlink following in set_key) + 1
Why these six together: none of them is constrained by `pyproject.toml`, so the existing ranges already permitted the fixed versions and the lock alone could move them. No manifest edit was needed, which is what makes this group low-risk and coherent as one slice
Method: `uv lock --upgrade-package <name>` six times in one invocation, then `uv lock --check`, then `uv sync --all-groups` to bring `backend/.venv` in line with the lock. That sync also retired the pre-existing drift between the developer venv and the lock: uv reported exactly six removals and six additions, which confirms the venv was otherwise already consistent
Lock delta: 18 insertions / 18 deletions — the six versions and their hashes, no collateral churn
Vulnerabilities before/after, measured against the real production set (`uv sync --locked --no-dev` into a scratch environment, 52 packages): 9 vulnerable packages → 3. Remaining are cryptography, ecdsa and starlette, each of which needs its own slice
Tests run: alembic heads (mako drives migration templates); focused config/auth/session/strong-auth/OAuth-refresh/trusted-identity/packaging suites; complete uncontended backend suite; production-set re-audit
Exact results: alembic single head 0059_oauth_connection_events; focused 101 passed; complete backend 6,730 passed / 64 skipped / 0 failed in 319s — the expected 6,723 baseline plus the 7 packaging-contract tests, with skips unchanged; production audit 9 → 3 vulnerable packages
Risk notes: mako 1.3 → 1.4 is a minor bump on the template engine alembic uses for migration scaffolding, so `alembic heads` was checked explicitly. pydantic-settings 2.13 → 2.15 is the highest-risk item, since the whole configuration system depends on it; the 16-case config suite and the full backend run cover it
Next slice: DEP-002C — cryptography. Then DEP-002D — the FastAPI/Starlette pair
```

## Phase 3D atomic checkpoint (DEP-002A — the packaging contract)

```text
Phase: Phase 3, atomic slice 3D / DEP-002A — make the committed lock the thing production installs
Status: COMPLETE (DEP-002 remains IN_PROGRESS; the version remediation itself is DEP-002B onward)
Initial HEAD: f07ee415dfb23ee1e43f1da0a5a0a40499fbb3d4
Final HEAD: Phase 3D checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): build(backend): install production from the lock, not from whatever resolves
Files materially changed: `backend/Dockerfile`; new `backend/tests/test_packaging_contract.py`; `backend/README.md`; `PROJECT_STATUS.md`
Migrations: None. Dependencies: no version changed in this slice — it changes which artifact decides versions
DEFECT FIXED — production builds were not reproducible: the Dockerfile ran `COPY pyproject.toml README.md ./` followed by `uv sync --all-groups`. `uv.lock` was never copied, so every image build re-resolved the loose ranges in `pyproject.toml` from scratch. Two images built a week apart could ship different versions of every transitive dependency, and — the reason this blocks DEP-002 — pinning a security fix in the committed lock would have had no effect whatsoever on what shipped. This is almost certainly how the running environment drifted to `starlette 0.52.1` and `cryptography 46.0.5`
SECOND DEFECT FIXED — `--all-groups` installed the dev group into the runtime image, so pytest, ruff and aiosqlite shipped to production
Now: `COPY pyproject.toml uv.lock README.md ./` then `uv sync --locked --no-dev`. `--locked` (not `--frozen`) is deliberate: it fails the build when the lock disagrees with the manifest, turning "edited pyproject without relocking" into a build error instead of a silent re-resolution. `UV_NO_SYNC=1` is set so the entrypoint's `uv run` uses the environment baked at build time rather than trying to reconcile it — without that, `--no-dev` would make `uv run` attempt to install the missing dev group over the network during container start
Packaging contract, now explicit and documented in `backend/README.md`: `pyproject.toml` declares, `uv.lock` resolves, production installs from the lock. To change a production dependency: edit `pyproject.toml`, then `uv lock --upgrade-package <name>`, then `uv lock --check`, then `uv sync --all-groups` locally. Never hand-edit the lock; never add `requirements.txt`. `PROJECT_STATUS.md` was pointing at a `requirements.txt` that does not exist and a `make run` target the Makefile does not define — both corrected, because a doc describing a second contract is how the first one gets ignored
TOOLING: `uv` is obtainable here after all. `python3 -m venv <scratch> && <scratch>/bin/pip install uv` produced uv 0.12.5 in an isolated scratch venv that touches neither the project nor `backend/.venv`. Use `UV_CACHE_DIR` and `UV_PROJECT_ENVIRONMENT` pointed at scratch paths to keep it that way. This unblocks DEP-002 remediation — the previous session's blocker is resolved
Verification performed: `uv lock --check` passes against the committed lock (62 packages resolved, exit 0), so the lock was already consistent with the manifest and is trustworthy as the authoritative resolution. `uv sync --locked --no-dev` was then run against a scratch environment and succeeded, installing 52 packages — that is the real production dependency set, and it is what the Dockerfile change now reproduces
Tests: `tests/test_packaging_contract.py` 7 passed; `tests/test_config.py` 16 passed; Ruff clean on the new file
Non-vacuity: proven. Reverting the Dockerfile to its previous three instructions failed exactly the four contract assertions and passed the three that are about file existence. Restored afterwards
BLOCKED_ENVIRONMENT: the image itself was not built. Docker invocation is not permitted here, so these tests assert the build *instructions* rather than a successful build. The instruction correctness was verified out-of-band by running the equivalent `uv sync --locked --no-dev` locally, which is the strongest available substitute but is not the same as a green `docker build`
Next slice: DEP-002B — begin version remediation now that the lock is authoritative and uv is available. Take the low-risk independent group first (click, idna, Mako, pyasn1, pydantic-settings, python-dotenv), then cryptography, then the FastAPI/Starlette pair
```

## DEP-002 production dependency inventory (52-package production-only set)

Re-established against the true production set produced by
`uv sync --locked --no-dev`, rather than the developer venv which mixes dev
tooling in. Nine of 52 production packages carry advisories — the same nine the
previous session identified, now confirmed as genuinely production-reachable
(pytest, pip, Pygments and iniconfig correctly drop out as dev-only).

## DEP-002 Python vulnerability inventory (gathered, not yet remediated — reuse it)

Established by querying the OSV batch API directly against the 62 installed
packages, rather than installing a scanner into the backend virtualenv, which
would have changed the environment the test suite runs in. The script used is
reproducible: POST `https://api.osv.dev/v1/querybatch` with
`{"package":{"name":N,"ecosystem":"PyPI"},"version":V}` per package.

```text
PRODUCTION-REACHABLE (9 packages, current version -> earliest fixed version)
  click             8.3.1   -> 8.3.3     1 issue                       (uvicorn)
  cryptography     46.0.5   -> 46.0.7    8 distinct issues, PARTIAL    (direct)
                                          Bleichenbacher oracle in PKCS#7 EnvelopedData,
                                          wildcard-DNS verifier escape, incomplete DNS name
                                          constraints, buffer overflow on non-contiguous
                                          buffers, vulnerable OpenSSL in wheels.
                                          46.0.6/46.0.7 fix some; others are only fixed in
                                          48.0.1 / 49.0.0 / 50.0.0, which are OUTSIDE the
                                          declared `cryptography>=46.0.5,<47.0.0` pin.
                                          Splitting "fixed within 46.x" from "needs a major"
                                          is the first real task here.
  ecdsa            0.19.1   -> 0.19.2    2 issues (DER length DoS; Minerva timing attack on
                                          P-256). Arrives via python-jose.
  idna              3.11    -> 3.15      2 issues                      (httpx/anyio)
  Mako             1.3.10   -> 1.3.12    3 issues (path traversal in TemplateLookup) (alembic)
  pyasn1            0.6.2   -> 0.6.4     8 issues (quadratic OID parsing, unbounded recursion,
                                          long-form tag DoS)           (google-auth, python-jose)
  pydantic-settings 2.13.0  -> 2.14.2    1 issue (NestedSecretsSettingsSource symlink escape)
  python-dotenv     1.2.1   -> 1.2.2     2 issues (symlink following in set_key)
  starlette        0.52.1   -> 1.3.1     10 issues, MAJOR BUMP         (fastapi)
                                          Host-header validation missing (poisons
                                          request.url.path), SSRF/NTLM via UNC paths in
                                          StaticFiles, arbitrary method dispatch to
                                          HTTPEndpoint attributes, form() limits ignored.
                                          Gated behind a FastAPI upgrade that accepts
                                          starlette 1.x — this is a framework migration and
                                          deserves its own slice with the full backend suite.

DEV-ONLY (lower priority, not shipped): pytest 9.0.2, pip 24.2, Pygments 2.19.2
```

**Why no remediation was attempted, and what must be decided first.** The
repository declares `backend/uv.lock`, but `backend/.venv/pyvenv.cfg` shows the
environment was built by `/opt/anaconda3/bin/python3 -m venv` at
`/tmp/creatorjobs-backend-venv` — a plain pip venv, not a uv-managed one. So the
lock and the environment the tests actually run against are already two
different things, and there is no `uv` binary anywhere on this machine to
regenerate the lock surgically. Changing `pyproject.toml` alone would leave the
lock inconsistent; `pip install`-ing into `.venv` would fix nothing the
repository records, because the venv is untracked. Either action would look like
remediation while changing nothing a deployment would use.

The next agent should resolve the tooling contract first — install `uv` and
confirm `uv lock --check` reproduces the current lock, or decide the project is
pip/requirements-based and make that explicit — and only then remediate, one
`uv lock --upgrade-package <name>` at a time, installing the same version into
the venv so the tests genuinely exercise it. Do not mass-upgrade.

## Phase 3C atomic checkpoint (DEP-001B)

```text
Phase: Phase 3, atomic slice 3C / DEP-001B — the framework and everything it carries
Status: COMPLETE (DEP-001 is VALIDATED — production audit reports zero findings)
Initial HEAD: Phase 3B checkpoint commit
Final HEAD: Phase 3C checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): deps(next): move to the minor that carries patched postcss and sharp
Files materially changed: `package.json`, `package-lock.json`
Migrations: None
Advisories resolved: nine `next` advisories (middleware/proxy bypass on Turbopack, DoS in Server Actions, SSRF in Server Actions on custom servers, SSRF in rewrites via attacker-controlled destination host, two cache-confusion issues, unbounded Server Action payload on Edge, image-optimization DoS via SVG, unauthenticated disclosure of internal Server Function endpoints); four `postcss` advisories (`</style>` XSS and three sourceMappingURL path-traversal/arbitrary-.map-read issues); the `sharp`/libvips group (CVE-2026-33327/33328/35590/35591); and two `nanoid` infinite-loop advisories
Why 16.3.1 and not 16.2.12: every direct `next` advisory ends at `<16.2.11`, so a patch bump would have silenced them — but `16.2.11` and `16.2.12` still pin `postcss 8.4.31` and `sharp ^0.34.5`, both of which are themselves vulnerable and reach production. `16.3.1` pins `postcss 8.5.23` and `sharp ^0.35.3`, and `postcss@8.5.23`'s `nanoid ^3.3.16` resolves to the patched 3.3.18. One minor bump therefore closes four packages at once, which is why this is a single coherent group rather than four slices. It stays inside the declared `^16.2.6` range
Framework-internals risk, checked explicitly: the WEB-008B nonce architecture depends on Next reading the request CSP header, so `app-render/get-script-nonce-from-header.js` and the `proxy` file convention were both confirmed present in 16.3.1 before any test ran, and the CSP browser suite was then run against it
Audit movement: production findings 4 → 0. `npm audit --omit=dev` reports "found 0 vulnerabilities"
Tests run: TypeScript; ESLint; complete frontend unit suite; production build; CSP browser suite; complete standard browser matrix; complete real-backend QA browser matrix
Exact results: TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,181 passed / 0 failed; build passed; CSP browser 6 passed with the policy enforcing; standard browser 448 passed / 22 failed (was 444 / 26 on 16.2.6 — four fewer failures); QA browser 280 passed / 10 failed / 2 skipped on a heavily contended machine, then the affected specs re-run clean at 35 passed / 0 failed in 1.6 minutes
Standard-matrix churn, investigated not assumed: two specs failed that had not failed before (`visual-theme.spec.ts:52`, `seo-filter-routes.spec.ts:139`) and several that had failed before stopped failing. Both new ones were re-run in isolation and passed 16/16, so they are parallel-execution flakes rather than regressions. `visual-theme:52` was worth checking carefully because it exercises the theme bootstrap script that WEB-008B attaches a nonce to — its passing is direct evidence that the nonce'd inline script still executes on 16.3.1
MACHINE CONTENTION — read this before trusting any browser run: the QA matrix reported 10 failures and took 1.1 hours against 15.5 minutes previously. That was not the framework. Load average during the run was 15.8 / 18.3 / 19.5, from the host's own browsers, editors and concurrent agent processes, plus a stray `next-server (v16.2.6)` left running for nine hours by an earlier inspection step. Three tests consumed roughly 46 of the 64 minutes hanging in Playwright teardown *after* hitting their 45-second timeout. Once the stray was killed and load fell to about 4.7, all five specs that had newly failed passed 35/35 in 1.6 minutes. Two independent facts point the same way: the standard matrix on the same 16.3.1 got *faster* (4.4m vs 7.7m), and `workspace-performance.spec.ts:108` — an item in the original Phase 0 recorded baseline — now passes. Before recording any browser failure as real, check `uptime` and `ps -ax | grep next-server`, and kill leftovers
Backend: untouched by this slice
Next slice: reassess remaining Phase 3 items, then Phase 4. This run is strong evidence that the historical 17/6 browser baseline is stale and must be re-established serially on a quiet machine rather than trusted
```

## Phase 3B atomic checkpoint (DEP-001A)

```text
Phase: Phase 3, atomic slice 3B / DEP-001A — the critical authentication dependency
Status: COMPLETE (DEP-001 remains IN_PROGRESS; `next` itself is DEP-001B)
Initial HEAD: 85dc4e6c36b8408963ee40272e2c2027169c9c00
Final HEAD: Phase 3B checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): deps(auth): take the next-auth patch that closes three advisories
Files materially changed: `package.json`, `package-lock.json`
Migrations: None
Advisories resolved: GHSA-7rqj-j65f-68wh (critical — email normalizer validated before Unicode normalization, homoglyph `@` bypass); GHSA-xmf8-cvqr-rfgj (high — `getToken()` throws on a malformed Bearer header); GHSA-x445-f3h2-j279 (moderate — OAuth state/nonce/PKCE cookies not bound to the provider that set them); GHSA-w5hq-g745-h8pq (moderate — `uuid` missing buffer bounds check, transitive, fixed by next-auth's bump to `uuid ^11.1.1`)
Why these matter here rather than in the abstract: `app/api/security/strong-auth/route.ts` calls `getToken` on a caller-supplied request, which is exactly the malformed-Bearer surface; and `lib/auth.ts` configures Google plus Credentials providers, which is the OAuth cookie-binding surface. The email-normalizer advisory is fixed but less relevant — no Email provider is configured
Scope discipline: 4.24.14 → 4.24.15 is a patch inside the existing `^4.24.14` range. next-auth v5 (Auth.js) is a beta major and a migration, not a remediation, so it was not considered
Audit movement: production findings 6 → 4 (critical 1 → 0, moderate 1 → 0)
Tests run: TypeScript; ESLint; complete frontend unit suite; production build (via the QA harness); browser verification of the credentialed login path
Exact results: TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,181 passed / 0 failed; build passed; QA browser 12 passed (CSP suite 6 + organization resolver 6, both of which sign in)
Backend: untouched by this slice
Next slice: DEP-001B — `next` 16.2.6 → 16.3.1
```

## Phase 3A atomic checkpoint (RATE-002)

```text
Phase: Phase 3 — Dependencies, rate limiting, and request safety, atomic slice 3A / RATE-002
Status: COMPLETE (RATE-002 is VALIDATED)
Initial HEAD: 4ad511766f423fa54adc4e648f6729e495b63176
Final HEAD: Phase 3A checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(rate): stop letting a header choose who is being counted
Files materially changed: `backend/app/core/rate_limit.py` (`client_identity` replaces `_client_key`); `backend/app/core/config.py` (two settings plus a production decision); new `backend/tests/test_trusted_client_identity.py`; `backend/tests/test_config.py`
Migrations: None
Defect fixed (live before this slice): `_client_key` returned the leftmost `X-Forwarded-For` entry from any caller, so every rate limit in the product could be bypassed by varying one header — a different value produced a different bucket. That covered login, registration, password reset, strong-authentication challenge and enrollment, marketplace actions, reports and checkout. A test now sends 24 invented values from one caller and asserts they collapse to a single identity
Architecture: a forwarded header is evidence only when the peer that delivered it is inside a configured proxy network, and the chain is then read right to left — entries are appended by each hop, so the rightmost were written by our own infrastructure and anything further left could have come from the client. The first hop that is not one of our proxies is the answer. A malformed hop stops the walk rather than allowing it to reach further left. IPv4-mapped IPv6 is normalized so one caller cannot hold two buckets. An unparseable configuration entry is dropped, which narrows trust rather than widening it
Ordering note: taken before RATE-001 on purpose. The ledger listed RATE-002 as depending on RATE-001, but identity derivation is independent of where the counters live, and the defect is live under today's in-memory backend
New environment variables: TRUSTED_PROXY_IPS (comma-separated IPs/CIDRs of the proxies actually in front of the deployment; empty means forwarded headers are ignored entirely); ALLOW_DIRECT_CLIENT_IPS_IN_PRODUCTION (explicit acknowledgement that there is no proxy). Production boot now fails unless one of the two is stated, because both wrong answers are bad in different directions: behind an unlisted proxy every caller shares one bucket, in front of none an unlisted header forges one. `backend/.env.example` was NOT updated — this environment refuses commands that reference `.env*` paths, so the variables are recorded here instead and that file still needs the two entries
Security assumptions: `request.client.host` is the socket peer and is the only thing believed by default; the trusted set is server configuration and never request data; the parsed network list is cached per process, so a test that needs a different set must patch `rate_limit._trusted_proxies` rather than mutate settings
Tests run: 22 focused identity cases; the rate-limit backend suite; the configuration suite; the complete backend suite uncontended; Ruff on every changed Python file
Exact results: `test_trusted_client_identity.py` 22 passed; `test_config.py` 16 passed; complete backend 6,723 passed / 64 skipped / 0 failed in 335s, one uncontended run; Ruff clean on all four changed files
Reading the totals: `pyproject.toml` already sets `addopts = "-q"`, so passing `-q` again makes `-qq` and pytest prints no summary line at all. Count the progress characters if that happens, but do not count the summary line itself — "passed"/"skipped"/"335.42s" contain the same characters and will inflate the result. The Phase 2 certification figure of 6,700 passed / 64 skipped was character-counted from such a run and is consistent with this one: 6,700 + 23 new tests = 6,723
Known limitation carried forward: RATE-001 moves to BLOCKED_EXTERNAL for this environment — no redis-server binary, no redis/fakeredis package, Docker not permitted. `RedisRateLimitBackend.hit` still reads the count and writes in separate round trips, so concurrent callers can each see a count below the limit and all be admitted. That is a real defect and it is recorded rather than fixed blind, because a check-then-act fix cannot be validated without a server to race against
Next phase: DEP-001/DEP-002 (dependency audits) are the next fully-completable slice in this environment; RATE-003/004/005 depend on the limiter primitive and should follow RATE-001 once Redis is available
```

## Phase 2 certification (local)

```text
Phase: Phase 2 — Core web security boundaries
Status: LOCALLY COMPLETE. Every Phase 2 ledger row (WEB-001 … WEB-008) is VALIDATED
Certified at: Phase 2J checkpoint commit (self-resolve with `git log -1 --format=%H`)
Boundaries exercised: SafeOutboundFetcher and its per-hop destination predicates; job URL fetching; portfolio and oEmbed previews; hiring identity verification; organization page resolution; the YouTube custom-path resolver; safe internal redirects; inline JSON-LD serialization; stored external URL validation; render-safe external hrefs; response headers; the content security policy
Backend: 6,700 passed / 64 skipped / 0 failed, one uncontended run, no overlapping pytest at any point
Frontend unit: 1,181 passed / 0 failed
TypeScript: passed. ESLint: 0 errors / 33 known warnings. Production build: passed
Real-backend QA browser: 283 passed / 7 failed / 2 skipped, then differing specs re-run serially. Five of the seven are recorded baseline items; two (`qa-personas.spec.ts:602`, `workspace-interviews.spec.ts:246`) passed on serial re-run and are flakes. Two recorded baseline items (`draft-assistant.spec.ts:581`, `workspace-performance.spec.ts:108`) passed in this run, so the recorded six-item QA baseline is itself partly non-deterministic and should be re-established rather than trusted as a fixed list
Standard browser: 444 passed / 26 failed. The recorded baseline for this suite is "26 failures on the initial parallel run, 17 reproduced serially", so the count matches exactly. Every failure is a locator or copy assertion in the recorded categories; the log contains zero occurrences of "Content Security Policy", "Refused to execute/load/connect", "BLOCKED_BY_CSP" or "nonce", and no hydration failure. No failure is attributable to Phase 2
Alembic heads: 0059_oauth_connection_events (single head). Alembic current: local configured SQLite is unversioned, unchanged from the recorded state
PostgreSQL migration harness: NOT RE-RUN this session. `docker` invocation is not permitted in this environment, and Phase 2 introduced no migration, so the harness would exercise nothing this phase changed. The last recorded run reached 0059 through upgrade/downgrade/re-upgrade on disposable PostgreSQL. This is an environment limitation, not a passing result — do not read it as one
External gates still open: HSTS preload eligibility and real deployed-domain HSTS behaviour; live Google consent/reconnect/refresh/revoke drill; hosted credential backfill. No domain was submitted to any preload list
```

## Phase 2J atomic checkpoint (WEB-008B)

```text
Phase: Phase 2 — Core web security boundaries, atomic slice 2J / WEB-008B
Status: COMPLETE (WEB-008 is VALIDATED)
Initial HEAD: 99e17d9b439e3377161215dbddc0ca74a56d37d5
Final HEAD: Phase 2J checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(web): authorize scripts per request rather than by category
Files materially changed: new `lib/contentSecurityPolicy.ts`; new `proxy.ts`; `app/layout.tsx` reads the request nonce; `next.config.ts` gives up ownership of the CSP header; header contract suite expanded from 7 to 22 cases; new browser suite `tests/e2e/qa/content-security-policy.spec.ts`; one console-noise pattern added to `tests/e2e/qa/workspace-exploratory.spec.ts`; execution ledger and handoff
Migrations: None
Behavior changed: every HTML response now carries a complete Content-Security-Policy whose `script-src` is `'self' 'nonce-<per request>' 'strict-dynamic'`. Next 16 reads that nonce off the *request* header (`app-render/get-script-nonce-from-header.js`) and stamps it onto its own inline bootstrap and flight-data scripts, so no inline script executes unless the server authorized it. Also `default-src 'self'`, `base-uri 'self'`, `object-src 'none'`, `form-action 'self'`, `frame-src 'none'`, `frame-ancestors 'none'`, `font-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob: https:`, and `connect-src 'self'` plus the parsed backend origin and its ws/wss form
Architecture: `lib/contentSecurityPolicy.ts` is a pure builder — nonce plus configuration in, header string out — so the entire policy is asserted in unit tests instead of only observed in a browser. `proxy.ts` (Next 16's replacement for the deprecated `middleware.ts`; the old name still builds but warns and the two may not coexist) generates 128 bits from `crypto.getRandomValues` per request, overwrites the inbound `content-security-policy` and `x-nonce` request headers, and sets the response header. It matches documents only — `/api/*`, `/_next/static` and `/_next/image` are excluded, because a document policy on a JSON response buys nothing. `app/layout.tsx` reads `x-nonce` through `headers()` and applies it to the theme bootstrap script
Static-rendering consequence (measured, proven necessary, NOT a mistake): prerendered routes went from 21 to 3 (`/_global-error`, `/favicon.ico`, `/robots.txt`). This was verified by experiment, not assumed — with `headers()` removed from the layout the build prerenders 21 routes again, and those pages are then served with build-time HTML whose inline scripts carry no nonce, so the client runtime never starts and the browser suite fails on hydration. A nonce policy therefore requires every HTML response to be rendered per request. The SEO-critical surfaces (`/jobs`, `/jobs/[id]`, `/talent`, `/talent/[id]`, `/u/[slug]`) were already dynamic and lost nothing; what became dynamic is `/faq`, `/privacy`, `/terms`, `/support`, `/auth*`, `/post*`, `/smart-typing-test` and the `/you/*` workspace pages
Performance follow-up for Phase 11 (PERF-002): because every route is now dynamic, every `<Link>` prefetch in the header is a server render. That is a real cost and it is the reason one existing test changed. Consider `prefetch={false}` on navigation links, or a cached shell, when PERF-002 is worked
Security assumptions: the nonce is server-generated, unique per response, never read from the request, never persisted; a client-supplied `content-security-policy` or `x-nonce` request header is overwritten before Next sees it. Configured origins are parsed by `new URL` and re-checked against an origin pattern, never interpolated — `https://api.example.com; script-src *` yields no source at all and `connect-src` falls back to `'self'`, which breaks the application loudly rather than widening the policy. Control characters are rejected before parsing, because the URL parser *deletes* tabs and newlines and would otherwise authorize a host nobody configured. `style-src 'unsafe-inline'` is a real, documented exception: a nonce cannot authorize a `style` attribute and this codebase sets `style={{…}}` in about three dozen components, so the alternative is no style policy rather than a stricter one — `script-src` gets no such exception, and a test asserts that. `img-src https:` is deliberate and confined: creators link work from arbitrary hosts, images cannot execute, and a test asserts that allowance appears in no other directive. Report-only is unreachable when `isStrictProductionEnv()` is true, by construction rather than by remembering
Tests run: 22-case header/policy contract suite; six-case browser CSP suite; complete frontend unit suite; TypeScript; ESLint; production build; complete real-backend QA browser suite; targeted repeat runs of the affected spec. Backend untouched by this slice
Exact results: header/policy contract 22 passed; browser CSP 6 passed with the policy enforcing; frontend unit 1,181 passed / 0 failed; TypeScript passed; ESLint 0 errors / 33 known warnings; production build passed; full QA suite 283 passed / 7 failed / 2 skipped, then the differing specs re-run serially; `workspace-exploratory.spec.ts` 12/12 across three repeats after the fix
Non-vacuity: proven by two mutations, both reverted. Replacing `script-src` with `'self' 'unsafe-inline'` let an injected inline script execute and failed both the browser refusal test and the unit guard. Removing `'unsafe-inline'` from `style-src` produced real violations on public surfaces and failed the collector test. A third experiment (removing `headers()` from the layout) failed the hydration assertion, which is what proves the client-runtime check is not decoration
Task-caused failures resolved: one. `workspace-exploratory.spec.ts:78` began failing about half the time. Diagnosed rather than assumed: an instrumented run showed `GET /api/auth/session :: net::ERR_ABORTED` immediately before the next-auth `CLIENT_FETCH_ERROR`, with a 200 on the very next poll. Per-request rendering makes pages slower to go idle, so a scripted four-navigation sequence now interrupts the session poll more often. The abort is the browser's, not the product's, so it joined that spec's existing environmental-noise list with the reason written down. Verified against the parent behaviour first: with the change neutralized the test passed 4/4, with it in place it failed 2/4 and then 4/4 — which is why this is recorded as task-caused rather than dismissed as flake
Known flakes observed (not task-caused, passed on serial re-run): `qa-personas.spec.ts:602`, `workspace-interviews.spec.ts:246`. Two recorded baseline failures (`draft-assistant.spec.ts:581`, `workspace-performance.spec.ts:108`) passed in this run, so the recorded six-item QA baseline is itself partly non-deterministic
Known limitation: `/_global-error` stays prerendered because `global-error.tsx` replaces the root layout and cannot read request headers, so its inline scripts carry no nonce and that page renders without hydrating. It is the last-resort error screen and no product flow depends on its interactivity
Remaining risks: none in Phase 2 local scope; HSTS preload eligibility remains BLOCKED_EXTERNAL
Next phase: Phase 2 certification, then Phase 3 (RATE-001)
Important commands: `node --test --experimental-strip-types tests/securityHeaders.test.mjs`; `npx playwright test -c playwright.qa.config.ts tests/e2e/qa/content-security-policy.spec.ts`; `CSP_REPORT_ONLY=1 npx playwright test -c playwright.qa.config.ts …` to observe a policy change without enforcing it outside strict production
```

## Phase 2I atomic checkpoint (WEB-008A)

```text
Phase: Phase 2 — Core web security boundaries, atomic slice 2I / WEB-008A
Status: COMPLETE (WEB-008 remains IN_PROGRESS; the CSP itself is WEB-008B)
Initial HEAD: c278f8dfe9d1366680d0dcea421f978b84d566d9
Final HEAD: Phase 2I checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(web): say who may frame and reach into these pages
Files materially changed: `next.config.ts` response headers; new seven-case header contract suite; execution ledger and handoff
Migrations: None
Behavior changed: every response now also carries `Content-Security-Policy: frame-ancestors 'none'`, `Cross-Origin-Opener-Policy: same-origin-allow-popups` and `Cross-Origin-Resource-Policy: same-origin`. The existing nosniff, Referrer-Policy, X-Frame-Options, Permissions-Policy and production-gated HSTS headers are unchanged. `frame-ancestors` is the only directive shipped, deliberately: a `script-src` chosen without an inline-script decision breaks the application rather than protecting it
Security assumptions: `X-Frame-Options: DENY` and `frame-ancestors 'none'` must keep agreeing, or the answer depends on the browser; COOP is `same-origin-allow-popups` rather than `same-origin` because strict isolation severs the opener a popup sign-in flow depends on, and Google auth is one configuration change away from being one; HSTS stays gated on server-side `isStrictProductionEnv()` and must never be decided by a `NEXT_PUBLIC_` value; no header value may be built by interpolating configuration, because a stray semicolon in an origin rewrites the directive list
Tests run: header contract suite; TypeScript; ESLint; complete frontend unit suite; production build; QA browser suite covering the authenticated resolver and paste surfaces; git diff checks. Backend untouched
Exact results: security headers 7 passed and verified non-vacuous by introducing a wildcard, which failed two guards; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,166 passed / 0 failed; production build passed; QA Chromium 15 passed with the new headers live; `git diff --check` and `git diff --cached --check` passed
Task-caused failures resolved: none
Known external failures: HSTS preload eligibility remains BLOCKED_EXTERNAL — the header is implemented and gated, but only a deployed HTTPS domain can verify it, and no domain was submitted to any preload list
Remaining risks: without `script-src`/`connect-src`/`img-src`/`frame-src` the policy does not yet constrain code execution or exfiltration; that is WEB-008B and the inventory it needs is recorded above
Next phase: WEB-008B as described in the resume summary
Important commands: `node --test --experimental-strip-types tests/securityHeaders.test.mjs`; `rg -n 'dangerouslySetInnerHTML' app/layout.tsx`; `npx playwright test -c playwright.qa.config.ts tests/e2e/qa/organization-resolver.spec.ts`
```

## Phase 2H atomic checkpoint (WEB-006B)

```text
Phase: Phase 2 — Core web security boundaries, atomic slice 2H / WEB-006B
Status: COMPLETE (WEB-006 is VALIDATED)
Initial HEAD: 72a4775553e094d14edf625b5ad23dbc4ca10d7c
Final HEAD: Phase 2H checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(web): a stored link is not automatically a place to go
Files materially changed: new `lib/externalHref.ts`; seven components that render stored URLs; new five-case suite including a sink-coverage guard; execution ledger and handoff
Migrations: None; no legacy row was rewritten, which is the reason this slice exists
Behavior changed: every `href` fed by a stored URL now passes through `safeExternalHref`, which returns `undefined` for anything that is not an absolute http(s) URL without credentials. A row written before Phase 2G's storage validator can still hold `javascript:alert(1)`; it now renders as inert text rather than as navigation. The project detail card goes further and does not render its clickable surface at all when the link is unusable, because an inert full-bleed card would look broken
Security assumptions: storage, render and fetch are three separate contracts and the render layer must fail closed on data it did not write — "the backend validates it now" is only true for rows written after it started to; `safeExternalHref` and `safeExternalImageSrc` are deliberately separate functions even though both currently accept exactly http(s), so that loosening one later cannot silently loosen the other; a sink-coverage test fails if any of the seven components renders a stored URL directly again
Tests run: render-guard suite; TypeScript; ESLint; complete frontend unit suite; production build; git diff checks. The backend was not modified by this slice and its complete suite passed at the immediately preceding commit
Exact results: externalHref 5 passed; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,159 passed / 0 failed; production build passed; `git diff --check` and `git diff --cached --check` passed
Task-caused failures resolved: `InteractiveProjectLink` requires a string href, so the project page now gates the link wrapper on the safe value rather than passing a possibly-undefined one
Known external failures: none introduced
Remaining risks: WEB-008 is the last open Phase 2 item; application/interview URL fields were inventoried and are rendered through the same guarded components, so no separate WEB-006C was needed
Next phase: WEB-008 as described in the resume summary
Important commands: `node --test --experimental-strip-types tests/externalHref.test.mjs`; `rg -n 'href=\{' components | rg -i url`
```

## Phase 2G atomic checkpoint (WEB-006A)

```text
Phase: Phase 2 — Core web security boundaries, atomic slice 2G / WEB-006A
Status: COMPLETE (WEB-006 moves to IN_PROGRESS; render safety is WEB-006B)
Initial HEAD: af74f771d610f3b9fe2d94607db73bb3d27af623
Final HEAD: Phase 2G checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(web): decide once what a stored link may be
Files materially changed: new `app/core/external_url.py`; profile service `_is_http_url` chokepoint; profile/portfolio write schemas; new 36-case suite; execution ledger and handoff
Migrations: None; no legacy row was rewritten
Behavior changed: one implementation now answers "may this be stored". The existing service check — which already refused `javascript:` but accepted embedded credentials, control characters, single-label internal names, and any length — delegates to it, keeping its documented 400 responses. Portfolio `source_url`/`media_url`/`youtube_url`/`thumbnail_url` and profile `avatar_url`/`instagram_url` had no validation at all and now enforce it at the schema, which is their only chokepoint. Bare domains are still accepted and normalized to https, so nothing a creator actually types stopped working
Security assumptions: this is the *storage* contract only. Render safety is a separate contract that must fail closed independently, because rows written before this slice may hold anything — that is WEB-006B and it is why no destructive migration was written. Server-side fetch safety remains `SafeOutboundFetcher`'s and reusing it here would be wrong in both directions: it would reject a real link whose host is unreachable, and it would never see a `javascript:` value because that one never reaches a socket. `hiring_website_or_social_url` is deliberately validated only in the service, because adding a schema validator would turn its documented 400 into a 422
Tests run: new stored-URL suite; profile/portfolio/creator-profile dependent matrix; complete uncontended backend pytest; changed-file Ruff; TypeScript; complete frontend unit suite; production build; git diff checks
Exact results: stored-URL 36 passed; dependent matrix 30 passed; complete backend 6,700 passed / 64 skipped / 88 warnings in 317.55s with zero failures; changed-file Ruff passed; TypeScript passed; frontend unit 1,154 passed / 0 failed; production build passed; `git diff --check` and `git diff --cached --check` passed
Task-caused failures resolved: one test expectation of mine was wrong rather than the implementation — a *trailing* CRLF is stripped as normalization and never reaches storage, so the case now asserts that contract; a control character in the middle of a URL cannot be stripped and is still refused
Known external failures: none introduced
Remaining risks: legacy stored rows are untouched by design and can still hold an executable scheme until WEB-006B lands; application/interview URL fields have not been inventoried yet; WEB-008 remains
Next phase: WEB-006B as described in the resume summary
Important commands: `rg -n 'href=\{' components | rg -i 'url' | head -30`; `cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_external_url_storage.py tests/test_profile_features.py`
```

## Phase 2F atomic checkpoint

```text
Phase: Phase 2 — Core web security boundaries, atomic slice 2F
Status: COMPLETE (WEB-005 is VALIDATED)
Initial HEAD: 2f8a967d2177234e9cd6bb9ebb3c3aaf7b0db297
Final HEAD: Phase 2F checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(web): stop the sign-in page redirecting off-site
Files materially changed: new `lib/safeRedirect.ts`; sign-in page redirect handling; new nine-case validator suite; execution ledger and handoff
Migrations: None
Behavior changed: `/auth?next=` is validated once at the source and every consumer reads the validated value. The live defect was `router.push(result.url || nextAfterAuth)`, which navigated to whatever the query string contained after a successful sign-in — an open redirect on the one page where a victim has just been asked to trust what they are looking at. Legitimate application paths, including query and hash, are preserved exactly; anything else falls back to `/you` rather than failing loudly, because a bad `next` is usually a stale link
Security assumptions: NextAuth's default `redirect` callback already constrains `callbackUrl` to the deployment origin, but that protection is implicit and does not cover `router.push`, so the validator is applied at the source rather than relied upon downstream; the check accepts only a single-leading-slash path, rejects backslashes before and after one decode, rejects userinfo, control characters and unparseable values, and resolves against an opaque base so nothing about the real origin can influence the decision
Tests run: redirect validator suite; TypeScript; ESLint; complete frontend unit suite; production build; git diff checks. Backend untouched
Exact results: safeRedirect 9 passed and verified non-vacuous by reverting the call-site guard; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,154 passed / 0 failed; production build passed; `git diff --check` and `git diff --cached --check` passed
Task-caused failures resolved: none
Known external failures: none introduced
Remaining risks: WEB-006 stored/user-supplied URL contracts and WEB-008 response headers remain in Phase 2; every other redirect target in the tree is a literal string, so no further consumers needed migrating in this slice
Next phase: WEB-006 as described in the resume summary
Important commands: `rg -n 'callbackUrl|returnTo|searchParams.get\("next"\)' app components lib`; `node --test --experimental-strip-types tests/safeRedirect.test.mjs`
```

## Phase 2D-3 atomic checkpoint

```text
Phase: Phase 2 — Core web security boundaries, atomic slice 2D-3
Status: COMPLETE (WEB-003 is VALIDATED)
Initial HEAD: dca6c11272c6d29a161d6025db81fd6c4f54ebcc
Final HEAD: Phase 2D-3 checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(web): resolve youtube custom paths server-side
Files materially changed: `lib/youtubeIdentity.ts` custom-path resolution and its HTML extractor removal; organization-identity route wiring; resolver regression tests; outbound inventory; execution ledger and handoff
Migrations: None
Behavior changed: a YouTube custom path (`youtube.com/somebrand`) is the one shape the Data API cannot look up directly, and its channel id lives in the page. That page is no longer fetched from the Next runtime; the caller injects a resolver backed by `POST /me/organization-page`, which reads it through the shared pinned boundary and returns the id alone. Without an injected resolver a custom path falls back to URL-derived identity rather than fetching, which is deliberate: losing an enrichment is cheaper than keeping an unpinned fetch alive for it. Handle, channel-id, username and video shapes are unchanged and still use the fixed Data API endpoints
Security assumptions: `lib/youtubeIdentity` now has no code path that fetches a page; the only URLs it requests are the fixed googleapis.com endpoints (OF-104, tracked separately); the injected resolver receives the caller's own backend token
Tests run: YouTube identity resolver suite including two new cases; TypeScript; ESLint; complete frontend unit suite; production build; authenticated resolver browser suite; git diff checks. The backend was not modified by this slice, and its complete suite passed at the immediately preceding commit
Exact results: YouTube resolver 11 passed; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,145 passed / 0 failed; production build passed; organization resolver Chromium 6 passed; `git diff --check` and `git diff --cached --check` passed
Task-caused failures resolved: none; one new test asserts that only googleapis.com hosts are contacted and fails if the page is fetched
Known external failures: none introduced
Remaining risks: WEB-005 internal redirects, WEB-006 stored/user-supplied URL contracts, and WEB-008 response headers remain in Phase 2; per-user quotas for these endpoints are Phase 3 RATE-003
Next phase: WEB-005 — inventory every user-influenced redirect/return target (`next`, `returnTo`, `callbackUrl`, invitation and auth callbacks) and introduce one canonical internal-redirect validator, migrating consumers incrementally
Important commands: `rg -n 'callbackUrl|returnTo|[?&]next=|redirect\(' app lib components | head -50`; `node --test --experimental-strip-types tests/youtubeIdentityResolver.test.mjs`
```

## Phase 2D-2 atomic checkpoint

```text
Phase: Phase 2 — Core web security boundaries, atomic slice 2D-2
Status: COMPLETE (WEB-003 remains IN_PROGRESS; OF-007 is the remaining caller)
Initial HEAD: ff3c819fec1dd40e6ffb2d69434fac5d93bee72a
Final HEAD: Phase 2D-2 checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(web): read organization pages behind the backend boundary
Files materially changed: new `app/services/organization_page_service.py`; new authenticated `POST /me/organization-page`; organization page request/response schemas; typed frontend backend client; organization-identity Next route rewritten as an orchestration boundary with its HTML scraping helpers removed; new 15-case backend suite; outbound inventory; execution ledger and handoff
Migrations: None; Alembic remains at the single 0059_oauth_connection_events head
Behavior changed: the Next runtime no longer fetches arbitrary external HTML for organization resolution. It requires a session, decides the identity strategy, and asks the backend to read the page; the backend fetches through `SafeOutboundFetcher` and returns only `final_url`, `site_name`, `title`, `image_url`, `icon_url` and `youtube_channel_id`. YouTube and Instagram pages additionally carry a per-hop destination predicate, so a platform profile cannot redirect the request off its platform. A general company URL keeps no allowlist on purpose — real organizations redirect across domains — and is bounded by the generic public-address policy. Resolution outcomes, the Instagram URL-derived fallback, and the unreadable-page fallback are unchanged; an unreadable page answers 200 with empty fields so best-effort enrichment never blocks the workflow
Security assumptions: only http(s) values leave the service, so a `javascript:` or `data:` icon can never be handed back as an image URL; every returned field is length-bounded; no remote HTML crosses to the Next runtime or the browser; the route's remaining private-host regex is a fast input check and is explicitly documented as not the boundary; the platform predicate is caller-owned and the generic fetcher still knows nothing about YouTube or Instagram
Tests run: new organization-page suite; hiring-identity fetch; shared boundary; profile features; link preview; complete uncontended backend pytest; changed-file Ruff; TypeScript; ESLint; complete frontend unit suite; production build; authenticated resolver browser suite; git diff checks
Exact results: organization page 15 passed; dependent backend matrix 148 passed in 12.60s; complete backend 6,664 passed / 64 skipped / 88 warnings in 331.38s with zero failures; changed-file Ruff passed; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,143 passed / 0 failed; production build passed; organization resolver Chromium 6 passed; `git diff --check` and `git diff --cached --check` passed
Task-caused failures resolved: none; the platform-predicate cases were verified non-vacuous by temporarily setting `destination_allowed=None`, which let all four platform redirect escapes through before it was restored
Known external failures: no live YouTube, Instagram or third-party site was contacted; page shapes are represented by fixtures
Remaining risks: OF-007 still fetches YouTube HTML from the Next runtime; WEB-005, WEB-006 and WEB-008 remain; fixed provider clients (OF-103/104/105) still lack uniform response bounds
Next phase: Phase 2D-3 atomic slice as described in the resume summary
Important commands: `rg -n 'resolveCustomPathByHtml' lib app`; `cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_organization_page.py`; `npx playwright test -c playwright.qa.config.ts tests/e2e/qa/organization-resolver.spec.ts`; never start a second pytest while a suite is running
```

## Phase 2E atomic checkpoint

```text
Phase: Phase 2 — Core web security boundaries, atomic slice 2E
Status: COMPLETE (WEB-007 is VALIDATED)
Initial HEAD: 6a6e85bc8c2f9809eb5bd28349ab2ac9feaf9ada
Final HEAD: Phase 2E checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(web): make inline structured data html-safe
Files materially changed: new `lib/jsonLd.ts` serializer; public job and talent detail pages; new injection test suite; execution ledger and handoff
Migrations: None
Behavior changed: every inline `application/ld+json` block now serializes through `serializeJsonLd`, which escapes `<`, `>`, `&`, U+2028 and U+2029 as JSON `\uXXXX` sequences; consumers parse identical values, but an HTML parser can no longer be made to end the script block early from recruiter- or creator-supplied text
Security assumptions: `JSON.stringify` produces valid JSON and valid JSON is not safe inside HTML — an HTML parser ends a script at the first `</script` sequence wherever it appears, including inside a string; `&` is escaped so an entity cannot reconstruct a delimiter; the serializer deliberately takes a value rather than a pre-serialized string, because a string argument would mean the escaping decision had already been made elsewhere; any future inline structured-data block must use it, which the call-site test enforces
Tests run: JSON-LD injection suite; TypeScript; ESLint; complete frontend unit suite; production build; git diff checks
Exact results: JSON-LD injection 5 passed and verified non-vacuous by temporarily reverting one call site, which failed the call-site guard; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,143 passed / 0 failed; production build passed; `git diff --check` and `git diff --cached --check` passed; the backend was not touched by this slice so its suite was not rerun
Task-caused failures resolved: none
Known external failures: none introduced
Remaining risks: OF-006/OF-007 retrieval remains unpinned (2D-2); WEB-005 internal redirects and WEB-006 stored user URLs remain NOT_STARTED; WEB-008 response headers remain and should be sequenced last in Phase 2
Next phase: Phase 2D-2 atomic slice as described in the resume summary
Important commands: `rg -n 'application/ld\+json' app components`; `node --test --experimental-strip-types tests/jsonLdInjection.test.mjs`; `npx tsc --noEmit`
```

## Phase 2D-1 atomic checkpoint

```text
Phase: Phase 2 — Core web security boundaries, atomic slice 2D-1
Status: COMPLETE (WEB-003 remains IN_PROGRESS; the retrieval itself is 2D-2)
Initial HEAD: 36fd7175de8900a0f381f5bbdb89f4ffd2009b21
Final HEAD: Phase 2D-1 checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(web): require a session for organization resolution
Files materially changed: organization-identity Next route (same-origin check, session requirement, no-store responses); resolver browser spec moved from the anonymous mock harness to the authenticated QA harness; outbound inventory; execution ledger and handoff
Migrations: None
Behavior changed: `POST /api/profile/organization-identity` now refuses cross-site callers with 403 and anonymous callers with 401 instead of fetching a URL chosen by anyone on the internet; both product callers (Post a Job authorization and the profile experience editor) already run behind a signed-in session, so no user-visible flow changes; QA personas remain accepted because they are real accounts and this endpoint reveals nothing about the caller
Security assumptions: this closes the anonymous surface and does NOT fix the retrieval — the fetch still resolves DNS in the Next runtime, follows its own redirects, and screens hosts with a pattern list that a decimal-encoded address or a privately-resolving name would pass; that is 2D-2's work and the inventory records OF-006 as AUTH_GATED_PHASE_2D_1 rather than migrated
Tests run: authenticated resolver browser suite; TypeScript; ESLint; complete frontend unit suite; production build; git diff checks
Exact results: organization resolver Chromium 6 passed, including an explicit anonymous-caller rejection; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,138 passed / 0 failed; production build passed; `git diff --check` and `git diff --cached --check` passed; the backend was not touched by this slice so its suite was not rerun
Task-caused failures resolved: the previous `tests/e2e/instagram-resolver.spec.ts` asserted the anonymous contract this slice deliberately removes; its product assertions were preserved by moving them into the authenticated QA harness rather than relaxing the route
Known external failures: none introduced; live Instagram enrichment is still never asserted
Remaining risks: OF-006/OF-007 retrieval remains unpinned until 2D-2; WEB-005 internal redirects, WEB-006 stored URLs, WEB-007 JSON-LD escaping and WEB-008 HTTP boundaries remain
Next phase: Phase 2D-2 atomic slice — add a backend organization-resolution endpoint that uses `SafeOutboundFetcher` with a destination predicate for the supported platforms, have the Next route proxy to it with the caller's backend token, bound the response, and keep Instagram's URL-derived fallback behaviour intact
Important commands: `sed -n '1,90p' app/api/profile/organization-identity/route.ts`; `rg -n 'resolveCustomPathByHtml|resolveYouTubeChannelIdentity' lib app`; `npx playwright test -c playwright.qa.config.ts tests/e2e/qa/organization-resolver.spec.ts`; never start a second pytest while a suite is running
```

## Phase 2C atomic checkpoint

```text
Phase: Phase 2 — Core web security boundaries, atomic slice 2C
Status: COMPLETE (WEB-003 moves to IN_PROGRESS; the Next organization resolver remains)
Initial HEAD: 14881532a603db8d78ae7e0a1c18921c1540fde0
Final HEAD: Phase 2C checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(web): pin hiring-identity verification fetches
Files materially changed: additive `destination_allowed` predicate on the shared outbound policy evaluated inside per-hop destination validation; hiring-identity verification migrated off its own httpx client onto the shared boundary; new focused escape-path suite; outbound inventory; execution ledger and handoff
Migrations: None; Alembic remains at the single 0059_oauth_connection_events head
Behavior changed: hiring-identity verification still reads only a creator's own YouTube or Instagram profile page and still returns the same verification outcomes and the same single recruiter-facing failure message, but the platform host/path allowlist is now carried into the shared boundary as a per-hop predicate instead of being re-checked around a client that resolved DNS itself, followed its own redirects, honoured environment proxies, and materialised the whole body before slicing; the transfer is now IP-pinned, peer-checked, proxy-free, cookie-free, HTML-only, capped at four megabytes while streaming, limited to four redirects, and bounded by a fifteen-second whole-attempt deadline
Security assumptions: the predicate is caller-owned product policy and the primitive owns when it runs — on the entered URL and again on every hop, after the generic network policy passes and before any connection is opened; a predicate that raises is treated as a refusal; the generic primitive must never learn hiring-platform rules; `destination_allowed` defaults to None so every existing caller is unchanged; refusal reasons are deliberately collapsed into one product message because the difference between "not an allowed profile page" and "that host resolved somewhere private" is a fact about someone else's network
Tests run: new hiring-identity escape suite; profile features; shared boundary; link preview; creator profile; job URL import; complete uncontended backend pytest; changed-file Ruff; TypeScript; ESLint; complete frontend unit suite; production build; git diff checks
Exact results: hiring-identity fetch 12 passed; dependent matrix 196 passed in 16.93s; complete backend 6,649 passed / 64 skipped / 88 warnings in 318.51s with zero failures; changed-file Ruff passed; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,138 passed / 0 failed; production build passed with 33 static-generation entries; `git diff --check` and `git diff --cached --check` passed
Task-caused failures resolved: none; the new suite was verified non-vacuous by temporarily removing the predicate, which let five redirect escapes through (an unrelated host, a lookalike host, an attacker domain prefixed by the allowed one, a disallowed YouTube path, and an Instagram post page) before the predicate was restored
Known external failures: no live provider, hostile DNS, managed egress, or hosted service was used; consent-wall and login-wall behaviour is exercised with representative page text rather than live YouTube/Instagram responses
Remaining risks: OF-006 unauthenticated Next organization resolver and OF-007 YouTube HTML fallback still resolve and fetch outside the shared boundary from the Next runtime; fixed provider clients (OF-103/104/105) still lack uniform response bounds; internal redirects (WEB-005), stored-URL validation (WEB-006), JSON-LD escaping (WEB-007) and HTTP boundaries (WEB-008) remain
Next phase: Phase 2D atomic slice — require an authenticated same-origin session for `POST /api/profile/organization-identity`, move its retrieval to a backend endpoint using `SafeOutboundFetcher` with a platform destination predicate, bound the request and response, and keep the existing resolution outcomes; do not fold WEB-005/006/007 into the same commit
Important commands: `sed -n '1,120p' app/api/profile/organization-identity/route.ts`; `rg -n 'resolveCustomPathByHtml|organization-identity' app lib backend`; `cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_hiring_identity_public_fetch.py tests/test_safe_outbound_fetch.py`; never start a second pytest while a suite is running
```

## Phase 2B atomic checkpoint

```text
Phase: Phase 2 — Core web security boundaries, atomic slice 2B
Status: COMPLETE (WEB-004 is VALIDATED; Phase 2 remains in progress)
Initial HEAD: e65852472c75c224bc2c578c319d5fc0dc94037f
Final HEAD: Phase 2B checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(web): harden portfolio link previews
Files materially changed: portfolio link-preview service migrated to the shared outbound boundary with an exact oEmbed endpoint allowlist, redirect-free JSON policy, subdomain-accurate provider detection, and per-field metadata ceilings; link-preview security tests; portfolio-builder failure-path source contract; operator README; outbound inventory; execution ledger and handoff
Migrations: None; Alembic remains at the single 0059_oauth_connection_events head and the configured local SQLite remains unstamped
Behavior changed: authenticated `POST /portfolio/link-preview` still returns the same product responses, but every HTML retrieval now runs through `SafeOutboundFetcher` — public-only destinations, validated-IP TCP pin with original TLS identity, peer verification, per-hop redirect revalidation, no environment proxy or cookies, six-second total deadline, HTML/plain-only content types, and a 512 KiB decoded ceiling; YouTube/Vimeo oEmbed may only call two exact built-in endpoints, refuses every redirect, accepts only JSON within 64 KiB, and sends no credentials; provider detection no longer treats `notyoutube.com` or `youtube.com.attacker.example` as a provider; each metadata field read from an untrusted page is clamped to a length the product can store and display; unsafe URLs are rejected before any request, and network/provider failure still yields the manual-entry response so portfolio creation never breaks
Security assumptions: the preview endpoint remains authenticated; the two oEmbed endpoint constants are the only permitted network destinations for that path and are compared exactly, so a provider outage cannot redirect the request elsewhere; `_assert_public_http_url` is a fast pre-check and the fetch itself re-validates and pins, so the intervening DNS window is not authoritative; metadata URLs returned by an untrusted page are still only length-bounded here and remain WEB-006's validation responsibility before storage/display; `embed_html` is returned but no client renders it as HTML today, and it must never reach `dangerouslySetInnerHTML` without sanitisation; `allow_test_loopback` stays constructor-only test infrastructure
Tests run: focused link-preview suite; shared-boundary security suite; portfolio/profile dependent matrix; complete uncontended backend pytest; changed-file Ruff; TypeScript; ESLint; complete frontend unit suite; production build; Alembic heads/current; git diff checks
Exact results: link-preview 29 passed; shared-boundary 72 passed; dependent matrix 175 passed in 18.04s; complete backend 6,637 passed / 64 skipped / 88 warnings in 318.50s with zero failures; changed-file Ruff passed; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,138 passed / 0 failed; production build passed with 33 static-generation entries; one Alembic head 0059_oauth_connection_events; `git diff --check` and `git diff --cached --check` passed
Task-caused failures resolved: none in the implementation; a first full backend run reported 158 failures purely because a focused pytest was launched against the shared test database while it ran, and the uncontended rerun passed 6,637/6,637
Known external failures: no live provider, hostile DNS, managed egress, or hosted service was used; the portfolio builder has no browser coverage for the preview-failure path because it lives behind auth on `/you` and carries no test ids, so the contract is pinned as a source assertion and a real-browser spec is deferred until the builder gains stable selectors
Remaining risks: OF-005 social-profile verification, OF-006 unauthenticated Next organization resolver, and OF-007 YouTube HTML fallback still resolve and fetch outside the shared boundary; fixed provider clients (OF-103/104/105) still lack uniform response bounds; internal redirects, stored-URL validation, JSON-LD escaping, CSP/CORS/trusted-host/COOP/CORP, and Redis quotas remain in Phase 2/3
Next phase: Phase 2C atomic slice — route `ProfileService._fetch_public_hiring_identity_text` through `SafeOutboundFetcher` behind its existing platform allowlist without changing verification outcomes; do not migrate the Next organization resolver in the same commit
Important commands: `sed -n '1,120p' backend/app/services/profile_service.py`; `rg -n '_fetch_public_hiring_identity_text|httpx' backend/app/services/profile_service.py`; run `APP_ENV=test .venv/bin/python -m pytest tests/test_profile_features.py tests/test_safe_outbound_fetch.py` first; never start a second pytest while a suite is running
```

## Phase 2A atomic checkpoint

```text
Phase: Phase 2 — Core web security boundaries, atomic slice 2A
Status: COMPLETE (WEB-001 and WEB-002 are VALIDATED; WEB-004 is IN_PROGRESS; Phase 2 remains in progress)
Initial HEAD: 7759cc50243ed90012c92e9bba4741d28ec4a05c
Final HEAD: Phase 2A checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(web): pin validated outbound fetches
Files materially changed: new shared safe outbound-fetch service and exhaustive security tests; job/brand URL wrapper migration and expanded integration cases; backend production dependency declarations/lock metadata and operator README; source-contract frontend test; complete outbound caller inventory; execution ledger and handoff
Migrations: None; Alembic remains at the single 0059_oauth_connection_events head and the configured local SQLite remains unstamped
Behavior changed: authenticated job URL import and background brand enrichment retain their existing parsing, one-timeout retry, response/error, draft-only, and paste-fallback behavior, but every public request now permits only HTTP(S) ports 80/443, blocks non-public/reserved/multicast/metadata and unsafe embedded IPv4/IPv6 destinations, resolves each hop under a deadline, pins TCP to only the approved answers while preserving original TLS identity, verifies the connected peer, opens a fresh cookie-free pool per redirect, ignores environment proxies, rejects unsupported types and oversized declared/streamed/decompressed bodies, and enforces operation plus whole-chain deadlines; no AI feature was disabled or redesigned
Security assumptions: `httpx==0.28.1` and `httpcore==1.0.9` remain pinned until their transport API is deliberately reviewed; the low-level pool receives the original hostname for Host/SNI/certificate validation while its network backend substitutes only a prevalidated IP; all DNS answers used for connection must pass, and only those copied answers are connectable; a missing or mismatched peer fails closed; caller-supplied Authorization/Cookie/Host/proxy headers are impossible through the current policy; `allow_test_loopback` is constructor-only test infrastructure and must never become production configuration; managed egress filtering remains desirable defense in depth, not a substitute for this boundary
Tests run: changed-file Ruff and py_compile; uv locked-resolution check; isolated shared-fetch security suite; job/brand/import/enrichment dependent matrix; complete uncontended backend pytest; TypeScript; ESLint; complete frontend unit suite; production build; focused Chromium import workflow; git diff checks
Exact results: changed-file Ruff passed; Python compile passed; uv resolved 62 packages and `uv lock --check` passed; shared-fetch security 72 passed / 2 warnings; dependent matrix 327 passed / 2 warnings; complete backend 6,614 passed / 64 skipped / 88 warnings in 320.05s; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,137 passed / 0 failed/skipped; production build passed with 33 static-generation entries; import Chromium 4 passed; git diff checks passed
Task-caused failures resolved: the first complete frontend unit run found one source-contract assertion that required `is_global` to remain literally inside `job_url_fetcher.py`; that contract contradicted the intended shared-boundary architecture, so the test now verifies the stronger checks in `safe_outbound_fetch.py` plus the wrapper's explicit delegation and product limits; isolated 3/3 and complete 1,137/1,137 reruns passed
Known external failures: no production/staging DNS resolver, hostile live DNS rebinding domain, managed egress firewall, external public site, hosted database, or hosted service was used; local tests prove the actual pinned socket/Host/proxy-bypass path against a disposable TCP server, while staging egress and live-site drills remain operational certification work; the Phase 0 full browser failure matrices were not rerun because their known deterministic failures belong to later phases
Remaining risks: portfolio HTML/oEmbed preview still duplicates weaker DNS logic and can honor environment proxies; public hiring-identity verification and the unauthenticated Next organization resolver remain outside the shared boundary; fixed YouTube/Places clients need uniform response bounds; internal redirects, user URL storage/display validation, JSON-LD escaping, CORS/trusted-host/CSP/COOP/CORP, Redis quotas, and general browser/backend bearer boundary remain; see the complete outbound inventory
Next phase: Phase 2B atomic slice — migrate `link_preview_service` HTML retrieval to `SafeOutboundFetcher`, add a bounded JSON policy and strict redirect destination contract for fixed YouTube/Vimeo oEmbed, preserve authenticated manual-entry fallback behavior, and validate every private/redirect/size/type/outage case; do not start the organization resolver in the same commit
Important commands: `sed -n '1,470p' backend/app/services/link_preview_service.py`; `sed -n '1,280p' backend/tests/test_link_preview.py`; `rg -n '_fetch_text_url|_fetch_oembed_json|preview_portfolio_link' backend/app backend/tests`; run isolated shared-fetch/link-preview tests first, then complete backend/frontend gates; read docs/PRODUCTION_READINESS_OUTBOUND_FETCH.md before adding any network client
```

## Phase 1E atomic checkpoint

```text
Phase: Phase 1 — Critical authentication and identity security, atomic slice 1E
Status: COMPLETE (local engineering; AUTH-004 and AUTH-009 are BLOCKED_EXTERNAL, AUTH-007/010 continue in their owning later phases)
Initial HEAD: 22e9bd1586db1aabf3453bcd62182ed31bec0cfd
Final HEAD: Phase 1E checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(oauth): minimize scopes and add revocable YouTube grants
Files materially changed: centralized frontend/backend Google scope policies; NextAuth Google callback/exchange boundary; Auth, Settings, YouHub, Post Job, and platform-removal UI; same-origin YouTube refresh/disconnect routes and clients; Google identity access-token binding; OAuth repository/service lifecycle; provider refresh/revocation services; YouTube API error classification; OAuth connection-event model/migration; production configuration/examples/README; focused backend, unit, migration, and browser security tests; execution ledger and handoff
Migrations: 0059_oauth_connection_events additively creates credential-free authorization/revocation audit history with ownership FKs, nonnegative removal counts, and lookup indexes; downgrade is allowed only while the table is empty and otherwise refuses security-audit destruction; fresh disposable PostgreSQL upgraded, downgraded through 0059, and re-upgraded successfully
Behavior changed: ordinary Continue with Google requests only openid/email/profile and never asks for offline or YouTube access; Settings, YouHub, and Post Job request youtube.readonly incrementally with explicit consent only when needed; only a YouTube-scoped callback sends provider credentials server-to-server; basic login cannot overwrite an existing feature grant and clears only legacy credentials that never had a supported feature scope; the backend requires a matching server secret, verifies the signed ID-token/access-token `at_hash`, and confirms `mine=true` authority before committing credentials or replacing channel links; expired or unauthorized access tokens refresh once server-side, rotated refresh tokens are preserved across a downstream outage, explicit grant loss clears local authority, and transient quota/config/provider failures retain it; disconnect revokes Google remotely when possible and always clears all local credential copies, channel links, and channel avatar state without deleting the stable Google subject; the former bearer-authenticated provider-token upsert no longer exists; cross-origin and QA refresh/disconnect calls fail closed
Security assumptions: production NextAuth and FastAPI share one random 32–512 character GOOGLE_OAUTH_EXCHANGE_SECRET that is never public; backend GOOGLE_CLIENT_ID exactly matches the ID-token audience and GOOGLE_CLIENT_SECRET belongs to that OAuth client; Google continues issuing RS256 ID tokens whose OIDC at_hash uses SHA-256; stored feature grants always carry the exact youtube.readonly scope; PostgreSQL user-then-OAuth row locks serialize authorization, refresh, and disconnect; provider responses are untrusted, bounded where credentials are exchanged/revoked, never logged, and temporary failures do not destroy authority; the current Google consent screen and real provider behavior remain external verification gates
Tests run: changed-code Ruff; focused Google identity/scope/exchange/refresh/revocation/disconnect/encryption/config/migration/channel suites; complete backend pytest; Alembic heads/current; fresh disposable PostgreSQL migration/downgrade/re-upgrade suite; TypeScript; ESLint; complete frontend unit suite; production build; provider-session security suite; complete Settings Chromium suite; git diff checks
Exact results: changed-code Ruff passed; final focused backend matrix 109 passed / 6 warnings, with earlier combined refresh/revocation/migration matrix 112 passed; complete backend 6,538 passed / 64 skipped / 88 warnings in 318.29s; one Alembic head 0059_oauth_connection_events; configured local SQLite remains unstamped; disposable PostgreSQL 29 passed / 2 warnings; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,137 passed / 0 failed/skipped; production build passed with 33 static-generation entries; provider-session security 9 passed; Settings Chromium 12 passed; git diff checks passed
Known external failures: no real Google account, consent screen, OAuth client, refresh token, revocation, provider outage, production shared secret, hosted database, or production keyring was used; live consent/reconnect/refresh/revoke and hosted encrypted-only rollout remain BLOCKED_EXTERNAL; full Phase 0 standard/QA browser failure matrices were not rerun because their deterministic failures belong to Phases 2/4/11
Remaining risks: production shared-secret/keyring/Google configuration and live provider behavior are unverified; provider credential rows have not been backfilled/cut over on hosted infrastructure; the general browser-visible short-lived backend access bearer and remaining HTTP boundaries continue under AUTH-007/Phase 2; Redis-atomic abuse controls remain Phase 3; shared hardened outbound fetching, redirects, URL contracts, JSON-LD, and response headers remain Phase 2; operational monitoring/alerting remain Phase 12; release remains NO-GO
Next phase: Phase 2A atomic slice — first inventory and classify every server-side outbound fetch, then design one hardened fetch primitive and its complete DNS/IP/redirect/size/timeout/content-type tests before migrating a bounded caller set; do not create parallel SSRF implementations
Important commands: `rg -n 'httpx\.|fetch\(|requests\.|urlopen|AsyncClient|ClientSession' backend/app app lib`; inspect `backend/app/services/job_url_fetcher.py`, `backend/app/services/brand_enrichment_probe.py`, `backend/app/services/profile_service.py`, and existing SSRF tests; run `git branch --show-current && git status --short`; verify `.venv/bin/python -m alembic heads`; retain the final Phase 1 security matrices while Phase 2 changes shared network boundaries
```

## Phase 1D-3 atomic checkpoint

```text
Phase: Phase 1 — Critical authentication and identity security, atomic slice 1D-3
Status: COMPLETE (AUTH-008 is VALIDATED; Phase 1 remains in progress)
Initial HEAD: 1d75662bb356a45323dbb82100905c4295fdf133
Final HEAD: Phase 1D-3 checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(admin): add strong-auth browser flows
Files materially changed: same-origin strong-auth route adapter; typed browser and backend strong-auth clients; short-lived Google reauthentication state helper; NextAuth JWT callback; production admin layout gate; shared enrollment/challenge/recovery/management controls; administrator Settings integration; backend status contract; security/unit/browser regressions; execution ledger and handoff
Migrations: None; this slice consumes the already validated 0058 schema and leaves one Alembic head at `0058_strong_auth_totp`
Behavior changed: production administrators see no admin shell until the backend confirms fresh durable-session assurance; unenrolled password administrators primary-reauthenticate and enroll TOTP, Google administrators must complete recent Google login, enrolled administrators challenge with TOTP or one unused recovery code, recovery codes are shown once and must be acknowledged before the gate opens, and Settings can rotate codes or disable the factor with the required proofs; disablement signs out locally after the backend revokes every durable session; backend factor status now explicitly reports whether policy requires strong authentication
Security assumptions: FastAPI remains the privilege authority and independently verifies every factor/primary proof; the Next route requires a live ADMIN backend session, rejects QA personas and cross-site POSTs, accepts only bounded JSON/actions/fields, maps backend errors without reflecting arbitrary bodies, and marks responses no-store; browser JSON can never provide a Google ID token—the five-minute provider proof is held only inside the encrypted HttpOnly NextAuth JWT cookie, is bound to the backend user, capped by the provider token expiry, pruned on expiry, and omitted from `/api/auth/session` and browser Session types; recovery codes live only in transient React state/DOM and an operator-controlled clipboard; production fails closed on status errors while non-production deliberately preserves the existing backend-offline admin shell for local development; backend authorization still fails closed in every environment
Tests run: focused backend status/administrator lifecycle and changed-code Ruff; Google reauthentication state and browser-client contract/security tests; provider-session leakage tests; TypeScript; complete ESLint; complete frontend unit suite; production build; focused strong-auth browser matrix; existing admin/Settings browser regression matrix; isolated reruns and one uncontended complete backend suite; Alembic heads/current; `git diff --check`
Exact results: focused backend 12 passed / 3 warnings; three representative backend collision diagnostics passed; uncontended backend 6,484 passed / 64 skipped / 89 warnings with 6,548 collected and zero failures; changed-code Ruff passed; TypeScript passed; ESLint 0 errors / 33 known warnings; final isolated frontend unit run 1,133 passed / 0 failed / 0 skipped in 2.00s; production build passed with 33 static-generation entries; all 6 strong-auth Chromium cases passed in the final combined run; combined strong-auth/admin/Settings Chromium regression matrix 24 passed / 1 pre-existing Settings sign-out navigation timeout, whose isolated rerun passed 1 / 1; one Alembic head `0058_strong_auth_totp`; configured local SQLite remains unstamped; `git diff --check` passed
Known external failures: no hosted database, production keyring, physical authenticator, live Google reauthentication, provider outage/revocation, multi-instance deployment, or lost-all-factors support drill was exercised; authenticated GitHub inspection and the AUTH-004 hosted keyring/backfill cutover remain external; the full Phase 0 standard/QA browser matrices were not rerun; an invalid duplicate full-pytest orchestration run produced 38 unrelated shared-test-state failures, all three isolated representatives and the subsequent uncontended full suite passed, so that overlapped run is not a repository failure
Remaining risks: ordinary Google login still requests YouTube/offline scope and provider disconnect does not yet complete remote revocation under AUTH-009/AUTH-004; the general browser-visible backend access bearer remains under AUTH-007; Phase 3 owns Redis-atomic limits and trusted-client identity; real strong-auth secret provisioning/rotation, physical-device/live-provider validation, security monitoring, and a no-bypass lost-all-factors recovery procedure remain external/operational gates; WebAuthn/passkeys remain optional future hardening and no pretend MFA was added
Next phase: Phase 1E atomic slice — inspect and minimize ordinary Google-login scopes, keep YouTube authorization incremental, implement server-owned provider disconnect/revocation with safe local credential invalidation and auditability, add reconnect/revoke/outage tests, and separate locally validated engineering from live Google credential drills; do not touch hosted rows or credentials
Important commands: start with `rg -n 'scope|access_type|prompt|youtube|revoke|disconnect|OAuthAccount' lib app backend/app tests`; inspect `lib/auth.ts`, `app/api/identity/connect/start/route.ts`, `app/api/identity/disconnect/route.ts`, `lib/youtubeIdentity.ts`, and the backend OAuth credential service/model; retain focused auth tests, then run TypeScript, lint, all frontend units, focused browser tests, backend auth/Google tests, build, Alembic heads/current, and `git diff --check`
```

## Phase 1D-2 atomic checkpoint

```text
Phase: Phase 1 — Critical authentication and identity security, atomic slice 1D-2
Status: COMPLETE (Phase 1 and AUTH-008 remain in progress)
Initial HEAD: ff31a6ef072334c6234e93a23334ee7167b780aa
Final HEAD: Phase 1D-2 checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(admin): add real TOTP authentication lifecycle
Files materially changed: dedicated strong-auth secret cipher and TOTP primitives; TOTP/recovery models and API schemas; StrongAuthService; auth dependencies/routes; rate-limit rules; Alembic 0058; production configuration and environment documentation; disposable PostgreSQL runner; focused crypto/lifecycle/migration/concurrency/config tests; execution ledger and handoff
Migrations: 0058_strong_auth_totp additively creates one pending-or-confirmed encrypted TOTP credential per user and hash-only one-time recovery codes with lifecycle, failed-attempt, uniqueness, and cascading-ownership constraints; no account is enrolled or elevated; downgrade refuses while any pending or confirmed factor exists to prevent silent authentication/recovery destruction
Behavior changed: under-elevated durable administrators can read factor status, primary-reauthenticate with their current password or independently verified linked Google subject, enroll and confirm a real RFC 6238 TOTP factor, elevate with a non-replayed TOTP or one-time recovery code, regenerate recovery codes after a fresh TOTP proof, and disable the factor only with both primary and factor proof; confirmation/regeneration/recovery revoke sibling sessions and disabling revokes all sessions; invalid factor attempts persist and audit, with five attempts causing a 15-minute account-factor lock; enrollment expires after 10 minutes; sensitive successful responses are `Cache-Control: no-store`; production refuses to boot without a dedicated valid strong-auth keyring
Security assumptions: TOTP secrets are 160-bit base32 values encrypted under a dedicated rotation-ready AES-256-GCM keyring whose authenticated context binds user, credential, and purpose; OAuth keys must never be reused; TOTP uses 30-second, six-digit SHA-1 as required by RFC 6238 with only plus/minus one step drift, and the last accepted step is persisted under a row lock; recovery codes contain 160 random bits, are returned only on creation, and persist only a domain-separated SHA-256 hash; all factor mutations lock user, credential, then sessions and revalidate the current session; PostgreSQL locking is the multi-instance authority; the route limiter is additive defense only until Phase 3 replaces its process-local/trusted-IP assumptions with Redis-atomic enforcement; lost-all-factors reset remains an external support/recovery design and no bypass was added
Tests run: RFC TOTP vectors/drift/input/URI tests; cipher round-trip/context-binding/tamper/rotation/config/plaintext tests; password and Google reauthentication; encrypted enrollment/expiry/confirmation; replay/lockout; one-time recovery; regeneration; disable; audit/redaction; sibling/all-session revocation; non-admin/unconfigured fail-closed behavior; migration downgrade guard; PostgreSQL schema constraints and concurrent replay; focused and whole-tree Ruff; complete backend pytest; TypeScript; ESLint; complete frontend unit suite; production build; fresh disposable PostgreSQL upgrade/downgrade/re-upgrade; Alembic heads/current; `git diff --check`
Exact results: focused backend 59 passed / 3 warnings; changed-code Ruff passed; backend 6,484 passed / 64 skipped / 89 warnings with 6,548 tests collected and zero failures; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,125 passed / 0 failed in 2.83s; production build passed with 32 static pages; disposable PostgreSQL suite 29 passed / 2 warnings; one Alembic head `0058_strong_auth_totp`; configured local SQLite remains unstamped; whole-tree Ruff remains at the pre-existing 93 findings; `git diff --check` passed
Known external failures: no hosted database, real production strong-auth keyring, key-rotation ceremony, physical authenticator, browser MFA flow, multi-instance deployment, or lost-all-factors support drill was exercised; authenticated GitHub inspection and AUTH-004 provider/keyring rollout remain external; the Phase 0 standard/QA browser matrices were not rerun because this backend-only slice changed no frontend behavior
Remaining risks: administrators still lack browser enrollment/challenge/recovery UI, so AUTH-008 remains `IN_PROGRESS`, the production gate would strand an administrator who cannot call the API directly, and release remains `NO-GO`; the frontend needs a first-factor-aware strong-auth interstitial, one-time recovery-code handling, failure/expiry/lockout UX, and browser privilege/revocation tests; strong-auth key provisioning/rotation and a no-bypass recovery procedure require operational validation; WebAuthn/passkeys remain optional future provider-backed hardening rather than pretend MFA; Phase 3 still owns Redis-atomic rate limits and trusted proxy identity; browser access bearers remain visible to application JavaScript under AUTH-007
Next phase: Phase 1D-3 atomic slice — add a narrowly scoped administrator TOTP enrollment/challenge/recovery UI using the existing backend contract, keep recovery codes visible only at creation, handle revoked/expired/locked sessions safely, and prove the global admin privilege boundary plus logout/recovery behavior in focused browser tests; do not redesign unrelated Settings/admin UX and do not mark AUTH-008 validated until this matrix is green
Important commands: inspect `lib/backend.ts`, `lib/auth.ts`, `components/settings/SettingsClient.tsx`, `app/admin/layout.tsx`, and existing auth/browser test helpers; run `rg -n 'backendToken|401|403|insufficient_user_authentication|admin|settings' lib app components tests`; keep backend focus with `cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_strong_auth_lifecycle.py tests/test_admin_strong_auth.py`; preserve one Alembic head with `.venv/bin/python -m alembic heads`; after frontend changes run `npx tsc --noEmit`, `npm run lint`, `node --test tests/*.test.mjs`, focused Playwright, and `npm run build`
```

## Phase 1D-1 atomic checkpoint

```text
Phase: Phase 1 — Critical authentication and identity security, atomic slice 1D-1
Status: COMPLETE (Phase 1 and AUTH-008 remain in progress)
Initial HEAD: 5dd829a896f01de0238182f668ecca54f03d27c3
Final HEAD: Phase 1D-1 checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(admin): add strong-auth enforcement foundation
Files materially changed: administrator assurance policy helper; authoritative access dependency and deliberately narrow base-auth logout dependency; durable auth-session model; Alembic 0057; production configuration and environment documentation; canonical HTTP error handler; focused administrator/config/migration/PostgreSQL tests; execution ledger and handoff
Migrations: 0057_admin_session_assurance additively appends nullable `strong_auth_method`, `strong_auth_verified_at`, and `strong_auth_expires_at` columns plus a completeness/supported-method/chronology check constraint; it elevates no row; downgrade refuses after any assurance field has been used because an old binary would bypass the boundary
Behavior changed: when `ADMIN_STRONG_AUTH_REQUIRED=true`, every ADMIN request—including ordinary owner/participant routes outside `/admin`—requires a live durable session with fresh database-backed TOTP, WebAuthn, or recovery-code assurance; signed JWT `amr`/`acr` claims cannot elevate a session; QA and claimless administrator sessions fail closed; stored expiry is capped by the configured 5–60 minute maximum age; under-elevated administrators can still revoke the current/all session families; custom HTTP error rendering now preserves security response headers such as `WWW-Authenticate`; production configuration refuses to boot with the administrator gate disabled
Security assumptions: no endpoint in this slice writes assurance and migration 0057 sets no assurance, so this is an enforcement foundation rather than pretend MFA; enabling the required production gate before the next factor slices intentionally denies administrator product access except safe logout; only a successful server-side factor verifier may populate all three assurance fields atomically; ordinary product/admin routes must continue using `get_current_access_context`; `get_current_base_access_context` is limited to logout and future factor ceremonies; the durable session remains the revocation boundary and access-token claims remain untrusted for elevation
Tests run: assurance policy tests; administrator privilege, forged-claim, expiry, non-admin, logout-all, admin-panel, session, migration-downgrade, and production-config tests; focused Ruff on every changed Python file; complete backend pytest; TypeScript; ESLint; complete frontend unit suite; production build; fresh disposable PostgreSQL migration/downgrade/re-upgrade and database constraint suite; Alembic heads/current; whole-tree Ruff baseline; `git diff --check`
Exact results: focused backend 50 passed / 9 warnings; changed-code Ruff passed; backend 6,457 passed / 61 skipped / 88 warnings in 308.96s; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,125 passed / 0 failed in 3.18s; production build passed with 32 static pages; disposable PostgreSQL suite 26 passed / 2 warnings; one Alembic head `0057_admin_session_assurance`; configured local SQLite remains unstamped; whole-tree Ruff remains at the pre-existing 93 findings; `git diff --check` passed
Known external failures: no real factor device/provider, hosted database, production cookie, multi-instance deployment, Google credential, or provider outage was exercised; authenticated GitHub inspection and the AUTH-004 provider/keyring rollout remain external; the Phase 0 standard/QA browser failure matrices were not rerun because this slice changed no frontend behavior
Remaining risks: administrators have no product-accessible enrollment/challenge/recovery flow yet, so AUTH-008 is `IN_PROGRESS` and production remains `NO-GO`; TOTP secrets need encrypted storage, enrollment confirmation, replay prevention, recovery-code one-time consumption, abuse controls, audit events, factor-reset/session-revocation semantics, and browser UX; browser access bearers remain visible to application JavaScript under AUTH-007; Google incremental scopes/provider revocation, hosted OAuth encryption cutover, security monitoring, and prior deterministic browser failures remain
Next phase: Phase 1D-2 atomic slice — implement a genuine encrypted TOTP credential and server-side enrollment/confirmation/elevation/recovery lifecycle using the narrow base-auth ceremony boundary, hash-only single-use recovery codes, replay protection, bounded attempts, auditability, and session revocation on factor changes; do not mark AUTH-008 validated until the frontend and full recovery/privilege matrix are complete
Important commands: `rg -n 'encrypt|AESGCM|SecretStr|rate_limit|AdminAuditLog|AuthSession|BaseAuthenticatedAccessDependency' backend/app backend/tests`; inspect `backend/app/core/oauth_credentials.py`, `backend/app/core/rate_limit.py`, `backend/app/models/admin.py`, and auth repository/service patterns; before migration run `.venv/bin/python -m alembic heads` and `./scripts/test_interaction_status_postgres.sh`; start with focused `APP_ENV=test .venv/bin/python -m pytest tests/test_admin_strong_auth.py tests/test_auth_sessions.py tests/test_config.py`
```

## Phase 1C-5 atomic checkpoint

```text
Phase: Phase 1 — Critical authentication and identity security, atomic slice 1C-5
Status: COMPLETE (Phase 1 remains in progress; AUTH-006 is VALIDATED)
Initial HEAD: 8591c8e287fd72706187e6f74c558cea74dfed63
Final HEAD: Phase 1C-5 checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(session): revoke sessions on security events
Files materially changed: password-reset repository/service transaction boundaries; password and existing-account Google login locks; direct and report-driven administrator suspension; lock-refresh behavior for user/reset/session rows; SQLite/PostgreSQL auth and admin regressions; execution ledger and handoff
Migrations: None; this slice uses the existing 0056 durable-session schema
Behavior changed: a successful password reset changes the password, consumes every outstanding reset token, and revokes every durable session family in one commit; direct administrator suspension and report-resolution suspension update the account, revoke all durable families, and append the audit record in one commit; unsuspension permits a fresh login but never resurrects invalidated access or refresh credentials; password/reset issuance, reset confirmation, existing-account Google login, and suspension serialize through a user-row lock before session creation/revocation; concurrent reset requests leave exactly one usable token; lock reads use `populate_existing` so a waiter observes the committed winner instead of stale ORM identity-map state
Security assumptions: PostgreSQL row locking is authoritative; security events and login issuance acquire the user row before session families, while refresh/current logout acquire a session before credentials and never row-lock the user, avoiding a lock-order cycle; the configured persistent mode is required for immediate all-family invalidation; bounded migration-mode claimless access remains non-selectively revocable until its <=60-minute expiry; every future credential-changing endpoint must call the shared all-family revocation primitive in the same transaction; long-lived WebSockets remain Phase 8 work
Tests run: focused auth/session/Google/admin pytest; forced commit-failure rollback regression; focused Ruff on every changed Python file; complete backend pytest with explicit summary; TypeScript; ESLint; complete frontend unit suite; production build; fresh disposable PostgreSQL migration/downgrade/re-upgrade plus OAuth/session/reset concurrency tests; Alembic heads/current; whole-tree Ruff baseline; `git diff --check`
Exact results: focused auth/Google/admin 65 passed; rollback/reset focus 2 passed; changed-code Ruff passed; backend 6,450 passed / 60 skipped / 88 warnings in 311.69s; TypeScript passed; ESLint 0 errors / 33 known warnings; frontend unit 1,125 passed / 0 failed; production build passed with 32 static pages; disposable PostgreSQL suite 25 passed / 2 warnings; one Alembic head `0056_persistent_auth_sessions`; configured local SQLite remains unstamped; whole-tree Ruff improved from 110 to 93 known findings after fixing the touched admin module header/import ordering; `git diff --check` passed
Known external failures: no hosted database, production cookie, multi-instance deployment, real Google credential, or provider outage was exercised; authenticated GitHub inspection and the AUTH-004 provider/keyring rollout remain external; the Phase 0 standard/QA browser failure matrices were not rerun because this slice changed no frontend behavior
Remaining risks: browser access bearers remain visible to application JavaScript under AUTH-007; active-session inventory/individual device controls are a non-blocking hardening extension beyond the validated current/all-device revocation contract; migration-mode claimless access cannot be selectively revoked; long-lived WebSockets do not disconnect at revocation; revocation/login abuse throttling and security-event monitoring remain AUTH-010/Phase 12; Google incremental scope/provider revocation, hosted OAuth encryption cutover, and administrator strong authentication remain
Next phase: Phase 1D-1 atomic slice — inspect the existing administrator authorization/session boundary, add real strong-auth capability/enforcement contracts and fail-closed production gates without pretending locally configured MFA exists, and test privilege boundaries/recovery behavior; classify provider enrollment and live-factor drills accurately as external
Important commands: `rg -n 'ADMIN|admin|mfa|passkey|webauthn|amr|acr|require_permission' backend/app backend/tests lib app`; `cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_admin_panel.py tests/test_auth_sessions.py tests/test_config.py`; `.venv/bin/python -m alembic heads`; `./scripts/test_interaction_status_postgres.sh`; inspect configuration and NextAuth claims before deciding whether Phase 1D-1 needs a migration
```

## Phase 1C-4 atomic checkpoint

```text
Phase: Phase 1 — Critical authentication and identity security, atomic slice 1C-4
Status: COMPLETE (Phase 1 and AUTH-006 remain in progress)
Initial HEAD: 712fcef749315a62b23c3b3387da3666ba1848c3
Final HEAD: Phase 1C-4 checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(session): enforce durable logout revocation
Files materially changed: authoritative access-token dependency/context; auth revocation repository/service/router/schema contracts; refresh lock ordering; NextAuth server-side sign-out event; backend token helper; Settings all-device logout workflow; SQLite/PostgreSQL/frontend/browser security tests; execution ledger and handoff
Migrations: None; this slice consumes the additive 0056 `auth_sessions` and `auth_refresh_credentials` schema without changing it
Behavior changed: every non-QA access JWT carrying `sid` must resolve to the same user and a live, unexpired, unrevoked database session; `persistent` mode rejects claimless legacy access JWTs while `migration` preserves their bounded rollout compatibility; `POST /auth/logout` derives current ownership from a verified refresh credential or authenticated access token and never accepts a caller-selected session ID; `POST /auth/logout-all` revokes every durable family for the authenticated account; refresh/logout/logout-all lock the session family before credentials; NextAuth sign-out sends its server-held refresh proof to the backend before clearing the same-origin cookie and falls back to access proof only when refresh material is absent; refresh credentials remain absent from `/api/auth/session`; Settings adds an explicit confirmed “Sign out everywhere” workflow
Security assumptions: PostgreSQL row locking is authoritative for multi-instance refresh/revocation serialization; a refresh proof is preferred because access may already be expired at logout; the refresh value travels only from the NextAuth server event to the backend and is never serialized into the browser session; backend request-body logging must remain disabled/redacted for auth routes; migration-mode claimless access remains non-revocable until its production-capped <=60-minute expiry, which is why migration must be bounded; a backend outage can prevent remote family revocation even though NextAuth still clears its local cookie, so revocation failures are logged and production monitoring remains required; existing long-lived WebSockets do not re-authenticate mid-connection and remain Phase 8 work
Tests run: focused auth-session pytest; focused Node session/privacy tests; focused Ruff on every touched Python file; TypeScript; complete frontend unit suite; complete backend pytest; ESLint; production build; fresh disposable PostgreSQL migration/downgrade/re-upgrade plus forced concurrent refresh and refresh-versus-logout tests; complete Settings Chromium Playwright suite; Alembic heads/current; whole-tree Ruff baseline; `git diff --check`
Exact results: focused auth-session 15 passed / 2 warnings; focused frontend security 19 passed; focused Ruff passed; TypeScript passed; frontend unit 1,125 passed / 0 failed; backend 6,449 passed / 57 skipped / 88 warnings in 299.85s; ESLint 0 errors / 33 known warnings; production build passed with 32 static pages; disposable PostgreSQL suite 22 passed / 2 warnings; Settings Playwright 10 passed; one Alembic head `0056_persistent_auth_sessions`; configured local SQLite remains unstamped; whole-tree Ruff remains at 110 known findings; `git diff --check` passed
Known external failures: no hosted database or live multi-instance deployment was touched; no real production cookie, load balancer, Google credential, or outage logout was exercised; authenticated GitHub inspection and the AUTH-004 provider/keyring rollout remain external; the whole standard/QA browser matrices retain the Phase 0 known failures and were not claimed green
Remaining risks: AUTH-006 still needs atomic all-family revocation on password reset, administrator suspension, and any future credential change, plus active-session inventory/individual revocation; migration-mode claimless access cannot be selectively revoked; long-lived WebSockets do not disconnect at revocation; revocation endpoint abuse throttling/audit work remains AUTH-010; browser access bearers remain visible to application JavaScript under AUTH-007; server-side revocation failures need production alerting; Google incremental scope/provider revocation, hosted OAuth encryption cutover, and administrator strong authentication remain
Next phase: Phase 1C-5 atomic slice — make password reset and administrator suspension revoke every durable session family in the same transaction, preserve unsuspension/relogin behavior, and add concurrency/security regression tests before considering active-session management
Important commands: `cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_auth_sessions.py tests/test_admin_panel.py`; inspect `AuthService.reset_password`, administrator suspension/unsuspension handlers, `AuthRepository.revoke_auth_sessions`, and transaction boundaries; run `.venv/bin/python -m alembic heads`, `./scripts/test_interaction_status_postgres.sh`, focused Ruff, then broad auth/backend/frontend gates; no migration is expected unless inspection proves otherwise
```

## Phase 1C-3 atomic checkpoint

```text
Phase: Phase 1 — Critical authentication and identity security, atomic slice 1C-3
Status: COMPLETE (Phase 1 remains in progress; AUTH-005 is VALIDATED and AUTH-006 is IN_PROGRESS)
Initial HEAD: e18f5800ee2fb4f2df1f095affd77bd2179cfa82
Final HEAD: Phase 1C-3 checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(session): add persistent rotating refresh sessions
Files materially changed: auth-session/refresh-credential models and repository; token creation/refresh service and auth router; production configuration; Alembic 0056; NextAuth refresh singleflight; backend/frontend security, migration, import-order, and PostgreSQL race tests; environment/operator docs; execution ledger and handoff
Migrations: 0056_persistent_auth_sessions additively creates `auth_sessions` and `auth_refresh_credentials`; raw refresh values never enter the database; the downgrade refuses while any unexpired session family exists because removing server state would reactivate used or revoked signed credentials
Behavior changed: `legacy` retains the old stateless behavior for local/rollback compatibility; `migration` issues persistent families while temporarily accepting claimless legacy refresh JWTs; `persistent` rejects legacy refresh JWTs; password and Google logins share durable issuance; each refresh rotates once under row locks; immediate duplicate use is rejected without falsely revoking the family, while delayed reuse revokes every family credential and records compromise; suspended accounts cannot log in and presented persistent families are revoked; NextAuth coalesces identical same-process refresh callbacks and rejects a backend response without a replacement credential; production boot requires a <=60-minute access lifetime and forbids `legacy`
Security assumptions: deploy migration 0056 before enabling non-legacy issuance; use `migration` only for a bounded compatibility window with explicit acknowledgement; do not switch to `persistent` until the last stateless refresh issued by an old instance has expired (or deliberately rotate JWT_SECRET and accept global logout); never roll an old stateless binary back over live persistent credentials without a signing-secret rotation/global logout; SHA-256 is safe here because signed refresh JWTs contain high-entropy UUID credential IDs; PostgreSQL row locking is authoritative for multi-instance rotation; the reuse grace prevents a false family-compromise decision but never accepts the duplicate credential; access-token session revocation is intentionally the next atomic slice
Tests run: focused auth/session/config/migration pytest; isolated repository-first import regression; focused Ruff on every touched Python file; full backend pytest; TypeScript; all frontend unit tests; ESLint; production build; production-mode backend import; fresh disposable PostgreSQL upgrade/downgrade/re-upgrade plus schema and forced concurrency tests; diagnostic Alembic drift check; complete Settings Playwright; one real-backend QA customer/API journey with `AUTH_SESSION_MODE=persistent`; `git diff --check`
Exact results: focused auth checkpoint 54 passed / 7 warnings; focused Ruff passed; full backend 6,443 passed / 56 skipped / 88 warnings in 297.31s; TypeScript passed; frontend unit 1,122 passed / 0 failed; ESLint 0 errors / 33 known warnings; production build passed with 32 static pages; production-mode backend import passed; one Alembic head `0056_persistent_auth_sessions`; disposable PostgreSQL suite 21 passed / 2 warnings; whole-tree Ruff remains at 110 known findings; diagnostic `alembic check` reported only pre-existing unrelated drift and no auth-session operation; Settings Playwright 9 passed; persistent-session real-backend QA probe 1 passed
Known external failures: no hosted database migration or session rollout ran; no real production cookies, Google credentials, load balancer, or multi-instance staging were exercised; live OAuth/keyring work from AUTH-004 remains external; no push or deployment occurred
Remaining risks: AUTH-006 still needs access-token revocation enforcement, current-session logout, logout-all, password-reset/credential-change all-family revocation, immediate suspension revocation, and active-session management; same-process frontend singleflight does not coordinate separate frontend instances (the backend safely produces one winner without family revocation, but a losing callback can still require retry); refresh abuse throttling/audit work remains AUTH-010; browser access bearers remain visible to application JavaScript under AUTH-007; ordinary Google login still requests YouTube/offline scope; admin strong authentication remains; production must complete the explicit migration window; whole-tree Ruff and Alembic drift are known baseline debt
Next phase: Phase 1C-4 atomic slice — make the `sid` access claim authoritative, add authenticated current-session and all-session revocation APIs, wire same-origin logout without exposing refresh credentials, and cover revoked-access/logout concurrency before adding password-reset/suspension triggers
Important commands: `cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_auth_sessions.py tests/test_auth_and_channels.py tests/test_config.py`; `.venv/bin/python -m alembic heads`; `./scripts/test_interaction_status_postgres.sh`; `cd .. && node --test tests/backendTokenRefresh.test.mjs && npx tsc --noEmit`; inspect `backend/app/api/deps.py`, `backend/app/services/auth_service.py`, `backend/app/repositories/auth_repository.py`, `lib/auth.ts`, and the NextAuth sign-out callers before designing revocation
```

## Phase 1C-2 atomic checkpoint

```text
Phase: Phase 1 — Critical authentication and identity security, atomic slice 1C-2
Status: COMPLETE (Phase 1 and AUTH-004 remain in progress)
Initial HEAD: bd52e97f10428c00dc55889b0be5f338e82703be
Final HEAD: Phase 1C-2 checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(auth): encrypt stored OAuth credentials
Files materially changed: OAuth credential cryptographic primitive and storage policy; OAuth account model/repository/YouTube credential consumer; production configuration and dependency injection; Alembic 0055; idempotent rotation CLI; focused unit/API/rotation/PostgreSQL tests; backend dependency declaration/lock; backend environment and operator documentation; execution ledger and handoff
Migrations: 0055_oauth_credential_encryption additively adds nullable `access_token_ciphertext`, `refresh_token_ciphertext`, and `credentials_encrypted_at`; it performs no implicit data rewrite, preserves plaintext columns for an explicit expand/backfill/contract rollout, and refuses a downgrade that would discard encrypted-only credentials
Behavior changed: configured OAuth writes can run in temporary rollback-compatible `dual` mode or steady-state `encrypted_only` mode; encrypted-only writes clear plaintext and reads never fall back to plaintext; YouTube refresh decrypts only inside the backend repository boundary; AES-GCM additional authenticated data binds ciphertext to its provider, provider subject, and token field; old keys decrypt while new writes use only the active key; the operator command is dry-run by default, requires exact APP_ENV confirmation to write, locks and commits bounded batches, resumes idempotently, and never emits credential values
Security assumptions: every configured key is independently generated 32-byte secret material held only in the server secret manager; key IDs are non-secret stable labels; all historical keys remain available until every row is verified on the active key; `dual` mode is a temporary acknowledged migration state and not production steady state; migration 0055 must land before code expecting its columns; hosted plaintext must not be cleared until dual backfill and rollback readiness have been verified; database/host compromise is outside application-layer key custody and the keyring must not share that trust boundary
Tests run: focused OAuth cipher/storage/rotation/config/Google/auth pytest; focused Ruff on every touched Python file; full backend pytest; Python compileall; uv lock consistency; rotation CLI help and fail-closed default; Alembic heads; fresh disposable PostgreSQL upgrade, downgrade to 0038, fixture load, re-upgrade, schema/concurrency/interaction tests; `git diff --check`; whole-tree Ruff baseline comparison; diagnostic Alembic model-drift check
Exact results: 61 focused tests passed / 7 warnings; focused Ruff passed; full backend 6,428 passed / 54 skipped / 88 warnings in 292.94s; compileall passed; uv resolved-lock check passed with 62 packages; rotation CLI help passed and default plaintext configuration failed closed with exit 2; one Alembic head `0055_oauth_credential_encryption`; disposable PostgreSQL suite 17 passed / 2 warnings; whole-tree Ruff reported 110 known findings versus 111 at Phase 0; diagnostic `alembic check` reported only pre-existing unrelated model drift and no OAuth credential-column operation
Known external failures: no production keyring was provisioned; no hosted database was inspected or backfilled; no live Google token was encrypted/decrypted or revoked; no production secret manager or staging deployment was touched
Remaining risks: AUTH-004 remains `IN_PROGRESS` until a real keyring is provisioned, hosted rows complete dual backfill, encrypted-only mode clears and verifies plaintext, old-key retirement is proven, and provider disconnect/revocation is implemented; backend refresh sessions remain stateless/non-revocable; ordinary Google login still requests YouTube/offline scope; admin strong authentication remains; whole-tree Ruff and Alembic drift are known baseline debt
Next phase: Phase 1C-3 atomic slice — design and implement additive persistent session families with hashed rotating refresh credentials, replay/reuse detection, and compatibility-safe issuance before wiring revocation/logout behavior
Important commands: `cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_oauth_credentials.py tests/test_rotate_oauth_credentials.py tests/test_config.py tests/test_google_identity.py tests/test_auth_and_channels.py`; `.venv/bin/python -m alembic heads`; `./scripts/test_interaction_status_postgres.sh`; with a disposable configured database and non-secret test keyring, `.venv/bin/python -m scripts.rotate_oauth_credentials` before any `--apply`; inspect `app/core/security.py`, `app/services/auth_service.py`, and auth router/session response contracts before designing migration 0056
```

## Phase 1C-1 atomic checkpoint

```text
Phase: Phase 1 — Critical authentication and identity security, atomic slice 1C-1
Status: COMPLETE (Phase 1 remains in progress)
Initial HEAD: f60463629f32b3dbcfe0728a978514a4d694af3a
Final HEAD: Phase 1C-1 checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(auth): enforce concurrent OAuth link ownership
Files materially changed: OAuth account model; AuthService concurrent-conflict recovery; Alembic 0054; disposable PostgreSQL auth race tests; PostgreSQL migration test runner; execution ledger and handoff
Migrations: 0054_oauth_link_uniqueness adds `uq_oauth_user_provider` on `(user_id, provider)` after a non-destructive ambiguous-link preflight; downgrade removes only that constraint
Behavior changed: simultaneous different Google subjects for one CreatorJobs user now have exactly one winner and one conflict; one Google subject cannot be claimed by different users; simultaneous identical exchanges converge successfully on one user/link instead of surfacing an unhandled database error
Security assumptions: one Google provider identity per CreatorJobs user is the established product contract; the existing `(provider, provider_account_id)` constraint remains authoritative for subject ownership; ambiguous legacy rows must be investigated, never auto-merged; PostgreSQL constraint arbitration is authoritative under concurrency
Tests run: focused Google/auth SQLite tests; focused Ruff; Alembic heads/current; fresh disposable PostgreSQL upgrade, downgrade to 0038, fixture load, re-upgrade, migration tests, interaction tests, and four deterministic OAuth concurrency tests; full backend pytest
Exact results: focused Google/auth 33 passed / 7 warnings; Ruff passed; one Alembic head `0054_oauth_link_uniqueness`; disposable PostgreSQL suite 14 passed / 2 warnings; full backend 6,405 passed / 53 skipped / 88 warnings in 303.37s
Known external failures: the hosted production database was not inspected; migration 0054 deliberately refuses any ambiguous pre-existing `(user_id, provider)` duplicates and requires security review before retry
Remaining risks: provider credentials remain plaintext at rest; key rotation and provider revocation are absent; backend refresh sessions remain stateless/non-revocable; Google login still requests YouTube/offline scope; admin strong authentication remains
Next phase: Phase 1C-2 atomic slice — add versioned application-layer encryption for provider access/refresh credentials with an expand/backfill/compatibility-safe migration and key-rotation tests
Important commands: `cd backend && .venv/bin/python -m alembic heads`; `./scripts/test_interaction_status_postgres.sh`; `APP_ENV=test .venv/bin/python -m pytest tests/test_google_identity.py tests/test_auth_and_channels.py`; inspect `app/core/config.py`, `app/models/oauth_account.py`, and every OAuth token read/write before designing 0055
```

## Phase 1B atomic checkpoint

```text
Phase: Phase 1 — Critical authentication and identity security, atomic slice 1B
Status: COMPLETE (Phase 1 remains in progress)
Initial HEAD: e1276e75b0584a622aaa561db983502cd191a266
Final HEAD: Phase 1B checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(session): keep Google credentials server-side
Files materially changed: NextAuth JWT/session callback and declarations; safe-session helper; YouHub, Post Job, and Settings YouTube flows; authenticated YouTube refresh API; legacy identity routes; frontend backend-client credential surface; unit/browser security tests; execution ledger and handoff
Migrations: None
Behavior changed: Google provider access/refresh credentials, provider subject, scope/expiry metadata, and raw profile claims are no longer copied into the NextAuth JWT or `/api/auth/session`; existing cookies are scrubbed on their next JWT callback and their JWT subject is normalized to the canonical backend user ID; the public session keeps only the non-secret provider name; browser YouTube refresh/reconnect now calls a same-origin authenticated server route, which delegates to the backend's stored OAuth account; legacy identity routes also use backend-held credentials; Settings now initiates Google re-consent when the backend reports `youtube_reauth_required`
Security assumptions: the verified Google exchange remains the only creator/updater of a provider link; backend-held OAuth credentials are authoritative; SameSite/HttpOnly NextAuth cookies and current same-origin routing remain intact; provider credentials are still plaintext in the database pending AUTH-004; CreatorJobs backend access tokens remain browser-visible pending the additive persistent-session/browser-boundary work
Tests run: provider-session security unit suite; all frontend unit tests; TypeScript; ESLint; production build; focused backend Google/auth tests; complete Settings Playwright suite plus direct `/api/auth/session` sentinel test
Exact results: provider-session security 5 passed; frontend unit 1,119 passed / 0 failed; TypeScript passed; ESLint passed with 0 errors / 33 pre-existing warnings; production build passed and generated 32 static pages; backend focused auth 33 passed / 7 warnings; complete Settings Playwright suite 9 passed, including the direct `/api/auth/session` credential-sentinel regression and server-owned YouTube refresh
Known external failures: real Google consent/re-consent, provider revocation, and provider outage exercises require configured staging Google credentials; none were used
Remaining risks: OAuth credentials need at-rest encryption/key rotation and revocation; concurrent provider-link races need deterministic PostgreSQL proof; backend refresh sessions remain stateless/non-revocable; basic Google login still requests offline YouTube scope; full browser/backend cookie boundary and admin strong authentication remain
Next phase: Phase 1C atomic slice — validate concurrent OAuth-link collision behavior on disposable PostgreSQL, then implement a coherent rotation-ready at-rest credential encryption slice only if migration/test budget remains sufficient
Important commands: `rg -n 'access_token|refresh_token|provider_account_id' backend/app/models backend/app/repositories backend/app/services`; `cd backend && .venv/bin/python -m alembic heads`; `node --test tests/providerSessionSecurity.test.mjs`; `npx playwright test tests/e2e/settings.spec.ts`
```

## Phase 1A atomic checkpoint

```text
Phase: Phase 1 — Critical authentication and identity security, atomic slice 1A
Status: COMPLETE (Phase 1 remains in progress)
Initial HEAD: 832d0332d66c2abf2d6e2d168c2ac51ae7258fa6
Final HEAD: Phase 1A checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): security(auth): verify Google identity server-side
Files materially changed: backend Google identity service/config/dependencies/auth schema/router/service/repository; authenticated OAuth update boundary; NextAuth exchange and browser token-recovery callers; auth/security tests; execution ledger and handoff
Migrations: None
Behavior changed: `/auth/oauth/google` now requires a Google-issued ID token; email, subject, verified-email state, and display name derive only from verified claims; caller identity fields are forbidden; provider subjects cannot be reassigned; `/me/oauth/google/upsert` cannot create or choose a link; NextAuth fails closed when backend Google authentication fails; browser recovery now asks the server-owned NextAuth session to refresh instead of rebuilding identity from browser fields; production boot requires backend GOOGLE_CLIENT_ID; Google exchange uses the auth-login rate limit
Security assumptions: backend GOOGLE_CLIENT_ID exactly matches the Google OAuth client used by NextAuth; google-auth owns signature/JWKS validation; Google's documented issuers remain accounts.google.com and https://accounts.google.com; HTTPS termination and real provider credentials remain external deployment gates
Tests run: focused Google/auth/config pytest; dependent job/import pytest; full backend pytest; focused Ruff; TypeScript; ESLint; all frontend unit tests; production frontend build
Exact results: 38 focused auth/config tests passed; 422 dependent backend tests passed; full backend 6,405 passed / 49 skipped / 88 warnings; focused Ruff passed; TypeScript passed; ESLint passed with the pre-existing 33 warnings; frontend unit 1,114 passed / 0 failed; production build passed with 31 static pages
Known external failures: real Google login/JWKS/provider-outage exercise requires configured Google credentials and staging; no external service was changed
Remaining risks: Google access/refresh credentials and provider metadata are still serialized into browser-visible sessions; provider credentials remain plaintext at rest; backend refresh sessions remain stateless and non-revocable; concurrent OAuth-link races still need deterministic PostgreSQL validation/recovery; Google login still requests YouTube/offline scopes; admin strong-auth work remains
Next phase: Phase 1B atomic slice — remove browser-visible Google provider credentials while preserving explicit YouTube connection/reconnection
Important commands: `rg -n 'accessToken|refreshToken|providerAccountId|oauthScope|profile' lib/auth.ts types/next-auth.d.ts app components`; `APP_ENV=test .venv/bin/python -m pytest tests/test_google_identity.py tests/test_auth_and_channels.py`; `npx tsc --noEmit`
```

## Phase checkpoint

```text
Phase: Phase 0 — Baseline and preservation
Status: COMPLETE
Initial HEAD: 2b616e1f239ffa5c0129be1da1b1324197d68650
Final HEAD: Phase 0 checkpoint commit (self-resolve with `git log -1 --format=%H`)
Commit(s): docs(readiness): establish phase 0 execution baseline
Files materially changed: docs/PRODUCTION_READINESS_EXECUTION.md; docs/PRODUCTION_READINESS_HANDOFF.md
Migrations: None
Behavior changed: None
Security assumptions: Local branch/ref inspection is authoritative; remote state remains unverified; no production credentials or hosted services were used
Tests run: Repository integrity/ref checks; TypeScript; ESLint; frontend unit; frontend build; backend pytest; Ruff; Alembic heads/current; disposable PostgreSQL migration test; standard Playwright; serial deterministic rerun; real-backend QA Playwright; npm/Python audits; Gitleaks history scan
Exact results: See baseline matrix below
Known external failures: GitHub remote fetch requires credentials; live Google/email/storage/Redis/hosting/legal/staging checks unavailable
Remaining risks: Every non-baseline item in the execution ledger; current release assessment is NO-GO
Next phase: Phase 1 — Critical authentication and identity security
Important commands: See final section
```

## Repository and preservation baseline

- Active branch: `integration/import-and-messaging-2026-07-30`
- Initial HEAD: `2b616e1f239ffa5c0129be1da1b1324197d68650`
- Primary worktree was clean before Phase 0.
- Secondary worktree `/Users/guhanpurushothaman/creator-jobs-messaging-paused` is on `wip/messaging-paused` and was clean.
- `git fsck --full --no-reflogs` reported dangling recovery commits/trees but no corruption.
- Every local branch is an ancestor of the active integration branch; no local branch has a commit absent from the active branch.
- The active branch is 266 commits ahead of local `main` and 147 commits ahead of its locally recorded upstream.
- Authenticated remote fetch failed during the audit because credentials are unavailable. Do not infer current remote truth from local tracking refs.

Frozen recovery references recorded at Phase 0:

| Reference | Kind | Object |
|---|---|---|
| `wip/messaging-paused` | branch | `fdabfd4b3feb2ea75fda3ac0a889f7e02dac5158` |
| `recovery/pre-messaging-merge` | branch | `858934259fe8ea7b7de69ac2326d4c099375a80c` |
| `backup/integrated-import-messaging-2026-07-30` | branch | `de7a0583e4c003073fc0cd67b4fdc43859cf0eed` |
| `wip/job-import-readiness-paused-2026-07-25` | branch | `93c31b2ae69512a7b0f38d5098e65f861e0028b5` |
| `integrated-import-messaging-2026-07-30` | annotated/lightweight tag | `5e06112afbf9cf36a2957491c26e6626f4fe5523` |

Never delete, move, reset, rebase, amend, or repoint these references.

## Phase 0 baseline matrix

All results below were obtained at the initial HEAD. Long-running audit results immediately preceded Phase 0 and the repository remained clean at the same commit; TypeScript, lint, and frontend unit tests were rerun during Phase 0.

| Check | Exact result | Baseline classification |
|---|---|---|
| `npx tsc --noEmit` | PASS | Green |
| `npm run lint` | PASS exit code; 0 errors, 33 warnings | Known debt |
| `node --test tests/*.test.mjs` | 1,114 passed; 0 failed/skipped | Green |
| `npm run build` with production-like non-secret config | PASS; 31 static pages generated | Green |
| `APP_ENV=test .venv/bin/python -m pytest` | 6,387 passed; 49 skipped; 86 warnings | Green with known skips/warnings |
| `.venv/bin/ruff check .` | 111 findings | Known baseline failure |
| `.venv/bin/python -m alembic heads` | One head: `0053_brand_about_enrichment_state` | Green |
| `.venv/bin/python -m alembic current` | Configured local SQLite has no stamped revision | Known local-state limitation |
| `./scripts/test_interaction_status_postgres.sh` | Fresh disposable PostgreSQL upgrade, downgrade to `0038`, fixture load, re-upgrade; 10 tests passed | Green |
| `npm run test:e2e` | 438 passed; 26 failed | Known baseline failure |
| Serial rerun of the 26 failed browser tests | 9 passed; 17 failed deterministically | Known deterministic failures |
| `npm run test:e2e:qa` | 272 passed; 6 failed; 2 skipped in 14.8 minutes | Known baseline failure |
| Frontend production dependency audit | 6 vulnerabilities: 1 critical, 4 high, 1 moderate | Release blocker |
| Python environment audit | 37 findings in 12 packages | Release blocker |
| Production backend import with memory limiter | PASS | Limited baseline only |
| Production backend import with recommended Redis limiter | FAIL: Redis Python package absent | Release blocker |
| Production HTTP probes | `/`, `/api/health`, `/auth`, `/you` returned 200; dev/QA routes returned 404 | Partially green |
| Security headers/metadata probes | CSP absent; root canonical inherited by private pages and 404s | Release blocker |
| Gitleaks full-history scan | 286 commits and 18.45 MB scanned; one generic-key alert in `backend/app/main.py` manually confirmed false positive | Green, retain CI scan |

The tracked history contains only `.env.example` and `backend/.env.example` among environment files. Local ignored environment files exist and were not read into this document. No secret value was printed or stored.

## Known browser failures

### Standard Playwright: 17 deterministic failures

The initial 464-test run had 26 failures. A serial rerun passed 9 and reproduced 17. The deterministic set covers:

- Recruiter and agency public profile views and entry links.
- Pipeline row to chat-dock handoff.
- Homepage/jobs beta trust copy.
- Internal/external job detail and application behavior, including demo deadlines.
- Dev data-source switch.
- `/post-job` horizontal overflow at 390 and 320 pixels.
- Search results and empty state.
- Job-detail statistics/trust panel.
- Multi-screen Post Job headings.
- `/jobs/1` smoke behavior.
- External Apply CTA and link semantics.

The nine failures that passed serially remain flake candidates and must not be silently dismissed; they included settings, admin planned-tab, listing actions, and portfolio-popup cases.

### Real-backend QA Playwright: 6 failures

1. `tests/e2e/qa/applicant-requirements.spec.ts:173` — submitted application modal never closes; Send application remains present.
2. `tests/e2e/qa/craft-ambiguity.spec.ts:76` — persisted role snapshot becomes `Video Editor` instead of `Video Editor\nLikely match` expected by the current contract; inspect whether presentation copy leaked into selection or the test contract is stale before changing either.
3. `tests/e2e/qa/draft-assistant.spec.ts:581` — typing indicator overlaps the submitted reply by approximately 0.61 px.
4. `tests/e2e/qa/post-job-later-steps.spec.ts:669` — switching onsite Kolkata back to remote retains `Kolkata` instead of clearing it.
5. `tests/e2e/qa/qa-personas.spec.ts:488` — duplicate `job-apply-button` test IDs exist in desktop and mobile containers.
6. `tests/e2e/qa/workspace-performance.spec.ts:108` — `/me/interviews` and `/me/engagements` were each requested three times; contract permits at most two.

Do not weaken these tests without first proving that their asserted product contract is wrong.

## Phase 1 current risk state

- Phase 1A removed the caller-asserted Google identity takeover: `/auth/oauth/google` now accepts a signed ID token and derives identity only after server verification.
- Phase 1A made provider-subject reassignment fail closed and removed browser-driven identity reconstruction. Phase 1C-1 added the inverse database uniqueness constraint and deterministic PostgreSQL races, so AUTH-002 is now `VALIDATED`.
- Phase 1B removed Google access/refresh tokens, provider subject, OAuth metadata, and raw claims from the browser session and from the encrypted NextAuth JWT. A sentinel-bearing legacy JWT produced a clean `/api/auth/session` response in Playwright.
- YouHub, Post Job, and Settings refresh or disconnect YouTube through authenticated same-origin server routes that reject cross-origin and QA use, return bounded states, and never expose provider credentials.
- Provider credentials have a locally validated AES-256-GCM storage path, rotation keyring, additive migration, idempotent backfill/rewrap command, fixed-endpoint refresh, remote revocation, unconditional local clearing, and credential-free audit history. Production rows remain unverified and may remain plaintext until the external dual-backfill/encrypted-only rollout is actually completed; real Google behavior is also unverified.
- Backend refresh tokens are durable, hash-only, one-time credentials grouped into persistent families. Rotation is serialized on PostgreSQL; delayed replay revokes the family and records compromise; production cannot boot in stateless `legacy` mode.
- Signed access-token `sid` now resolves through live database state on every non-QA authenticated request. Revocation therefore stops both refresh and subsequent HTTP access immediately; `persistent` rejects claimless access while bounded `migration` mode accepts it until its production-capped <=60-minute expiry.
- Current-session logout prefers the server-held refresh credential, logout-all revokes every durable family, and Settings exposes a confirmed all-device workflow. NextAuth performs current-family revocation inside its same-origin sign-out event without serializing its refresh credential into `/api/auth/session`.
- Password reset and both administrator-suspension entry points now revoke every durable family atomically. Password/reset issuance, reset confirmation, existing-account Google login, and suspension share a user-first lock boundary, so a concurrent old-password/provider login either commits before the security event and is revoked or observes the new security state and fails. AUTH-006 is `VALIDATED`.
- Active-session inventory/individual device controls remain a non-blocking hardening extension; long-lived WebSocket disconnect, abuse throttling/audit, and production revocation-failure alerting remain AUTH-010/Phase 8/Phase 12 work.
- Administrator TOTP is a complete locally validated factor lifecycle: secrets are encrypted under a dedicated keyring, TOTP steps and recovery codes are one-use, failures lock durably, factor changes revoke session families, and every privileged backend route checks current durable-session assurance. The browser adds password/Google primary reauthentication, enrollment, challenge, one-time recovery display, rotation, disablement, and a production fail-closed no-shell gate. AUTH-008 is `VALIDATED`.
- The browser factor adapter is same-origin, action-allowlisted, size-bounded, no-store, and rejects cross-site POSTs. Google reauthentication proof is held for at most five minutes in the encrypted HttpOnly NextAuth JWT cookie and is never serialized into the Session API; ordinary browser JSON cannot supply it.
- The rollout is deliberately additive: land 0056, run bounded `migration` mode until the final legacy refresh expires, then use `persistent`; land 0057 and 0058, provision the dedicated strong-auth keyring, then enable administrator strong-auth enforcement; land 0059 before code emits OAuth connection events. Downgrade/old-binary rollback after persistent issuance requires JWT signing-secret rotation/global logout, downgrade of 0057 is refused once assurance state has been used, downgrade of 0058 is refused while factor material exists, and downgrade of 0059 is refused once audit history exists.
- Ordinary Google login requests identity scopes only. YouTube authorization is explicit and incremental, the access token must match the signed OIDC `at_hash`, a server-only exchange secret gates persistence, and a successful provider authority check precedes credential/channel commits. Live provider validation remains `BLOCKED_EXTERNAL`.

Phase 1 must remain additive and migration-safe. The browser-field removal, least-privilege server-owned YouTube lifecycle, OAuth ownership constraints, local encrypted credential architecture, persistent refresh-family foundation, authoritative access checks, explicit logout contracts, security-event revocation, and real administrator strong authentication are complete locally. Do not bypass the verified exchange, reintroduce browser provider credentials, accept caller-selected session IDs or provider proof in browser strong-auth JSON, trust JWT claims for strong-auth elevation, broaden the base-auth dependency beyond logout/factor ceremonies, change the user-then-OAuth lock order without real PostgreSQL race tests, retire an OAuth/strong-auth key before a zero-pending rotation audit, or remove plaintext columns before the hosted encrypted-only contract is verified.

## Phase 2 files to read first

- `backend/app/services/job_url_fetcher.py`
- `backend/app/services/job_import_url_service.py`
- `backend/app/services/brand_enrichment_probe.py`
- `backend/app/services/brand_enrichment_service.py`
- `backend/app/services/profile_service.py`
- `backend/app/services/youtube_service.py`
- `backend/app/services/google_oauth_refresh.py`
- `backend/app/services/google_oauth_revocation.py`
- `app/api/profile/organization-identity/route.ts`
- `app/api/location/autocomplete/route.ts`
- `app/api/location/details/route.ts`
- `backend/tests/test_job_url_import.py`
- `backend/tests/test_brand_url_fetcher.py`
- every additional caller/test returned by the outbound-fetch inventory before designing a shared primitive

## Important commands

Before Phase 2A:

```bash
cd /Users/guhanpurushothaman/creator-jobs-phase1
git branch --show-current
git rev-parse HEAD
git status --short
git worktree list
git show-ref | rg 'messaging-paused|pre-messaging-merge|integrated-import-messaging|job-import-readiness-paused'
```

Focused discovery:

```bash
rg -n 'httpx\.|fetch\(|requests\.|urlopen|AsyncClient|ClientSession' backend/app app lib
sed -n '1300,1760p' backend/app/services/job_url_fetcher.py
sed -n '1,280p' backend/app/services/brand_enrichment_probe.py
sed -n '1,260p' app/api/profile/organization-identity/route.ts
```

Migration safety:

```bash
cd /Users/guhanpurushothaman/creator-jobs-phase1/backend
.venv/bin/python -m alembic heads
APP_ENV=test .venv/bin/python -m alembic current
./scripts/test_interaction_status_postgres.sh
# Dry-run only unless the target environment, keyring, migration, and rollback
# posture have been independently verified.
.venv/bin/python -m scripts.rotate_oauth_credentials
```

No push, production deployment, hosted Neon access, Vercel change, or Render change occurred through the latest atomic checkpoint.
