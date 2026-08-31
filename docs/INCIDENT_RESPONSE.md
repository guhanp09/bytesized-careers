# CreatorJobs incident response

This is the application runbook for the invite-only CreatorJobs beta. It names
controls that exist in this repository and makes the missing infrastructure
explicit. It is not evidence that a hosted alert fired, a backup restored, a
provider failed over, or a human on-call rotation acknowledged a page.

Use this document together with:

- `docs/OPERATIONS_ALERTS.md` for finite alert keys and first-response detail;
- `docs/INCIDENT_TABLETOP.md` for the local decision-path review;
- `docs/CREDENTIAL_ROTATION.md` for planned versus compromised-secret handling;
- `docs/PRODUCTION_READINESS_EXECUTION.md` for unresolved release gates;
- `backend/app/core/config_contract.py` and
  `python -m scripts.print_config_contract` for names and enforcement of
  production settings without reading or printing their values.

## Incident roles and severity

One person must be the incident commander. They own severity, containment,
decision logging, approvals, and the point at which the incident closes. A
technical lead investigates and executes approved changes. A communications
lead owns customer/support updates. A scribe records UTC times, immutable
release IDs, bounded alert keys, decisions, and validation results.

For a one-person beta operation, one human may hold all four roles, but should
still write each decision under the role that made it. A second trusted person
must approve destructive data recovery, production credential rotation,
privilege restoration, or a database traffic cutover.

- **SEV-1:** confirmed or credible customer-data loss/disclosure, administrator
  compromise, authentication takeover, broad write corruption, or a security
  control that cannot be restored while exposed traffic continues.
- **SEV-2:** customer-critical workflow outage, provider outage without a safe
  fallback, repeated terminal email failures, or a bad release with broad impact.
- **SEV-3:** bounded degradation with durable state intact, such as delayed
  realtime hints while authenticated HTTP reads remain correct.

Severity may rise as evidence changes. Never lower it merely because liveness
is green; liveness proves only that the process answers.

## Universal first ten minutes

1. Open one incident record. Record the UTC declaration time, commander,
   affected environment, immutable frontend/backend release IDs, current
   Alembic revision, and only the finite alert/probe names involved.
2. Stop the release pipeline and unrelated operator mutations. This repository
   has no production maintenance-mode switch; traffic or write isolation is an
   external routing/database action and needs explicit approval.
3. Ask three separate questions:
   process liveness (`/api/v1/health`), mandatory database readiness
   (`/api/v1/health/ready`), and optional feature health
   (`/api/v1/health/job-import`, `/api/v1/health/realtime`). Never point a
   liveness restart policy at readiness or an optional provider.
4. Choose the smallest reversible containment that stops further harm. Preserve
   durable rows and audit history. A failed realtime hint or provider response
   is not authority to replay the customer mutation that preceded it.
5. Preserve sanitized logs, audit identifiers, release manifests, migration
   output, provider request IDs, and alert acknowledgements. Do not paste access
   tokens, authorization headers, email/message/job/AI content, database URLs,
   SMTP credentials, webhook secrets, OAuth credentials, or private source maps
   into the incident record.
6. State what is unknown. A local test is not proof of a hosted restore, real
   alert delivery, DNS change, provider revocation, or multi-instance recovery.

For a shell-local probe, set a non-secret origin and keep the three questions
separate:

```bash
CREATORJOBS_BACKEND_ORIGIN=https://api.example.invalid
curl -fsS "$CREATORJOBS_BACKEND_ORIGIN/api/v1/health"
curl -fsS "$CREATORJOBS_BACKEND_ORIGIN/api/v1/health/ready"
curl -fsS "$CREATORJOBS_BACKEND_ORIGIN/api/v1/health/job-import"
curl -fsS "$CREATORJOBS_BACKEND_ORIGIN/api/v1/health/realtime"
```

Run `npm run test:e2e:synthetics` only against local or isolated staging data,
never against a customer cohort and never concurrently with another build or
Playwright process sharing `.next`.

## Release regression or bad release

### Detect

Use a release-correlated `backend_unhandled_exception` or
`browser_client_exception`, a newly failing synthetic journey, a readiness
change, or a reproducible customer contract failure. A rising support count
alone is a triage signal, not proof that the newest release is causal.

### Contain

Freeze promotion. Identify the last immutable frontend and backend artifacts
that are compatible with the database revision now deployed. If the change is
code-only and the previous binaries are compatible with the current schema,
route traffic back to those exact artifacts through the hosting platform. Do
not rebuild an old Git commit and call it the same artifact.

