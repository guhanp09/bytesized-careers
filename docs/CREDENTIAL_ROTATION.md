# CreatorJobs credential inventory and rotation

This is the application-side rotation contract for the invite-only beta. It
contains no credential values and is not evidence that Google, OpenAI, SMTP,
PostgreSQL, Redis, object storage, Vercel, Render, or GitHub accepted a real
rotation. Live/provider exercises remain `BLOCKED_EXTERNAL` until an approved
staging or production drill records them.

Use `backend/app/core/config_contract.py` and
`python -m scripts.print_config_contract` to inspect configuration names and
enforcement without printing values. Never paste a secret manager export,
database URL, cookie, provider token, keyring JSON, TOTP seed, or private source
map into a terminal transcript, ticket, or this document.

## Rotation rules

1. Decide whether the change is **planned maintenance** or **compromise
   containment**. Overlap is useful only for planned maintenance. Never keep a
   credibly compromised value in a `*_PREVIOUS_SECRET` setting.
2. Name one operator and one approver. Record UTC start/end, environment,
   immutable release IDs, configuration version IDs, provider credential IDs,
   and bounded row counts—not values.
3. Prove the new credential at the narrowest consumer before retiring the old
   one. A green liveness probe is not proof that auth, email, AI, or a worker can
   use its credential.
4. Restart every long-lived process that reads settings at startup. In
   particular, the email worker chooses its provider once when it starts.
5. Remove overlap only after every producer uses the new primary and the
   maximum in-flight/replay window has elapsed. Re-run the old-credential
   rejection check after removal.
6. Re-encryption is not revocation. If plaintext TOTP seeds or Google refresh
   grants may have been exposed, rotating an AES wrapping key cannot make an
   attacker forget them; disable/re-enroll factors or revoke/reconnect grants.
7. Stop if a dry run cannot decrypt one row. Restore the missing old key to the
   isolated rotation process; never delete or overwrite the row to make the
   count reach zero.

## Complete credential registry

The declaration/enforcement/consumer column is deliberately executable: every
entry names where the value enters, which boundary refuses misuse, and what
actually consumes it.

