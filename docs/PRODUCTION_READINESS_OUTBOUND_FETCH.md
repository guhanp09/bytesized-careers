# CreatorJobs Outbound Network Inventory

This is the Phase 2 working inventory for server-initiated network traffic. It
supports, but does not replace, `PRODUCTION_READINESS_EXECUTION.md`. Every new
server-side network caller must be added here and classified before merge.

## Boundary rules

- A user-influenced public URL must use the shared backend
  `SafeOutboundFetcher`. Validation alone is insufficient: the TCP connection
  must be pinned to the validated DNS answer, and every redirect must repeat
  validation with a fresh connection pool.
- Fixed provider endpoints may use a provider-specific client when the URL and
  method are constants. They still need proxy-independent transport, redirect
  refusal or strict per-hop allowlisting, bounded time/body/concurrency, safe
  response parsing, and credential redaction.
- Configured CreatorJobs service origins are internal service calls, not public
  URL fetches. Production configuration must make their scheme/host immutable
  and trusted; user input must never select or extend the origin.
- Provider SDK traffic and SMTP are inventoried because they leave the trust
  boundary, but they belong to their provider/email hardening phases rather
  than the arbitrary-public-URL primitive.

## User-influenced public destinations

| ID | Caller / entry point | Destination control and caller auth | Credentials sent | Current boundary | Required next action | Ledger owner | Status |
|---|---|---|---|---|---|---|---|
| OF-001 | `PublicJobUrlFetcher` via authenticated, rate-limited `POST /job-imports/url-sources` | Recruiter supplies the entire URL | None | Shared resolver, strict public-address/80-or-443 policy, validated-IP TCP pin, peer check, per-hop redirects, no environment proxy/cookies, total/operation timeouts, decoded-byte and content-type bounds | Phase 3 replaces the current process-local endpoint limit; Phase 6 moves the overall import workflow to its durable queue | WEB-001, WEB-002, WEB-004, AI-008 | MIGRATED_PHASE_2A |
| OF-002 | `PublicBrandUrlFetcher` via brand enrichment | URL is derived from imported evidence or provider discovery and is therefore untrusted | None | Same shared boundary as OF-001 with a separate three-megabyte HTML/text policy | Retain shared boundary when enrichment becomes queued; add Phase 3 cost/concurrency limits | WEB-001, WEB-002, WEB-004 | MIGRATED_PHASE_2A |
| OF-003 | `link_preview_service._fetch_text_url` via authenticated `POST /portfolio/link-preview` | User supplies the entire portfolio URL | None | Shared public-address/80-or-443 policy, validated-IP TCP pin, peer check, per-hop redirects, proxy/cookie bypass, six-second total deadline, supported HTML/plain type policy, 512 KiB decoded-body ceiling, and per-field metadata length ceilings | Phase 3 adds distributed user quotas; WEB-006 separately validates metadata URLs returned by untrusted pages before storage/display | WEB-004 | MIGRATED_PHASE_2B |
| OF-004 | `link_preview_service._fetch_oembed_json` | Work URL is user input; the network endpoint is selected only from exact built-in YouTube/Vimeo constants | None | Shared pinned boundary plus exact endpoint allowlist, redirect refusal, six-second total deadline, JSON-only parsing, 64 KiB decoded-body ceiling, and no provider/user credentials | Add Phase 3 quotas and Phase 12 provider-error metrics; retain manual-entry fallback during provider failure | WEB-002, WEB-004 | MIGRATED_PHASE_2B |
| OF-005 | `ProfileService._fetch_public_hiring_identity_text` | User supplies an allowlisted YouTube/Instagram profile URL | None | Host/path allowlist is repeated on redirects, but DNS/IP is unchecked, environment proxies are honored, and `response.text` materializes the full body before slicing | Route allowlisted social-page HTML through the shared primitive plus platform-host policy; preserve verification semantics | WEB-002, WEB-003 | PLANNED_PHASE_2C |
| OF-006 | Next route `POST /api/profile/organization-identity` | Currently unauthenticated; user supplies an arbitrary organization URL (Instagram is canonicalized) | None | Regex-only private-host check; automatic redirects; no DNS pinning; body is fully materialized before slicing | Require an authenticated same-origin session, proxy to a backend service using `SafeOutboundFetcher`, bound request/response, and add Phase 3 quota | WEB-003 | PLANNED_PHASE_2C |
| OF-007 | `lib/youtubeIdentity.resolveCustomPathByHtml` when invoked by the organization route | User URL is restricted syntactically to known YouTube hosts | None | Node fetch follows redirects; no DNS pinning/peer check or byte-stream ceiling before `text()` | Move the HTML fallback behind the same backend organization resolver; keep fixed YouTube Data API calls separate | WEB-003 | PLANNED_PHASE_2C |

