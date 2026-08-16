# CreatorJobs Production Readiness Execution Ledger

This ledger translates the production-readiness audit into resumable implementation work. It does not replace the audit or define new product scope. Update a row only when its status changes, and add the resolving commit only after the required tests pass.

## Ledger contract

- Source baseline: `2b616e1f239ffa5c0129be1da1b1324197d68650`
- Working branch: `integration/import-and-messaging-2026-07-30`
- Launch target: invite-only, free, India-first beta with AI Job Import retained and made production-safe.
- Allowed statuses: `NOT_STARTED`, `IN_PROGRESS`, `IMPLEMENTED`, `VALIDATED`, `BLOCKED_EXTERNAL`, `DEFERRED_WITH_RATIONALE`.
- `VALIDATED` means the implementation and its required tests passed. Existing code alone is not validation.
- `Migration`: `YES` means a database migration is expected; `POSSIBLE` means implementation inspection must decide before work begins.
- `Infra`: `YES` means production infrastructure or credentials are eventually required, even when a local adapter can validate application behavior.
- The checkpoint commit containing this file is recorded symbolically because a tracked file cannot contain its own commit hash. Resolve it with `git log --oneline -- docs/PRODUCTION_READINESS_EXECUTION.md`.

## Phase 0 — Baseline and preservation

| ID | Severity | Subsystem | Dependencies | Status | Tests required | Migration | Infra | Blocks beta | Blocks unrestricted | Resolving commit |
|---|---|---|---|---|---|---|---|---|---|---|
| BASE-001 | CRITICAL | Git/recovery | None | VALIDATED | Branch, worktree, ref, ancestry, and `git fsck` checks | NO | NO | Yes | Yes | Phase 0 checkpoint commit |
| BASE-002 | CRITICAL | Test baseline | BASE-001 | VALIDATED | Frontend, backend, migrations, builds, browser suites, lint, audits | NO | NO | Yes | Yes | Phase 0 checkpoint commit |
| BASE-003 | HIGH | Execution ledger/handoff | BASE-001, BASE-002 | VALIDATED | Document review and `git diff --check` | NO | NO | Yes | Yes | Phase 0 checkpoint commit |
| BASE-004 | HIGH | Remote/release truth | BASE-001 | BLOCKED_EXTERNAL | Authenticated fetch; remote branch and protection inspection | NO | YES | Yes | Yes | — |

## Phase 1 — Critical authentication and identity security

