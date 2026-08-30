# CreatorJobs repository tabletop — 2026-08-31

This is a local, no-provider walkthrough of the incident decision paths. It was
performed against repository code and tests; no customer data, hosted service,
credential, DNS record, backup, traffic route, or provider was touched. `PASS`
means the first safe decision and application control are unambiguous locally.
It does not mean a human on-call team or live recovery drill passed.

## Review method

For each card, start only with the inject. Identify severity, the first action
that prevents more harm, evidence that must not be collected, the actual code or
operator control, a verification step, and the point where unavailable
infrastructure stops the exercise. A card fails if it requires a fictional
maintenance mode, unsafe migration downgrade, provider call from a health probe,
unattended AI retry, process-local production fallback, raw credential, or
customer content in telemetry.

## Decision cards

| ID | Class | Inject | First safe decision | Application control exercised | External stop | Result |
| --- | --- | --- | --- | --- | --- | --- |
| TT-01 | rollback | New backend release emits unhandled errors after migration 0070 is already current | Freeze promotion; compare old binary with current schema before routing back | sole-head release step, liveness/readiness split, tagged synthetics | immutable hosted rollback/traffic shift | PASS |
| TT-02 | rollback | Release migration exits while readiness is 503 but liveness is 200 | Keep instances out of traffic; preserve revision; forward-fix or isolated restore | `scripts.release_migrate`, Alembic heads/current | hosted clone/restore and traffic cutover | PASS |
| TT-03 | compromise | Customer reports a stolen session | Logout all when owner-controlled; otherwise audited admin suspension | durable family revocation plus canonical `account_block` | support identity proof/customer communication | PASS |
| TT-04 | compromise | Administrator factor/session is credibly stolen | Second operator demotes and revokes; then suspend after demotion if identity remains compromised | `scripts.grant_admin --revoke` transaction and audit | second-person/operator/provider drill | PASS |
| TT-05 | data_loss | Durable applications disappear after a database event | Freeze writes; restore to a new isolated target; never overwrite or replay requests blindly | readiness/revision/domain validation checklist | real backup, RPO/RTO, reconciliation, cutover | PASS |
| TT-06 | data_loss | Canonical avatar objects return missing while rows still reference them | Stop new media writes externally; preserve keys/rows; restore into quarantine | strict `MediaStorage` key/validation seam | object adapter/provider backup/orphan sweep | PASS |
| TT-07 | abuse | Shared limiter becomes unavailable during a cost-abuse burst | Do not fall back to process memory; stop AI work and narrowly route-block exposed writes | Redis-unavailable alert, invite gate, AI kill switch, audited suspension | real atomic Redis recovery proof | PASS |
| TT-08 | provider | SMTP rejects every request after customer mutations commit | Stop workers, keep outbox rows, never repeat domain mutations | durable leased outbox, delivery switch, suppression/idempotency | provider/DNS/process-supervision drill | PASS |
| TT-09 | provider | Model failures and spend spike during imports | Disable new provider work server-side; preserve private completed drafts | AI kill switch at both provider-start boundaries; no-provider sweeper | live provider/key/budget-alarm drill | PASS |
| TT-10 | provider | Realtime broker is unavailable after a message commits | Preserve writes and reconcile over authenticated HTTP; never replay the message | post-commit hint failure isolation and event dedupe | real shared adapter/instance-switch drill | PASS |
| TT-11 | provider | Google revocation is unavailable for one connected user | Clear local authority regardless of remote outcome; retain verified identity binding | authenticated disconnect and connection audit | live Google revoke/reconnect/outage | PASS |

## Findings

One concrete local gap was found and repaired: the sanctioned administrator
role-revocation command changed `account_type` but left durable sessions and
refresh credentials active. Privileged authorization would stop because role
checks read current database state, but a stolen browser would remain an
authenticated ordinary user. The command now locks the account, demotes it,
revokes all session families/credentials, and writes a bounded actor-less audit
event atomically. Focused tests cover both revoke and grant audit behavior.

The walkthrough also confirmed intentional limits rather than hiding them:

- there is no production maintenance/read-only switch;
- no hosted backup/PITR or media restore has run;
- the Redis limiter lacks real atomic contention proof;
- no shared realtime adapter exists;
- the shared email-delivery gate stops real authentication and notification sends
  only after the worker is restarted with the new configuration;
- the AI sweep never calls the provider;
- Google/provider revocation and credential rotations remain external;
- liveness, mandatory readiness, and optional feature health stay separate.

## Local exit criteria

The repository tabletop is complete when the incident runbook contract test,
the administrator containment tests, alert-policy tests, health contracts, auth
session/suspension tests, email worker tests, AI kill-switch tests, realtime
degraded tests, media storage/validation tests, and release-migration tests pass.
Phase 12 certification must record exact counts; hosted exercises remain
`BLOCKED_EXTERNAL` and cannot be promoted by this document.