| ID | Credential / setting | Authority | Declaration → enforcement → consumer | Rotation mode | Local evidence | External gate |
| --- | --- | --- | --- | --- | --- | --- |
| CR-01 | `NEXTAUTH_SECRET` | CreatorJobs | `next.config.ts` production validation → Auth.js JWT encryption/signing → `lib/auth.ts` and strong-auth proxy `getToken` | Single-secret; planned change logs out browser sessions | production-config import rejects absent/short values | Hosted session/logout observation |
| CR-02 | `JWT_SECRET` | CreatorJobs | backend `Settings`/boot validation → `app.core.security` signing and verification → auth dependencies/services | Single-secret; old access JWTs fail, persistent opaque refresh families can mint new JWTs | auth token/security suite | Coordinated backend restart and real-session observation |
| CR-03 | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google | frontend/backend production validation → Google OIDC/refresh/revoke clients → `lib/auth.ts`, identity verifier, refresh/revocation services | Provider-issued overlap if Google permits; both services then old credential revoked | configuration, verified-identity, refresh/revoke tests | Google console rotation and live login/refresh/revoke |
| CR-04 | `GOOGLE_OAUTH_EXCHANGE_SECRET`, `GOOGLE_OAUTH_EXCHANGE_PREVIOUS_SECRET` | CreatorJobs | frontend/backend config → constant-time current/previous verification → credential-bearing `/auth/oauth/google` exchange | Planned two-service overlap; emergency rotation uses current only | old/current/retired HTTP regression and frontend production validation | Two-service staging deploy |
| CR-05 | `OAUTH_CREDENTIAL_KEYS`, `OAUTH_CREDENTIAL_ACTIVE_KEY_ID` and stored Google grants | CreatorJobs + Google | backend config → AES-GCM envelope/key ID → `OAuthCredentialStorage`; `rotate_oauth_credentials` audits/rewraps | Multi-key expand, rewrap, verify zero, retire; revoke grants if exposure is possible | bounded dry-run/apply/idempotency/missing-key tests | Hosted backfill plus live Google reconnect |
| CR-06 | `STRONG_AUTH_SECRET_KEYS`, `STRONG_AUTH_SECRET_ACTIVE_KEY_ID` | CreatorJobs | backend config → domain-separated AES-GCM envelope → `StrongAuthService`; `rotate_strong_auth_secrets` audits/rewraps | Multi-key expand, rewrap, verify zero, retire; re-enroll if seed exposure is possible | bounded dry-run/apply/idempotency/missing-key tests | Staging factor challenge and physical-device drill |
| CR-07 | backend/frontend `DATABASE_URL` | Database provider | backend boot contract / Prisma server config → TLS/provider authentication → SQLAlchemy session pool and local repository | Prefer new database principal/password overlap, restart consumers, revoke old | disposable SQLite/PostgreSQL migration and readiness tests only | Managed database credential rotation and pool drain |
| CR-08 | `REDIS_URL` | Redis provider | backend config/boot choice → Redis client connection → shared rate limiter | Provider credential overlap where supported, restart API, then revoke old | mocked unavailable/recovery and rate-limit tests | Real Redis atomic contention and credential cutover |
| CR-09 | `SMTP_USERNAME`, `SMTP_PASSWORD` | Email provider | backend production validation → TLS SMTP login → standalone email worker/provider | Provider credential overlap, restart worker, approved real send, revoke old | deterministic mock/provider/outbox tests | Provider/DNS credential rotation and delivery proof |
| CR-10 | `EMAIL_WEBHOOK_SECRET`, `EMAIL_WEBHOOK_PREVIOUS_SECRET` | CreatorJobs + email provider | backend config → timestamp/body HMAC current/previous check → delivery webhook suppression writes | Planned overlap for one freshness window; emergency uses current only | old/current/retired HTTP regression | Provider webhook-secret cutover and signed delivery event |
| CR-11 | `UNSUBSCRIBE_TOKEN_SECRET` | CreatorJobs | backend config → category-scoped HMAC → issue/read unsubscribe service and POST endpoint | Single-secret; changing it invalidates already-issued non-expiring links | forge/scope/no-expiry endpoint tests | No routine rotation after links ship until a versioned keyring exists; emergency invalidation is explicit |
| CR-12 | `OPENAI_API_KEY` | OpenAI | backend config/feature health → allowlisted bounded adapter → queue-backed AI import provider call | Provider key overlap, restart provider consumers, revoke old; `JOB_IMPORT_ENABLED=false` remains in force during an incident | missing-key/kill-switch/budget/provider adapter suites | Live provider key, availability, spend and data-control exercise |
| CR-13 | `YOUTUBE_API_KEY`, `YOUTUBE_DATA_API_KEY` | Google | backend/frontend server-only config → exact Google API clients → channel/organization enrichment | Provider key overlap/restriction update, deploy consumers, revoke old | missing-key fallback and bounded-fetch tests | Google console restriction and live lookup |
| CR-14 | `GOOGLE_PLACES_API_KEY` | Google | Next server-only route config → bounded Google Places requests → location autocomplete/details | Provider key overlap/restriction update, deploy frontend, revoke old | missing-key and route tests | Google console restriction and live lookup |
| CR-15 | `EMAIL_WEBHOOK_SECRET` provider copy and OAuth/provider tokens | External principals | provider dashboards issue → application signature/token boundaries → email/Google consumers | Revoke at authority; local deletion alone is not remote revocation | outage/local-invalidation tests | Real provider revocation evidence |
| CR-16 | `GITHUB_TOKEN`, registry/deployment credentials, source-map artifact access | GitHub/hosting platform | CI/host secret store → workflow/platform permissions → security/release jobs and artifact store | Platform-specific replacement with least privilege; never application env | workflow structure and secret-scan tests | Authenticated repository/protection and deployment drill |
| CR-17 | future object-storage access keys | Storage provider | No production adapter or credential declaration exists yet → none → none | Cannot rotate a credential that has not been selected | media adapter/validation tests only | MEDIA-001/OPS-002 provider selection, least privilege and restore |
| CR-18 | passwords, refresh credentials, recovery codes, invitations, verification/reset tokens | User / CreatorJobs random generation | request/service generation → Argon2/hash/one-time/expiry checks → auth/invite/session workflows | User reset, one-time consumption, automatic refresh rotation or revocation; never deployment-secret rotation | auth/session/invite/recovery suites | Support identity proof and live compromise drill |

## Procedure A — OAuth credential wrapping key

This preserves stored Google grants during a planned encryption-key change.
Run from `backend/` with the ordinary environment configuration; do not put a
keyring on the command line.

1. Add a new random 32-byte key under a new stable key ID while retaining every
   old key. Set `OAUTH_CREDENTIAL_ACTIVE_KEY_ID` to the new ID and keep
   `OAUTH_CREDENTIAL_WRITE_MODE=encrypted_only`.