| ID | Severity | Subsystem | Dependencies | Status | Tests required | Migration | Infra | Blocks beta | Blocks unrestricted | Resolving commit |
|---|---|---|---|---|---|---|---|---|---|---|
| AUTH-001 | CRITICAL | Google authentication | BASE-003 | VALIDATED | Forged token, signature, issuer, audience, expiry, subject, verified-email tests | NO | YES | Yes | Yes | Phase 1A Google identity checkpoint commit |
| AUTH-002 | CRITICAL | OAuth account linkage | AUTH-001 | VALIDATED | Existing-subject and existing-email collision; no reassignment; concurrent link tests | YES | NO | Yes | Yes | Phase 1A sequential checks + Phase 1C PostgreSQL uniqueness/concurrency checkpoint |
| AUTH-003 | CRITICAL | Browser session privacy | AUTH-001 | VALIDATED | `/api/auth/session` and serialized-session leakage tests | NO | NO | Yes | Yes | Phase 1B browser-session privacy checkpoint commit |
| AUTH-004 | HIGH | Provider credentials | AUTH-003 | BLOCKED_EXTERNAL | Encryption, key rotation, redaction, hosted backfill/clear, refresh, and provider revocation tests | YES | YES | Yes | Yes | Phase 1B removed browser/JWT copies; Phase 1C-2 locally validates rotation-ready AES-256-GCM storage and migration 0055; Phase 1E adds fixed-endpoint bounded refresh/revocation, unconditional local invalidation, legacy non-feature credential cleanup, audit history, outage recovery, and redaction tests; hosted backfill/encrypted-only cutover and live Google revoke/refresh drills remain external |
| AUTH-005 | CRITICAL | Backend sessions | AUTH-001 | VALIDATED | Rotation, replay, expiry, concurrent refresh, and migration-compatibility tests | YES | NO | Yes | Yes | Phase 1C-3 persistent rotating session checkpoint commit |
| AUTH-006 | CRITICAL | Session revocation | AUTH-005 | VALIDATED | Logout, logout-all, password reset, suspension, credential-change tests | YES | NO | Yes | Yes | Phase 1C-4 validates authoritative `sid` access checks, current/all-device logout, and revocation/refresh concurrency; Phase 1C-5 validates atomic password-reset and administrator-suspension revocation, rollback, reset/login/request races, and permanent credential invalidation |
| AUTH-007 | HIGH | Browser/backend boundary | AUTH-005 | IN_PROGRESS | Cookie, CSRF/origin, server-only credential, and API compatibility tests | POSSIBLE | NO | Yes | Yes | Phase 1B moved YouTube credentials behind an authenticated same-origin route; Phase 1C-3 keeps rotating refresh credentials in the encrypted NextAuth JWT; Phase 1C-4 revokes through NextAuth's same-origin server event without serializing refresh credentials; Phase 1D-3 adds a same-origin, size-bounded, cross-site-rejecting administrator factor proxy and keeps short-lived Google reauthentication material out of the browser Session API; Phase 1E adds server-only feature-credential exchange plus cross-origin and QA rejection for YouTube refresh/disconnect; Phase 2J closes the HTTP boundary work with an enforcing nonce-based content security policy, so only the general browser access bearer remains |
| AUTH-008 | CRITICAL | Admin authentication | AUTH-005 | VALIDATED | MFA enrollment/challenge/recovery, database-backed elevation, expiry, logout, and privilege-boundary tests | YES | YES | Yes | Yes | Phase 1D-1 adds migration 0057, a global database-backed assurance gate, policy-bounded expiry, forged-claim rejection, safe logout escape paths, and fail-closed production configuration; Phase 1D-2 adds migration 0058 plus encrypted TOTP enrollment, replay-safe challenge, hash-only one-time recovery, persistent lockout, factor-change session revocation, cache-safe responses, and PostgreSQL concurrency coverage; Phase 1D-3 adds the fail-closed production browser boundary, password/Google primary reauthentication, enrollment/challenge/recovery/rotation/disable UX, server-only provider proof, one-time recovery display, and focused browser privilege/revocation validation |
| AUTH-009 | HIGH | Google/YouTube scopes | AUTH-001, AUTH-003 | BLOCKED_EXTERNAL | Basic login without YouTube; incremental consent; access-token binding; reconnect/refresh/revoke/outage tests; live provider drill | YES | YES | Yes | Yes | Phase 1E locally validates identity-only login, explicit incremental offline YouTube consent, signed OIDC `at_hash` binding, server-only exchange authorization, authoritative channel reconciliation, bounded refresh, one-retry recovery, remote revoke plus unconditional local clearing, and migration 0059 audit history; a live Google consent/reconnect/refresh/revoke/outage drill and consent-screen configuration remain external |
| AUTH-010 | HIGH | Auth abuse controls | AUTH-001, AUTH-005 | IN_PROGRESS | OAuth and refresh throttling, enumeration, and audit tests | NO | YES | Yes | Yes | Phase 1D-2 adds bounded route limits plus a durable five-attempt/15-minute administrator factor lockout and failure audits; Phase 3 Redis-atomic enforcement, trusted-client identity, and remaining auth endpoint coverage remain |

## Phase 2 — Core web security boundaries

Locally complete and certified. Every row below is `VALIDATED`; the certification totals are recorded in the handoff under "Phase 2 certification (local)". The PostgreSQL migration harness was not re-run at certification because Docker is unavailable in the working environment and Phase 2 introduced no migration — that is an environment limitation and not a passing result.