## Fixed external provider destinations

| ID | Caller / endpoint | User influence | Secret exposure | Current boundary | Required next action | Owner |
|---|---|---|---|---|---|---|
| OF-101 | `google_oauth_refresh` → `https://oauth2.googleapis.com/token` | None; fixed POST | OAuth client secret and refresh credential in form body | Redirect-free, proxy-independent, operation timeout, 16 KiB decoded-body bound, redacted result/errors | Add operational metrics/alerts and live-provider drill; do not route through arbitrary GET fetcher | AUTH-004, OPS-004 |
| OF-102 | `google_oauth_revocation` → `https://oauth2.googleapis.com/revoke` | None; fixed POST | Provider access/refresh credential in form body | Redirect-free, proxy-independent, operation timeout, 4 KiB decoded-body bound, status-only result | Add operational metrics/alerts and live-provider drill | AUTH-004, OPS-004 |
| OF-103 | Backend `youtube_service` → fixed YouTube Data API URLs | IDs are validated/bounded parameters; endpoint is fixed | OAuth bearer or API key | Redirect-free and proxy-independent, but metadata response body/JSON and total request lifetime are not yet uniformly bounded | Add fixed-provider response/body/total-time contract without weakening OAuth error classification | WEB-008, RATE-004 |
| OF-104 | Next `lib/youtubeIdentity` → fixed YouTube Data API URLs | Channel/video identifiers become query parameters | YouTube API key in query | Operation timeout; automatic redirects and unbounded JSON; runs in server route today | Move behind bounded backend provider client or add an equivalent strict fixed-host adapter; ensure redirect cannot leak the key | WEB-003, WEB-008 |
| OF-105 | Next location autocomplete/details → fixed Google Places URLs | Query/place ID become bounded provider parameters | Places API key in query | Fixed origin and four-second abort; JSON body is unbounded and routes lack Phase 3 distributed quotas | Add bounded JSON parsing, fixed-origin redirect refusal, input ceilings, and Redis quota | WEB-008, RATE-003, RATE-004 |
| OF-106 | OpenAI job import, brand discovery, and brand summary SDK clients | Prompt content is user/job-derived; network origin is provider/config controlled | OpenAI API key | SDK timeouts and some retry/output controls exist; full queue, budget, privacy, kill-switch, and provider readiness work remains | Phase 6 owns provider configuration, payload minimization, budgets, durable execution, and observability | AI-001–AI-011 |

## Configured CreatorJobs service calls

The following call configured backend origins rather than user-selected hosts:
`lib/auth.ts`, `lib/backendClient.ts`, `lib/devToolsProxy.ts`,
`lib/qaPersonaProxy.ts`, and the Next identity/dev proxy routes. They must remain
origin-joined from a validated server configuration. Phase 10 will make the
production origin contract fail closed; Phase 2 redirect/origin work must ensure
no request parameter can replace the configured origin.

## Non-HTTP outbound traffic

`email_service.py` performs blocking SMTP today. It is not an SSRF caller, but
it is an external network boundary and must be replaced by the durable Phase 5
outbox worker/provider adapter. PostgreSQL, Redis, object storage, telemetry,
and realtime connections are tracked in their owning infrastructure phases.