If a migration ran, use the bad-migration runbook before moving application
traffic. Many CreatorJobs migrations are expand/contract and several refuse a
lossy downgrade once durable auth, factor, or audit state exists.

### Preserve

Keep both release IDs, the private source-map artifact/checksum for the failing
release, the alert batch, first failing request UUID, migration output, and the
time traffic moved. Preserve the database at its current revision.

### Recover

Prefer a forward fix when the previous binary cannot safely read the current
schema. Release through the ordinary immutable build and sole-head migration
step. Do not edit a deployed container or copy a local `.next` directory into
production.

### Verify

Verify liveness, readiness, affected feature probes, the exact failed journey,
all six local/no-cost synthetics in isolation/staging, and absence of a new
alert for the repaired release. Confirm ordinary database writes before ending
the incident; a homepage 200 is insufficient.

### External gate

Artifact retention, traffic shifting, rollback permissions, alert delivery, and
an actual staging rollback drill are `BLOCKED_EXTERNAL` until configured and
exercised. No provider rollback occurred in this repository session.

## Failed or incompatible database migration

### Detect

The release step exits nonzero, reports multiple heads, cannot obtain its
bounded advisory lock, or finishes without the database at the sole target.
Readiness may be 503 while liveness remains 200; that separation is correct.

### Contain

Do not send new application instances traffic. Stop further migration attempts,
record whether any DDL committed, and keep the old compatible instances in
service only if they can safely use the observed schema. Never bypass the
advisory lock or mark a revision applied by hand to silence the release step.

Read the repository side without changing a database:

```bash
cd backend
.venv/bin/python -m alembic heads
```

On an explicitly approved target, `alembic current` is a revision read. Keep
the target URL in the secret manager or process environment and never paste it
into a ticket or command transcript.

### Preserve

Capture `At`, `Target`, and `Now at` output from
`python -m scripts.release_migrate`, the migration graph, the failed migration
name, database/provider event times, and a provider snapshot/clone identifier.
Do not log the database URL.

### Recover

Choose one of two reviewed paths: a forward corrective migration on an isolated
clone, or restoration of a provider backup into a new isolated database. A live
blanket Alembic downgrade is not a recovery plan. It can discard audit,
credential, notification, privacy, and marketplace state, and guarded revisions
will correctly refuse some downgrades.

### Verify

On the isolated target, prove one head, the expected current revision,
readiness, critical row/invariant counts, authentication/session behavior, email
outbox integrity, and AI draft/application/message persistence. Run the
PostgreSQL migration harness locally for repository compatibility, but do not
present it as hosted-data validation.

### External gate

The provider backup/clone, RPO, RTO, restore duration, traffic cutover, and
post-cutover observation are `BLOCKED_EXTERNAL`. OPS-001 remains open until an
isolated hosted restore really passes.

## Compromised customer account

### Detect

Treat a credible customer report, refresh-token reuse detection, unexpected
security-event audit entry, or administrator-confirmed activity as evidence.
Do not demand message content or a password from the reporter.

### Contain

If the account holder still controls a trusted session, use Settings **Log out
all devices**, which calls the authenticated `/api/v1/auth/logout-all` contract.
If control is uncertain, an assured administrator suspends the user from
`/admin/users` with a bounded reason. Suspension locks the user row, revokes all
durable session families, blocks new authentication, and hides public content
in the same transaction.

If a Google YouTube grant is implicated, the account holder can disconnect it;
local credential/channel invalidation completes even when Google revocation is
unavailable. Suspension and deletion hiding are independent states—do not use a
deletion request as a substitute for an administrative containment decision.

### Preserve

Keep session-family IDs, compromise timestamps, audit-entry IDs, provider
revocation status, and affected object IDs. Do not copy raw refresh/access
credentials, recovery codes, message bodies, or exported customer archives.

### Recover

Verify identity through an approved support process that is not based solely on
email from the possibly compromised inbox. Complete password reset or provider
account recovery, rotate affected user-owned grants, and issue a new session.
Unsuspend only after identity proof and investigation; cancellation of a
deletion request must never clear suspension.

### Verify

Old access and refresh credentials must fail, new login must observe current
account state, public profile/listings must remain hidden while suspended, and
the administrator audit must record containment/restoration. Check that an
unrelated account remains accessible.

### External gate

Support identity-proofing policy, live Google recovery, customer notification,
and any legal notification duty require real operators/providers and remain
external.

## Compromised administrator account

### Detect