| ID | Severity | Subsystem | Dependencies | Status | Tests required | Migration | Infra | Blocks beta | Blocks unrestricted | Resolving commit |
|---|---|---|---|---|---|---|---|---|---|---|
| WEB-001 | CRITICAL | Shared outbound fetch | AUTH-005 | VALIDATED | IPv4/IPv6 private, reserved, metadata, port, proxy, timeout, size, type tests | NO | NO | Yes | Yes | Phase 2A shared outbound-fetch checkpoint: 72 primitive security tests, 327 dependent tests, and complete backend suite green |
| WEB-002 | CRITICAL | Redirect/DNS SSRF | WEB-001 | VALIDATED | Per-hop validation and DNS-rebinding/peer-verification tests | NO | NO | Yes | Yes | Phase 2A pins TCP to each validated DNS answer while retaining original TLS identity, verifies the peer, and creates a fresh cookie-free pool per redirect; escape/rebinding tests green |
| WEB-003 | CRITICAL | Organization identity fetch | WEB-001, WEB-002 | VALIDATED | Authentication, quotas, redirect and bounded-stream integration tests | NO | NO | Yes | Yes | Phase 2C moves backend hiring-identity verification (OF-005) onto the shared boundary with a per-hop platform allowlist predicate; Phase 2D-1 closes the anonymous resolver surface behind an authenticated same-origin session; Phase 2D-2 moves the organization page read to an authenticated backend endpoint on the shared boundary returning only bounded structured fields; Phase 2D-3 removes the last Next-runtime page fetch by resolving YouTube custom paths through that endpoint. Distributed per-user quotas remain Phase 3 (RATE-003) |
| WEB-004 | CRITICAL | Import/preview fetches | WEB-001, WEB-002 | VALIDATED | AI URL import, link preview, oEmbed, and enrichment integration tests | NO | NO | Yes | Yes | Phase 2A migrates job import/brand enrichment; Phase 2B migrates authenticated portfolio HTML and exact-provider redirect-free oEmbed, bounds each metadata field read from an untrusted page, and keeps the manual-entry fallback, with 29 focused link-preview cases, a 175-case dependent matrix, and full backend/frontend gates green |
| WEB-005 | HIGH | Internal redirects | AUTH-001 | VALIDATED | External, protocol-relative, slash, backslash, control and encoded-scheme tests | NO | NO | Yes | Yes | Phase 2F adds one canonical `lib/safeRedirect.safeInternalPath`, fixes a live open redirect where the sign-in page pushed an attacker-controlled `?next=` after successful authentication, and covers external, protocol-relative, backslash, encoded-separator, userinfo, control-character, malformed, traversal and legitimate-route cases in nine suites; every other redirect target in the tree is a literal |
| WEB-006 | CRITICAL | User-supplied URLs | BASE-003 | VALIDATED | Portfolio, profile, media, social, application, interview malicious URL tests | POSSIBLE | NO | Yes | Yes | Phase 2G adds canonical `app.core.external_url`, routes the existing `_is_http_url` chokepoint through it, and adds schema enforcement for the portfolio/profile URL fields that had none, with 36 focused cases; Phase 2H adds `lib/externalHref.safeExternalHref` at all seven render sinks so a legacy row holding an executable scheme renders inert instead of navigating, with five cases including a sink-coverage guard. Storage, render and fetch remain three separate contracts and no legacy row was rewritten |
| WEB-007 | CRITICAL | Structured data | BASE-003 | VALIDATED | `</script>`, angle, ampersand, U+2028/U+2029 JSON-LD tests | NO | NO | Yes | Yes | Phase 2E adds `lib/jsonLd.serializeJsonLd`, applies it to every inline structured-data block on the public job and talent pages, and covers tag-breakout, entity, separator, round-trip and call-site coverage in five cases |
| WEB-008 | HIGH | HTTP boundaries | WEB-005, WEB-007 | VALIDATED | CSP, Trusted Host, CORS, COOP/CORP and production header tests | NO | YES | Yes | Yes | Phase 2I adds `frame-ancestors 'none'`, COOP `same-origin-allow-popups` and CORP `same-origin` on top of the existing nosniff/Referrer-Policy/Permissions-Policy/HSTS baseline; Phase 2J adds the complete policy — `script-src 'self' 'nonce-<per-request>' 'strict-dynamic'` issued by `proxy.ts` from `lib/contentSecurityPolicy.ts`, plus `default-src`/`base-uri`/`object-src`/`form-action`/`frame-src`/`font-src`/`style-src`/`img-src`/`connect-src` — with 22 policy contract cases and a six-case browser suite that proves the framework's scripts run, an unauthorized inline script does not, and no surface reports a violation. Trusted Host and CORS remain backend concerns owned by PLATFORM-002; HSTS preload eligibility remains BLOCKED_EXTERNAL |

## Phase 3 — Dependencies, rate limiting, and request safety

