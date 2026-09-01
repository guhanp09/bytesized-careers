# CreatorJobs operational alerts and synthetic journeys

This is the provider-neutral operations contract. CreatorJobs emits bounded JSON
events to structured stdout; `backend/app/core/operational_alerts.py` decides
which of those events require an operator; and
`backend/scripts/evaluate_operational_alerts.py` is the executable consumer.

This is not a claim that Render, Vercel, or another log provider is connected.
Production log ingestion, retention, notification routing, and a delivered test
page remain external release gates. The local contract exists so those provider
queries do not have to invent different meanings for the same event.

## Evaluate a captured batch

From `backend/`:

```bash
.venv/bin/python -m scripts.evaluate_operational_alerts < captured-logs.jsonl
```

The command writes at most one static `alert_event` per alert key in the input
batch. It exits `2` if it selected any alert and `0` otherwise. Invalid and
unrelated lines are ignored and never echoed. Output contains no request ID,
route, exception message, customer identifier, provider response, URL, job or
message content.

The batch is the deduplication window. A production log system should apply the
same finite keys over its own window and preserve the original sanitized record
for diagnosis. Numeric traffic, latency, and capacity thresholds are deliberately
not guessed before production traffic or an infrastructure plan exists.

## Alert inventory

| Key | Severity | Producer | First operator question |
| --- | --- | --- | --- |
| `backend_unhandled_exception` | high | backend `error_event` | Which safe traceback coordinate and request correlation failed? |
| `browser_client_exception` | medium | browser `error_event` | Is it grouped to one release/digest or broad across the current release? |
| `database_unavailable` | critical | `database.probe` | Is the process alive but not ready, and is the database reachable? |
| `rate_limit_backend_unavailable` | critical | `redis.rate_limit` | Is the shared abuse-control backend down or misconfigured? |
| `email_worker_failed` | high | `email.worker_pass` | Is the worker still looping, and are leases becoming eligible again? |
| `email_delivery_failed` | high | `email.delivery` | Which terminal outbox rows need provider/support investigation? |
| `email_enqueue_failed` | high | `notification_email_queue_failed` | Which committed event lost its requested email intent? |
| `realtime_publish_failed` | medium | `realtime.publish` | Is durable HTTP state available while cross-instance hints are degraded? |
| `ai_provider_failed` | medium | `ai.provider_call` | Is the provider/configuration unhealthy, and should the kill switch be used? |
| `job_import_sweeper_failed` | high | `job_import_sweep_failed` | Are expired import leases still being settled truthfully? |

Successful requests, ordinary 4xx responses, rate-limit rejections, retryable
email attempts, suppressed email, and cancelled AI calls do not alert. Those are
normal or already-bounded states, not incidents.

## Backend unhandled exception

1. Find the original sanitized `error_event`; use its request UUID to correlate
   nearby logs without copying customer input into the incident record.
2. Resolve private source maps by the event's immutable release when the failure
   came from the browser; use safe backend frame coordinates for backend errors.
3. Reproduce the matched route contract with non-customer fixtures. Do not paste
   message bodies, AI source text, credentials, or authorization headers into a
   ticket.
4. Roll back only when the failing release is causal and the rollback path is
   known; otherwise contain the affected feature.

## Browser client exception

1. Group the original sanitized events by release, digest, boundary, and static
   chunk coordinate in the log platform. Do not add page URLs or account IDs.
2. Confirm whether the current release introduced the cluster and whether the
   same journey fails in `npm run test:e2e:synthetics`.
3. Retrieve the access-controlled source-map artifact for that exact release.
   Never serve or attach it publicly.

## Database unavailable

Set a shell-local origin that contains no credential, then ask the two separate
questions the application exposes:

```bash
CREATORJOBS_BACKEND_ORIGIN=https://api.example.invalid
curl -fsS "$CREATORJOBS_BACKEND_ORIGIN/api/v1/health"
curl -fsS "$CREATORJOBS_BACKEND_ORIGIN/api/v1/health/ready"
```

Liveness may stay `ok` while readiness returns `503`; that is correct. Do not
turn the liveness probe into a database check and create a restart loop. Check
provider status, connection saturation, migration state, and recent releases.
Do not run a downgrade, reset, or hosted restore until the data-recovery runbook
and an approved recovery target exist.

## Rate-limit backend unavailable

1. Treat this as a security-control outage, not only a latency incident.
2. Confirm the configured backend and trusted-proxy contract without printing
   the Redis URL or credentials. `python -m scripts.print_config_contract`
   prints names and enforcement only; it deliberately reads no values.