Declare SEV-1 for credible administrator credential/factor loss, an unexpected
privileged audit action, privilege use outside the operator window, or a leaked
recovery code. Preserve the append-only audit rows; do not let the suspected
account investigate itself.

### Contain

A second trusted database operator runs the sanctioned role-revocation command
from `backend/`:

```bash
.venv/bin/python -m scripts.grant_admin compromised-admin@example.invalid --revoke
```

The command locks the account, demotes it to the safe ordinary role, revokes
every durable session and refresh credential in the same transaction, and
records the role transition plus bounded revocation count in the administrator
audit. It does not print or store a credential. After demotion, a different
assured administrator must suspend the now-non-admin account if the underlying
identity remains compromised. That second step also blocks temporary claimless
migration access, which cannot be selectively revoked but has already lost every
administrator permission through the database-backed role check.

Freeze other admin mutations and release/secret changes until the audit scope is
known. Never restore privilege through signup, a browser API, direct unreviewed
SQL, or the compromised account itself.

### Preserve

Keep role-change audit ID, session-family IDs, strong-auth factor-change events,
immutable release IDs, request UUIDs, and affected target IDs. Restrict audit
exports because target labels may contain personal data.

### Recover

Recover the human identity out of band, rotate only credentials whose exposure
is credible using the credential-rotation runbook, replace/re-enroll the strong
factor, and review every privileged action since the earliest possible
compromise. Grant administrator role only after a second-person approval.

### Verify

The old session must fail privileged authorization, the user must no longer be
ADMIN in the authoritative database, all durable session families must be
revoked, and one actor-less `admin.role.revoke` audit entry must show the
transition without an email or credential in its JSON. Confirm that a separate
assured administrator can still reach the audit and containment surfaces.

### External gate

A physical authenticator/lost-all-factors drill, named operator identities,
second-person approval system, and live secret/provider rotation remain
external. The local command test is not a claim that a human incident drill ran.

## Database corruption or data loss

### Detect

Use application invariant failures, missing durable rows, provider integrity
events, unexplained revision changes, or customer reports corroborated against
authoritative state. A cache/realtime miss is not database loss until an
authenticated HTTP read confirms it.

### Contain

Freeze writes at the routing/database layer; CreatorJobs does not pretend to
have an in-app read-only switch. Preserve liveness for diagnosis and remove
instances from traffic with readiness/routing rather than creating a restart
storm. Stop migrations, email workers, and AI provider work if they could widen
the affected state, while leaving durable queues untouched.

### Preserve

Record the earliest/latest known-good UTC times, current revision, release IDs,
database provider event IDs, affected tables/invariants, and immutable backup or
PITR target identifiers. Preserve current storage read-only. Never export a
customer table into chat or a general incident ticket.

### Recover

Restore the selected point into a new isolated database. Apply no application
traffic until schema and domain validation pass. Reconcile writes after the
restore point explicitly; do not replay HTTP requests or an email queue by
guessing. Switch the application only after approval and keep the damaged store
retained under restricted access for investigation.

### Verify

Verify the sole Alembic head/current revision, readiness, referential/domain
invariants, session revocation state, invitations, outbox sent/idempotency
state, AI drafts/leases, applications, conversations/messages, audit history,
privacy requests, and a bounded set of customer-owned reads. Observe new writes
and background workers after cutover.

### External gate

No hosted backup or PITR restore has been run. Backup encryption, retention,
RPO/RTO, isolated restore, write reconciliation, and traffic cutover remain
OPS-001/CERT-002 external gates.

## Media loss or storage failure

### Detect

Confirm a canonical stored media URL fails against the configured media origin,
then distinguish one missing object, a delivery/CDN failure, and provider-wide
loss. Do not send arbitrary user URLs through the owned-media optimizer while
testing.

### Contain

Stop or externally route-block avatar/banner upload endpoints if new writes
would land in a failing store. Preserve database URLs and the storage namespace;
do not mass-clear profile fields or delete alleged orphans during diagnosis.
Portfolio links that are not owned media remain separate browser-fetched URLs.

### Preserve

Keep object keys, owner IDs, content-type/checksum evidence available from the
provider, replacement audit times, and canonical origin configuration. Do not
make the bucket listable or copy customer images into the incident record.

### Recover

Restore into a quarantined/non-public namespace, validate ownership, key shape,
magic bytes, decoded dimensions/pixels, size, and stripped metadata, then
promote the object through the storage adapter. A database row pointing at a URL
is not proof the bytes exist. Orphan sweeping and account-deletion cascade must
not be improvised before MEDIA-005 is complete.