| ID | Severity | Subsystem | Dependencies | Status | Tests required | Migration | Infra | Blocks beta | Blocks unrestricted | Resolving commit |
|---|---|---|---|---|---|---|---|---|---|---|
| DEP-001 | CRITICAL | Frontend dependencies | BASE-003 | VALIDATED | Focused framework/auth tests, full frontend suites, production audit | NO | NO | Yes | Yes | Phase 3B upgrades `next-auth` 4.24.14 → 4.24.15, clearing the critical homoglyph-normalizer advisory, the `getToken()` malformed-Bearer crash the administrator strong-auth route is exposed to, the unbound OAuth state/nonce/PKCE cookie advisory, and the transitive `uuid` bounds-check advisory. Phase 3C upgrades `next` 16.2.6 → 16.3.1, which is the first version pinning patched `postcss` and `sharp` — `16.2.11`/`16.2.12` silence the nine direct `next` advisories but keep shipping vulnerable transitives. Production findings 6 → 0 |
| DEP-002 | CRITICAL | Backend dependencies | AUTH-005 | VALIDATED | Auth/crypto tests, full backend suite, production-only audit | NO | NO | Yes | Yes | Inventory established and banked in the handoff under "DEP-002 Python vulnerability inventory": 9 production-reachable packages carry advisories, worst being `starlette` (10 issues incl. missing Host-header validation and StaticFiles UNC SSRF, needs a major bump behind FastAPI) and `cryptography` (8 issues, only partially fixable inside the declared `<47.0.0` pin). Phase 3D resolves the blocker: the production image now installs from the committed lock (it previously re-resolved `pyproject.toml` every build, so lock-recorded fixes would never have shipped), and `uv` proved obtainable in an isolated scratch venv. Phase 3E closes 16 advisories across six packages the lock could fix without a manifest edit (click, idna, mako, pyasn1, pydantic-settings, python-dotenv), taking the production set from 9 vulnerable packages to 3. Phase 3F raises cryptography 46.0.5 → 50.0.0, closing all 11 of its advisories including the PKCS#7 Bleichenbacher oracle, two X.509 escapes and the vulnerable bundled OpenSSL; the `<47.0.0` pin was a conservative guard from the OAuth-encryption commit with nothing downstream depending on it, and this codebase uses only `AESGCM`/`InvalidTag`. Phase 3G takes ecdsa to 0.19.2 and closes its DER-length denial of service; the surviving Minerva timing attack has no fix and none planned upstream, so it is classified NOT_REACHABLE_WITH_EVIDENCE and made structurally unreachable by narrowing `jwt_algorithm` to the HMAC family. Phase 3H completes it: FastAPI 0.129.0 → 0.141.1 with starlette 0.52.1 → 1.6.0 as one coherent group, closing 10 advisories including missing Host-header validation and the UNC-path SSRF in StaticFiles — reachable here, since `app/main.py` mounts StaticFiles for media. Framework primitives were proven before the suite ran; the complete backend result was byte-identical at 6,731 passed / 64 skipped. **Backend production audit: 9 vulnerable packages → 0 actionable**, with a single residual (ecdsa Minerva timing attack) that has no upstream fix and was made structurally unreachable in Phase 3G |
| DEP-003 | HIGH | Production dependency set | DEP-002 | IN_PROGRESS | Clean production sync/build and SBOM inspection | NO | NO | Yes | Yes | Phase 3D makes the production image install from the committed `uv.lock` with `uv sync --locked --no-dev` instead of re-resolving `pyproject.toml` ranges on every build and shipping the dev group. A clean production sync was verified locally (52 packages); building the image itself remains BLOCKED_ENVIRONMENT because Docker is not available here, and SBOM inspection is still outstanding |
| RATE-001 | CRITICAL | Redis rate limiter | DEP-002 | BLOCKED_EXTERNAL | Production boot, atomic quota, expiry and fail-closed tests | NO | YES | Yes | Yes | Partially blocked in the current working environment: no `redis-server` binary, no `redis` or `fakeredis` Python package, and Docker invocation is not permitted, so multi-instance contention, outage and recovery behaviour cannot be honestly validated here. A defect is recorded and waiting: `RedisRateLimitBackend.hit` reads the count and then writes in separate round trips, so concurrent callers can each observe a count below the limit and all be admitted. It needs to become one atomic server-side operation before it is trusted |
| RATE-002 | CRITICAL | Trusted client IP | WEB-008 | VALIDATED | Spoofed and trusted proxy-chain tests | NO | YES | Yes | Yes | Phase 3A replaces unconditional `X-Forwarded-For` trust with `client_identity`, which believes a forwarded header only when the peer is a configured proxy and then reads the chain right to left. Taken before RATE-001 deliberately: the defect is live under the current in-memory backend too, and identity derivation does not depend on where the counters live. 22 focused cases plus a production configuration decision |
| RATE-003 | HIGH | Endpoint quotas | RATE-001 | NOT_STARTED | Auth, upload, preview, location, search, messaging, admin quota tests | NO | YES | Yes | Yes | — |
| RATE-004 | HIGH | Request safety | None for body bounds; concurrency parts need RATE-001 | IN_PROGRESS | Body-size, timeout, concurrency, cancellation and recovery tests | NO | YES | Yes | Yes | Phase 3I closes the body-size half: a pure-ASGI `RequestBodyLimitMiddleware` bounds every inbound body before parsing, refusing an oversized declared `Content-Length` without reading a byte and counting streamed bytes so omitting the header buys nothing. Registered innermost so its 413 still carries CORS headers and `X-Request-ID`. Ceilings derived from evidence — 12 MiB for the two media endpoints (an 8 MiB banner is ~10.7 MiB as base64) and 2 MiB elsewhere — with exact-path policy so a crafted path cannot claim the larger allowance. 25 focused cases, non-vacuity proven by removing only the streaming count (both streaming tests then returned 200). Timeout and concurrency ceilings remain, and the concurrency parts still depend on RATE-001 |
| RATE-005 | CRITICAL | AI resource guards | RATE-001 | NOT_STARTED | Per-user burst/daily/concurrency/input/cost guard tests | POSSIBLE | YES | Yes | Yes | — |

## Phase 4 — Deterministic product correctness and trust