3. Inspect the original bounded event and Redis service health. Do not switch to
   process-local production limiting to make the alert disappear.
4. The repository proves atomic real-Redis contention, expiry, outage and
   recovery on loopback. Keep the affected write surface closed until the
   configured managed service is healthy; local proof does not prove hosted
   failover, credentials or alert delivery.

## Email worker failed

1. Confirm the standalone worker process is running and continues another pass;
   one bad pass must not terminate its loop.
2. Inspect failed/queued rows through the administrator email-outbox surface.
   Do not log recipient addresses or message bodies in the incident channel.
3. Check whether expired leases become claimable and whether provider calls are
   timing out. Restart only after confirming the lease makes replay safe.

## Email delivery failed

1. Filter the administrator email outbox to terminal `failed` rows and compare
   their event categories, attempt counts, and provider state.
2. Check suppression/bounce state before retrying. Never resend a complaint or
   hard-bounced address merely to clear a queue.
3. Authentication email has different suppression semantics from optional mail;
   preserve that distinction during recovery.

## Email enqueue failed

1. Locate the static `notification_email_queue_failed` record and the associated
   committed domain event through the audit trail, without copying its payload.
2. The in-app transaction may already be durable. Repair or enqueue a missing
   email only through an idempotent, audited operator action; do not rerun the
   customer mutation.

## Realtime publish failed

1. Verify `GET /api/v1/health/realtime` reports the configured topology without
   exposing its URL or credential.
2. Confirm the same message/application state reads back over authenticated HTTP.
   Realtime is a hint; the database is the record.
3. If cross-instance delivery is degraded, communicate delayed live updates and
   preserve writes. Do not fail or replay a committed message solely because its
   hint was lost.

## AI provider failed

1. Check `GET /api/v1/health/job-import` for configuration readiness; the probe
   makes no paid provider call.
2. Inspect provider availability, bounded attempt count, queue/sweeper health,
   and current cost controls without logging source text or prompts.
3. If failures are sustained or safety/cost is uncertain, set the server-side
   `JOB_IMPORT_ENABLED=false` kill switch through the approved configuration
   path. Existing drafts stay private and ordinary Post Job remains available.
4. Re-enable only after the deterministic evaluation suite and a provider boot
   check pass. Never auto-publish an imported draft.

## Job-import sweeper failed

1. Confirm the standalone `python -m app.services.job_import_sweeper` process is
   running and its next pass occurs.
2. Inspect expired processing leases and terminal attempt counts. The sweeper
   settles abandoned work; it must never call the model or spend money.
3. The server kill switch may remain off while the sweeper runs. Do not retry a
   provider call unattended on behalf of a recruiter.

## Local, no-cost synthetic journeys

Run from the repository root:

```bash
npm run test:e2e:synthetics
```

This is a tagged subset of the existing real-backend QA suite. It starts the
same disposable `qa-playwright` SQLite database, the same test-only controller,
and the same canonical scenario/restore system as `npm run test:e2e:qa`. It does
not create a second fixture corpus and it never calls a live or paid provider.

| Journey tag | Existing executed contract |
| --- | --- |
| `@synthetic:auth` | controller login, persisted persona switch, and return without re-login |
| `@synthetic:browse` | authoritative Jobs search, Jobs→Talent switch, query preservation, and clear |
| `@synthetic:publish` | deterministic private draft, explicit publish, and public candidate rendering |
| `@synthetic:apply` | real requirement controls, application submission, and persisted answers |
| `@synthetic:message` | authenticated message send plus proof that messaging does not mutate lifecycle state |
| `@synthetic:admin` | warned moderator switch followed by authorized administrator access |

The full QA suite also executes these tests, so CI does not run a duplicate
second harness. The subset is the bounded operational entry point for a local or
isolated staging check.

## External gates before customers

The following are not proven by this repository-only phase:

- a production log drain receiving API, email-worker, and import-sweeper JSON;
- retention, access control, query grouping, and private source-map access;
- a real alert destination receiving and acknowledging each severity;
- absence-of-signal/process-death monitoring for standalone workers;
- scheduled synthetics against an isolated staging cohort and data set;
- evidence-based traffic/latency/capacity thresholds;
- a 72-hour staging soak with incident review.

Keep those gates `BLOCKED_EXTERNAL` until they are exercised. Local tests and a
provider-neutral policy are not evidence that a page reached a human.