### Verify

For representative avatar/banner owners, prove authenticated replacement,
canonical URL generation, public rendering, optimizer allowlisting only for
owned keys, and safe deletion of the superseded object after the row commits.

### External gate

The repository has a tested `MediaStorage` seam and local adapter, not a real
production object-store adapter or provider backup. Provider retention/restore,
quarantine lifecycle, account-deletion cascade, and orphan recovery remain
MEDIA-001/005 and OPS-002 external/open gates.

## Abuse or rate-limit control outage

### Detect

Treat `rate_limit_backend_unavailable` as a security incident. Review bounded
429/rejection signals, report queues, `/admin/abuse-signals` volume outliers,
and provider-cost anomalies. Counts are review signals, not verdicts; do not
invent a guilt threshold from early beta traffic.

### Contain

Do not switch a multi-instance production deployment to the process-local
memory limiter. Keep invite-only registration enforced, set
`JOB_IMPORT_ENABLED=false` if cost-bearing AI calls are at risk, suspend
confirmed abusive accounts through the audited admin flow, and externally
route-block a narrowly abused endpoint if the shared limiter cannot be restored.
Preserve normal authenticated reads and Post Job where safe.

### Preserve

Keep finite rate-rule names, approximate windows/counts, request UUID samples,
report/audit IDs, infrastructure event IDs, and cost totals. Never store IPs,
emails, prompts, job descriptions, or message bodies as metric labels.

### Recover

Restore the configured shared limiter and validate atomic contention, expiry,
outage, and recovery against a real Redis service before reopening the affected
write surface. Review trusted-proxy configuration without printing the Redis URL
or credential. Unsuspend only after the abuse decision is reviewed.

### Verify

Prove allowed/rejected/unavailable paths, a shared bucket across instances,
trusted client identity, ordinary user isolation, and unaffected read flows.
Recheck AI quotas/budget caps if they were part of the incident.

### External gate

RATE-001 remains a beta blocker: the current Redis limiter is not proven atomic
under real contention and no real broker outage/recovery drill exists. This
runbook does not promote that implementation by documentation.

## Transactional email outage

### Detect

Use `email_worker_failed`, `email_delivery_failed`,
`email_enqueue_failed`, provider webhook state, and the administrator email
outbox. A retrying row is not terminal failure, and an idle worker produces no
heartbeat; process-death monitoring must come from deployment infrastructure.

### Contain

Stop the standalone email worker externally if provider calls could cause harm;
leases expire and rows stay durable. `EMAIL_DELIVERY_ENABLED=false` makes a newly
started worker use the mock provider for every outbox row, including verification,
reset, invitation, and notification mail. A running worker keeps the provider it
selected at startup, so stop it first and restart it only after the configuration
change is present. Requests can continue queueing durable intents while workers
are stopped. Never rerun signup, application, hire, or message mutations just to
regenerate an email.

### Preserve

Keep outbox row IDs, event categories, attempt counts, lease/retry times,
terminal/suppression state, and provider message/event IDs. Do not copy recipient
addresses or rendered email bodies into the incident record.

### Recover

Fix provider/DNS/credential state, leave bounce/complaint suppressions intact,
and restart one worker. Expired leases become claimable and idempotency/provider
IDs prevent duplicate intent. Review terminal rows individually; do not resend
hard-bounced or complained addresses to clear a queue.

### Verify

Use the deterministic test provider first. Then verify one approved real
authentication event and one optional notification, sent state/provider ID,
signed webhook replay rejection, suppression behavior, and absence of a second
send. Confirm worker-death monitoring separately.

### External gate

SMTP/provider credentials, SPF/DKIM/DMARC, webhook routing, bounce/complaint
delivery, process supervision, and a real provider recovery drill remain
external until exercised.

## AI provider, safety, or cost incident

### Detect

Use `ai_provider_failed`, `job_import_sweeper_failed`, the no-cost
`/api/v1/health/job-import` configuration probe, quota/budget records, provider
spend, and deterministic evaluation failures. Never put pasted source text,
prompts, or model output into an alert.

### Contain

Set the server-side `JOB_IMPORT_ENABLED=false` through the approved configuration
path and reload/restart the backend if the platform requires it. This stops new
provider work at both extraction and continuation boundaries even if an old
frontend still shows the entry point. It preserves completed private drafts and
ordinary manual Post Job. The stranded-import sweeper must keep settling leases
without ever calling the provider.

### Preserve