| ID | Severity | Subsystem | Dependencies | Status | Tests required | Migration | Infra | Blocks beta | Blocks unrestricted | Resolving commit |
|---|---|---|---|---|---|---|---|---|---|---|
| CORRECT-001 | HIGH | Public profiles | WEB-006 | NOT_STARTED | Recruiter/agency routes and entry-link browser tests | NO | NO | Yes | Yes | — |
| CORRECT-002 | HIGH | Pipeline/messaging | AUTH-005 | NOT_STARTED | Pipeline-to-dock, lifecycle, two-persona and duplicate-delivery tests | POSSIBLE | NO | Yes | Yes | — |
| CORRECT-003 | HIGH | Search | BASE-003 | NOT_STARTED | Result, empty, error, filter and route-state browser tests | NO | NO | Yes | Yes | — |
| CORRECT-004 | CRITICAL | Applications | AUTH-005, WEB-006 | NOT_STARTED | Internal/external/expired/closed/idempotent cross-persona tests | POSSIBLE | NO | Yes | Yes | — |
| CORRECT-005 | HIGH | Job posting | BASE-003 | NOT_STARTED | Step headings, reopen, role, location, narrow-mobile and publish tests | POSSIBLE | NO | Yes | Yes | — |
| CORRECT-006 | HIGH | Duplicate UI identity | BASE-003 | NOT_STARTED | Single accessible Apply action per viewport; deterministic locators | NO | NO | Yes | Yes | — |
| CORRECT-007 | MEDIUM | Workspace performance | CORRECT-002 | NOT_STARTED | Bounded list-wide requests and no per-row request amplification | NO | NO | Yes | Yes | — |
| CORRECT-008 | MEDIUM | Assistant layout | BASE-003 | NOT_STARTED | Typing indicator ordering, scroll bounds, mobile/desktop layout tests | NO | NO | Yes | Yes | — |
| TRUST-001 | CRITICAL | Compensation display | BASE-003 | NOT_STARTED | Preserve source amount/currency; flexible/unknown/unpaid tests | POSSIBLE | NO | Yes | Yes | — |
| TRUST-002 | CRITICAL | Marketing claims | BASE-003 | NOT_STARTED | Copy inventory and evidence-link assertions | NO | NO | Yes | Yes | — |
| TRUST-003 | HIGH | Marketplace metrics | BASE-003 | NOT_STARTED | Defined view/save/interest/response semantics and bot/dedup tests, or hidden-state tests | POSSIBLE | POSSIBLE | Yes | Yes | — |
| PRODUCT-001 | HIGH | Job alerts | BASE-003 | NOT_STARTED | Beta UI/API absence; later durable subscription/delivery tests before re-enable | POSSIBLE | YES | Yes | Yes | — |
| PRODUCT-002 | HIGH | Pricing/entitlements | BASE-003 | NOT_STARTED | Beta route/API policy, no client-created entitlement, truthful-copy tests | POSSIBLE | YES | Yes | Yes | — |
| PRODUCT-003 | MEDIUM | Incomplete integrations | AUTH-009 | NOT_STARTED | Unsupported controls absent; supported connect/disconnect paths tested | NO | YES | Yes | Yes | — |
| PRODUCT-004 | HIGH | Seed/demo isolation | BASE-003 | NOT_STARTED | Production database/content and fixed-ID dependency checks | NO | YES | Yes | Yes | — |

## Phase 5 — Durable transactional email and invite-only beta

| ID | Severity | Subsystem | Dependencies | Status | Tests required | Migration | Infra | Blocks beta | Blocks unrestricted | Resolving commit |
|---|---|---|---|---|---|---|---|---|---|---|
| INVITE-001 | CRITICAL | Invitations | AUTH-001, AUTH-005 | VALIDATED | Email binding, expiry, single use, revocation, concurrency and audit tests | YES | NO | Yes | Yes | b141919, then "feat(invites): check the invitation at both signup doors" for atomic single use |
| INVITE-002 | CRITICAL | Registration policy | INVITE-001 | VALIDATED | Google and email/password enforcement; existing-user compatibility tests | NO | NO | Yes | Yes | "feat(invites): check the invitation at both signup doors" |
| EMAIL-001 | CRITICAL | Outbox worker | DEP-002 | VALIDATED | Lease, concurrent claim, retry, crash recovery and idempotency tests | YES | YES | Yes | Yes | 95a1a66, ebaf659, 5e0ded7, 5a7725f |
| EMAIL-002 | CRITICAL | Authentication email | EMAIL-001 | VALIDATED | Invite, verification, reset, expiry and delivery-failure tests | NO | YES | Yes | Yes | "feat(email): make auth mail a promise the database keeps" — verification and reset queue durably and a runner drains them; the invitation email waits on an issuing endpoint |
| EMAIL-003 | HIGH | Event email | EMAIL-001 | NOT_STARTED | Application/hiring/safety notification state and retry tests | POSSIBLE | YES | Yes | Yes | — |
| EMAIL-004 | HIGH | Bounce/suppression | EMAIL-001 | NOT_STARTED | Provider webhook signature, bounce, complaint and suppression tests | YES | YES | Yes | Yes | — |
| EMAIL-005 | HIGH | Domain authentication | EMAIL-001 | BLOCKED_EXTERNAL | Provider staging send, SPF, DKIM, DMARC and bounce-domain verification | NO | YES | Yes | Yes | — |