2. Deploy/restart the backend so new writes use the new key.
3. Run the read-only audit:

   ```bash
   .venv/bin/python -m scripts.rotate_oauth_credentials
   ```

4. On an approved isolated/staging target, apply bounded batches:

   ```bash
   .venv/bin/python -m scripts.rotate_oauth_credentials --apply --confirm staging
   ```

5. Re-run the dry audit. Retire an old key only when every row decrypts and
   `rows_needing_rewrap` is zero. Exercise refresh and disconnect before and
   after retirement.

If the wrapping key and ciphertext may both have escaped, rewrap for storage
hygiene **and** revoke/reconnect the affected Google grants. Rewrap alone is not
containment.

## Procedure B — strong-auth TOTP wrapping key

1. Add a new random 32-byte key while retaining old keys. Point
   `STRONG_AUTH_SECRET_ACTIVE_KEY_ID` at the new ID and restart the backend.
2. Run the read-only authenticated-decryption audit:

   ```bash
   .venv/bin/python -m scripts.rotate_strong_auth_secrets
   ```

3. On an approved isolated/staging target, apply bounded row locks/commits:

   ```bash
   .venv/bin/python -m scripts.rotate_strong_auth_secrets --apply --confirm staging
   ```

4. Re-run dry mode; require zero rows needing rewrap. Complete one enrolled
   factor challenge and one recovery-code flow, then remove the retired key and
   repeat the challenge.

If a decrypted seed may have escaped, disable that factor, revoke its other
sessions, and enroll a new seed. Re-encrypting the same seed does not recover it.

## Procedure C — Google credential-authority exchange secret

Planned rotation across independently deployed backend and frontend:

1. Generate the new primary in the secret manager.
2. Deploy backend with current=new and previous=old. The backend requires the
   current value and accepts previous only at the credential-bearing exchange.
3. Prove old still works in isolated staging, then deploy frontend
   `GOOGLE_OAUTH_EXCHANGE_SECRET=new` and prove a YouTube-scope authorization.
4. Remove backend previous, redeploy, and prove old is rejected while new works.

For credible compromise, do not configure previous. Deploy the backend current
first (old requests fail closed), immediately deploy the frontend current, and
investigate the server boundary that exposed it.

## Procedure D — email delivery webhook secret

For planned rotation, deploy the backend with current=new and previous=old,
change the provider to sign with new, verify one approved signed event, wait at
least the five-minute signature freshness window, then remove previous and prove
an old signature is rejected. For compromise, omit previous and coordinate the
provider/application cutover as a security incident.

## Procedure E — single-secret and provider credentials

- `NEXTAUTH_SECRET`: a planned change invalidates browser sessions. Announce the
  login boundary, deploy the new value, verify old cookies fail and a fresh
  Google/password login works. If actual session material may be stolen, use
  logout-all or audited suspension for affected accounts as well.
- `JWT_SECRET`: deploy the new backend value; old access JWTs must fail while an
  uncompromised persistent refresh family obtains a newly signed access token.
  A refresh credential is opaque and database-revocable; it is not signed by
  this secret.
- `GOOGLE_CLIENT_SECRET`, database, Redis, SMTP, OpenAI, YouTube, Places, CI,
  hosting, and future storage credentials are provider-authority rotations.
  Prefer provider overlap, prove the narrow consumer, then revoke old. If a
  provider cannot overlap, schedule a fail-closed cutover and record the
  customer impact rather than configuring a plaintext fallback.
- `UNSUBSCRIBE_TOKEN_SECRET`: no current outbound template embeds these links.
  Before links ship, either retain the value or add a versioned keyring. Once
  non-expiring links exist, routine single-secret rotation silently breaks a
  promise in old mail; emergency compromise may justify that invalidation and
  must be recorded.

## Local rehearsal evidence and exit

Local completion requires all of the following without live values:

- OAuth stored-grant dry-run/apply/idempotency and missing-old-key refusal;
- strong-auth factor dry-run/apply/idempotency, bounded batches, and
  missing-old-key refusal;
- Google exchange old/current/retired behavior plus production frontend
  requirement for the server-only current secret;
- email webhook old/current/retired behavior and freshness/replay checks;
- configuration registry completeness and secret-redaction checks;
- this inventory's declaration/enforcement/consumer contract test.

Live Google/provider rotation, managed database/Redis/SMTP changes, physical
factor challenge, hosted session observation, CI/hosting permission review, and
object-storage credentials remain `BLOCKED_EXTERNAL`. Do not mark them complete
from the local rehearsal.