Keep attempt/draft IDs, finite operation/outcome, prompt/model version, bounded
token/cost totals, provider request ID, kill-switch time, and evaluation fixture
name. Never copy source text, account metadata, unrelated profile information,
messages, prompts, or raw provider responses.

### Recover

Resolve credential/model allowlist/provider/prompt issues, account for spend,
run the deterministic security/evaluation suite, and perform the no-cost boot
probe. Re-enable for an isolated beta cohort only after human review behavior,
idempotency, quota, retry, SSRF, and no-auto-publish contracts remain green.

### Verify

While off, both provider-start boundaries must return the bounded disabled
response and provider call count must remain zero; existing drafts remain
readable. After approved re-enable, one fixture import must become a private
draft, never auto-publish, and repeated idempotent requests must not buy another
provider call or job.

### External gate

Live provider availability, API-key rotation, configured spending alarms,
monthly kill threshold, data-control verification, and a controlled provider
outage drill remain external. The health probe deliberately makes no paid call.

## Realtime or shared-state outage

### Detect

Use `realtime_publish_failed`, `/api/v1/health/realtime`, reconnect reports, and
comparison with authenticated HTTP state. If the same Redis deployment also
backs rate limiting, a broker outage is additionally the critical abuse-control
incident above.

### Contain

Keep durable writes available when the database is healthy. Tell users live
updates may be delayed and rely on authenticated HTTP reconciliation/reload.
Never replay a committed message/application because its hint failed. Do not
silently switch a multi-instance deployment to `REALTIME_BUS=memory` or set the
process-local production acknowledgement merely to clear the probe.

### Preserve

Keep event IDs/types, connection/reconnect times, release IDs, broker event IDs,
and the durable object ID. Realtime payloads are hints; do not add message text
or customer identity to make diagnosis easier.

### Recover

Restore the approved shared adapter/service, reconnect clients, and reconcile
from authenticated HTTP/database state. At-least-once redelivery must reuse the
event ID so each connection deduplicates it.

### Verify

Prove committed state during broker failure, reconnect, duplicate delivery,
instance switch, outage, and recovery. Confirm `/health/realtime` reports
cross-instance capability truthfully and never exposes a URL/credential.

### External gate

Only the process-local adapter exists in this repository; a real shared adapter
and cross-process outage/recovery proof remain REALTIME-001/003 external gates.

## Google OAuth or YouTube incident

### Detect

Distinguish verified Google login, incremental YouTube authorization, token
refresh/revocation failure, consent-screen configuration, and suspected client
credential exposure. A YouTube provider outage must not be declared a database
or whole-platform outage.

### Contain

For one user, the authenticated YouTube disconnect attempts Google revocation
and always clears local provider credentials/channel links, even when Google is
unavailable. For an application-client compromise, externally block new Google
exchange traffic if necessary, preserve existing verified subject bindings,
and begin the scoped credential-rotation procedure. Never link by caller-supplied
email/subject, reassign an existing provider subject, expose provider tokens to
the browser, or delete the stable identity row to hide the incident.

### Preserve

Keep OAuth connection-event IDs, provider subject/account row IDs, revocation
status, credential key ID (not key material), consent scope, release ID, and
provider event/request IDs. Never copy access/refresh tokens or OAuth keyrings.

### Recover

Correct consent/client configuration, rotate the affected client secret or
credential-encryption key through `docs/CREDENTIAL_ROTATION.md`, run a dry credential
audit, then exercise verified login and explicit YouTube reconnection in
staging. Retain previous decryption keys until every row is proven rewrapped.

### Verify

Test signature/issuer/audience/expiry/subject/verified-email enforcement,
provider collision refusal, incremental scope, server-only token handling,
bounded refresh/revocation, local invalidation during outage, and audit history.
An unrelated account and ordinary manual posting must remain available.

### External gate

Google consent configuration, live login/reconnect/refresh/revoke/outage, client
secret rotation, and hosted encrypted-only credential cutover are external.

## Closing an incident

Close only after containment is removed deliberately, the affected contract is
green, durable state is reconciled, alerts/probes are normal for an observation
window chosen from real operations, customer/support communication is complete,
and every temporary access/configuration change has an owner and removal time.

Within the incident record, separate:

- what happened and its customer/data scope;
- which control stopped it and at what UTC time;
- what was locally tested versus exercised in hosted infrastructure;
- follow-up ledger IDs, owners, and dates;
- whether legal/counsel notification review is required.

Never call a local tabletop, SQLite test, source assertion, or provider-neutral
runbook a completed production recovery drill.