## Phase 6 — AI Job Import production hardening

| ID | Severity | Subsystem | Dependencies | Status | Tests required | Migration | Infra | Blocks beta | Blocks unrestricted | Resolving commit |
|---|---|---|---|---|---|---|---|---|---|---|
| AI-001 | CRITICAL | Durable import queue | RATE-001, WEB-004 | NOT_STARTED | Enqueue, lease, retry, crash recovery, cancellation and queue outage tests | YES | YES | Yes | Yes | — |
| AI-002 | CRITICAL | Import idempotency | AI-001 | NOT_STARTED | Repeated request, worker retry, duplicate charge/job and concurrent request tests | YES | NO | Yes | Yes | — |
| AI-003 | CRITICAL | Quotas/concurrency | RATE-005, AI-001 | NOT_STARTED | Daily, burst, concurrent, input-size and reset-window tests | YES | YES | Yes | Yes | — |
| AI-004 | CRITICAL | Budget/cost controls | AI-001 | NOT_STARTED | Model allowlist, token/output cap, request/system budget and threshold tests | POSSIBLE | YES | Yes | Yes | — |
| AI-005 | HIGH | Provider resilience | AI-001 | NOT_STARTED | Bounded timeout/retry, unsupported model, unavailable provider and recovery tests | NO | YES | Yes | Yes | — |
| AI-006 | HIGH | Boot/readiness | AI-001 | NOT_STARTED | Missing key, queue, model and provider readiness tests | NO | YES | Yes | Yes | — |
| AI-007 | CRITICAL | Human review | AI-001 | NOT_STARTED | Draft-only output, canonical Post Job validation, no auto-publish tests | NO | NO | Yes | Yes | — |
| AI-008 | CRITICAL | Import SSRF | WEB-004, AI-001 | NOT_STARTED | URL import inherits complete outbound-fetch security suite | NO | NO | Yes | Yes | — |
| AI-009 | HIGH | Provider privacy | AI-001 | NOT_STARTED | Payload minimization, log redaction, `store` configuration and retention-copy tests | NO | YES | Yes | Yes | — |
| AI-010 | HIGH | Evaluation corpus | AI-001 | NOT_STARTED | Literal, inference, currency, ambiguity, conflict, missing, malformed, injection, long-input fixtures | NO | NO | Yes | Yes | — |
| AI-011 | CRITICAL | Kill switch | AI-001 | NOT_STARTED | Runtime disable, in-flight behavior, UI message, audit and recovery tests | POSSIBLE | YES | Yes | Yes | — |

## Phase 7 — Durable media storage

| ID | Severity | Subsystem | Dependencies | Status | Tests required | Migration | Infra | Blocks beta | Blocks unrestricted | Resolving commit |
|---|---|---|---|---|---|---|---|---|---|---|
| MEDIA-001 | CRITICAL | Storage abstraction | WEB-006 | NOT_STARTED | Local adapter, object-key ownership and provider adapter contract tests | POSSIBLE | YES | Yes | Yes | — |
| MEDIA-002 | CRITICAL | Upload grants/quarantine | MEDIA-001, RATE-003 | NOT_STARTED | Grant expiry/scope, finalize, unauthorized access and cleanup tests | YES | YES | Yes | Yes | — |
| MEDIA-003 | CRITICAL | Image validation | MEDIA-002 | NOT_STARTED | Magic byte, decode, pixel/dimension/byte, malformed and metadata-strip tests | NO | NO | Yes | Yes | — |
| MEDIA-004 | HIGH | Canonical delivery | MEDIA-001 | NOT_STARTED | Canonical/CDN URL and host-header poisoning tests | POSSIBLE | YES | Yes | Yes | — |
| MEDIA-005 | HIGH | Object lifecycle | MEDIA-002 | NOT_STARTED | Replacement, orphan, deletion, retry and retention tests | YES | YES | Yes | Yes | — |

## Phase 8 — Realtime and scalable shared state

| ID | Severity | Subsystem | Dependencies | Status | Tests required | Migration | Infra | Blocks beta | Blocks unrestricted | Resolving commit |
|---|---|---|---|---|---|---|---|---|---|---|
| REALTIME-001 | HIGH | Shared event bus | RATE-001 | NOT_STARTED | Cross-instance conversation/notification delivery and deduplication tests | NO | YES | Yes | Yes | — |
| REALTIME-002 | HIGH | Ephemeral presence | REALTIME-001 | NOT_STARTED | Typing/presence TTL, disconnect, reconnect and instance-switch tests | NO | YES | Yes | Yes | — |
| REALTIME-003 | HIGH | Degraded operation | REALTIME-001 | NOT_STARTED | Redis unavailable/recovery and durable HTTP reconciliation tests | NO | YES | Yes | Yes | — |

## Phase 9 — Privacy, legal mechanics, support, and moderation

| ID | Severity | Subsystem | Dependencies | Status | Tests required | Migration | Infra | Blocks beta | Blocks unrestricted | Resolving commit |
|---|---|---|---|---|---|---|---|---|---|---|
| PRIV-001 | CRITICAL | Legal acceptance | AUTH-005 | NOT_STARTED | Versioning, acceptance, reacceptance and audit tests | YES | NO | Yes | Yes | — |
| PRIV-002 | CRITICAL | Data export | PRIV-001, MEDIA-001 | NOT_STARTED | Reauthentication, complete archive, authorization and expiry tests | YES | YES | Yes | Yes | — |
| PRIV-003 | CRITICAL | Account deletion | PRIV-001 | NOT_STARTED | Immediate hiding, suspension, anonymization/deletion, retry and exception tests | YES | YES | Yes | Yes | — |
| PRIV-004 | HIGH | Retention/legal holds | PRIV-003 | NOT_STARTED | Policy scheduler, hold precedence, release and audit tests | YES | YES | Yes | Yes | — |
| PRIV-005 | HIGH | Compliance admin | PRIV-002, PRIV-003, PRIV-004 | NOT_STARTED | Queue authorization, status, evidence, appeal and audit tests | YES | NO | Yes | Yes | — |
| PRIV-006 | HIGH | Notification consent | EMAIL-003 | NOT_STARTED | Preference, unsubscribe, essential-message and suppression tests | YES | YES | Yes | Yes | — |
| MOD-001 | HIGH | Profile/portfolio moderation | PRIV-005 | NOT_STARTED | Hide/restore, reason, authorization, notification and audit tests | POSSIBLE | NO | Yes | Yes | — |
| MOD-002 | HIGH | Audit-log integrity | PRIV-005 | NOT_STARTED | Append-only, retention, export and ordinary-admin mutation denial tests | POSSIBLE | YES | Yes | Yes | — |
| SUPPORT-001 | HIGH | Support tickets | EMAIL-001, PRIV-001 | NOT_STARTED | Create, acknowledge, status, assignment, escalation and access tests | YES | YES | Yes | Yes | — |
| LEGAL-001 | CRITICAL | Production legal copy | PRIV-001 | NOT_STARTED | Required section/link/version inventory and rendering tests | NO | NO | Yes | Yes | — |
| LEGAL-002 | CRITICAL | Counsel approval | LEGAL-001 | BLOCKED_EXTERNAL | Recorded India-first counsel approval and effective-date verification | NO | YES | Yes | Yes | — |

## Phase 10 — CI/CD and production platform

| ID | Severity | Subsystem | Dependencies | Status | Tests required | Migration | Infra | Blocks beta | Blocks unrestricted | Resolving commit |
|---|---|---|---|---|---|---|---|---|---|---|
| CI-001 | CRITICAL | Required checks | Phases 1–9 | NOT_STARTED | CI dry runs for type, lint, unit, backend, Postgres, browser and build | NO | YES | Yes | Yes | — |
| CI-002 | HIGH | Security/supply chain | DEP-003 | NOT_STARTED | npm/Python audits, Gitleaks, SBOM and image scan in CI | NO | YES | Yes | Yes | — |
| PLATFORM-001 | CRITICAL | Production container | DEP-003 | NOT_STARTED | Non-root, prod-only deps, immutable build and health-check tests | NO | YES | Yes | Yes | — |
| PLATFORM-002 | CRITICAL | Configuration contract | WEB-008, RATE-001, MEDIA-001, EMAIL-001 | NOT_STARTED | HTTPS/origin/CORS/host/cookie/secret/service/flag boot matrix | NO | YES | Yes | Yes | — |
| PLATFORM-003 | CRITICAL | Migration release step | CI-001 | NOT_STARTED | Single-run fresh Postgres upgrade and compatible rollout tests | NO | YES | Yes | Yes | — |
| PLATFORM-004 | HIGH | Database pool safety | PLATFORM-002 | NOT_STARTED | Pool-limit, acquire/statement timeout and saturation tests | NO | YES | Yes | Yes | — |
| PLATFORM-005 | HIGH | Health contracts | PLATFORM-002 | NOT_STARTED | Liveness/readiness dependency and secret-redaction tests | NO | YES | Yes | Yes | — |
| RELEASE-001 | CRITICAL | Branch promotion | BASE-004, CI-001 | BLOCKED_EXTERNAL | Authenticated remote fetch, protected-main PR and required checks | NO | YES | Yes | Yes | — |

## Phase 11 — Metadata, SEO, performance, and accessibility

| ID | Severity | Subsystem | Dependencies | Status | Tests required | Migration | Infra | Blocks beta | Blocks unrestricted | Resolving commit |
|---|---|---|---|---|---|---|---|---|---|---|
| SEO-001 | HIGH | Canonicals/noindex | BASE-003 | NOT_STARTED | Public self-canonical; private/auth/admin/error noindex tests | NO | NO | Yes | Yes | — |
| SEO-002 | HIGH | Sitemap | SEO-001 | NOT_STARTED | Pagination, real timestamps, failure reporting and coverage tests | NO | YES | No | Yes | — |
| SEO-003 | HIGH | JobPosting lifecycle | WEB-007, SEO-001 | NOT_STARTED | Schema validity, expiry, closure and removal tests | NO | NO | Yes | Yes | — |
| SEO-004 | MEDIUM | Profile/project metadata | SEO-001 | NOT_STARTED | Title/description/canonical/structured-data tests | NO | NO | No | Yes | — |
| PERF-001 | HIGH | Images/LCP | MEDIA-004 | NOT_STARTED | Image optimization, responsive dimensions and LCP measurements | NO | YES | Yes | Yes | — |
| PERF-002 | HIGH | Workspace scale | CORRECT-007 | NOT_STARTED | Pagination, bundle and 100-concurrent-session load tests | POSSIBLE | YES | Yes | Yes | — |
| A11Y-001 | HIGH | Automated accessibility | Phases 1–9 | NOT_STARTED | Axe across route/state/viewports plus Firefox and WebKit | NO | YES | Yes | Yes | — |
| A11Y-002 | HIGH | Manual accessibility | A11Y-001 | BLOCKED_EXTERNAL | Keyboard, screen reader, zoom, contrast, motion and touch review | NO | YES | Yes | Yes | — |

## Phase 12 — Recovery, observability, and operational readiness

| ID | Severity | Subsystem | Dependencies | Status | Tests required | Migration | Infra | Blocks beta | Blocks unrestricted | Resolving commit |
|---|---|---|---|---|---|---|---|---|---|---|
| OPS-001 | CRITICAL | Database backup/PITR | PLATFORM-003 | BLOCKED_EXTERNAL | Encrypted backup policy and isolated restore meeting RPO/RTO | NO | YES | Yes | Yes | — |
| OPS-002 | HIGH | Media backup/lifecycle | MEDIA-005 | BLOCKED_EXTERNAL | Provider retention and restore validation | NO | YES | Yes | Yes | — |
| OPS-003 | CRITICAL | Error reporting | PLATFORM-002 | NOT_STARTED | PII scrubbing, ingestion failure and source-map tests | NO | YES | Yes | Yes | — |
| OPS-004 | HIGH | Metrics/tracing | OPS-003 | NOT_STARTED | HTTP, DB, Redis, email, realtime, upload, auth and AI telemetry tests | NO | YES | Yes | Yes | — |
| OPS-005 | CRITICAL | Alerts/synthetics | OPS-004 | NOT_STARTED | Auth, browse, publish, apply, message and admin synthetic tests | NO | YES | Yes | Yes | — |
| OPS-006 | HIGH | Incident runbooks | OPS-003 | NOT_STARTED | Tabletop review for rollback, compromise, data loss, abuse and providers | NO | YES | Yes | Yes | — |
| OPS-007 | HIGH | Credential rotation | OPS-006 | NOT_STARTED | Rotation inventory and local/staging rehearsal | NO | YES | Yes | Yes | — |
| OPS-008 | HIGH | Staging soak | OPS-005, all beta blockers | BLOCKED_EXTERNAL | 72-hour soak with SLOs and no unresolved critical/high incident | NO | YES | Yes | Yes | — |

## Phase 13 — Final certification

| ID | Severity | Subsystem | Dependencies | Status | Tests required | Migration | Infra | Blocks beta | Blocks unrestricted | Resolving commit |
|---|---|---|---|---|---|---|---|---|---|---|
| CERT-001 | CRITICAL | Complete local matrix | All implementation items | NOT_STARTED | Every prescribed frontend/backend/security/browser suite is green | NO | NO | Yes | Yes | — |
| CERT-002 | CRITICAL | Production configuration | CERT-001, all external service items | BLOCKED_EXTERNAL | Real service boot, TLS, cookie, header, readiness and provider probes | NO | YES | Yes | Yes | — |
| CERT-003 | CRITICAL | Controlled cohort | OPS-008, CERT-002 | BLOCKED_EXTERNAL | Ten-account, seven-day cohort with rollback triggers and SLO review | NO | YES | Yes | Yes | — |
| CERT-004 | CRITICAL | Release assessment | CERT-001, CERT-002, CERT-003, LEGAL-002 | NOT_STARTED | Evidence review using exact status semantics | NO | YES | Yes | Yes | — |
