# CreatorJobs Outbound Network Inventory

This is the Phase 2 working inventory for server-initiated network traffic. It
supports, but does not replace, `PRODUCTION_READINESS_EXECUTION.md`. Every new
server-side network caller must be added here and classified before merge.

## Boundary rules

- A user-influenced public URL must use the shared backend
  `SafeOutboundFetcher`. Validation alone is insufficient: the TCP connection
  must be pinned to the validated DNS answer, and every redirect must repeat
  validation with a fresh connection pool.
- A caller that may only reach a specific set of pages expresses that as
  `SafeOutboundFetchPolicy.destination_allowed`, never as a check around the
  first request. The predicate is product policy owned by the caller; the shared
  primitive owns *when* it runs, which is on the entered URL and on every hop
  before a connection is opened.
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
| OF-001 | `PublicJobUrlFetcher` via authenticated, rate-limited `POST /job-imports/url-sources` | Recruiter supplies the entire URL | None | Shared resolver, strict public-address/80-or-443 policy, validated-IP TCP pin, peer check, per-hop redirects, no environment proxy/cookies, total/operation timeouts, decoded-byte and content-type bounds | Phase 3K adds the shared per-user outbound-fetch allowance; Phase 6 moves the overall import workflow to its durable queue | WEB-001, WEB-002, WEB-004, AI-008 | MIGRATED_PHASE_2A |
| OF-002 | `PublicBrandUrlFetcher` via brand enrichment | URL is derived from imported evidence or provider discovery and is therefore untrusted | None | Same shared boundary as OF-001 with a separate three-megabyte HTML/text policy | Phase 3K adds the shared per-user outbound-fetch allowance; retain the boundary when enrichment becomes queued and add the remaining cost/concurrency guard under RATE-004/RATE-005 | WEB-001, WEB-002, WEB-004 | MIGRATED_PHASE_2A |
| OF-003 | `link_preview_service._fetch_text_url` via authenticated `POST /portfolio/link-preview` | User supplies the entire portfolio URL | None | Shared public-address/80-or-443 policy, validated-IP TCP pin, peer check, per-hop redirects, proxy/cookie bypass, six-second total deadline, supported HTML/plain type policy, 512 KiB decoded-body ceiling, and per-field metadata length ceilings | Phase 3K adds the shared per-user outbound-fetch allowance; WEB-006 separately validates metadata URLs returned by untrusted pages before storage/display | WEB-004 | MIGRATED_PHASE_2B |
| OF-004 | `link_preview_service._fetch_oembed_json` | Work URL is user input; the network endpoint is selected only from exact built-in YouTube/Vimeo constants | None | Shared pinned boundary plus exact endpoint allowlist, redirect refusal, six-second total deadline, JSON-only parsing, 64 KiB decoded-body ceiling, and no provider/user credentials | Phase 3K adds the shared per-user outbound-fetch allowance; retain manual-entry fallback during provider failure | WEB-002, WEB-004 | MIGRATED_PHASE_2B |
| OF-005 | `ProfileService._fetch_public_hiring_identity_text` | User supplies an allowlisted YouTube/Instagram profile URL | None | Shared pinned boundary carrying the platform host/path allowlist as a per-hop destination predicate, plus public-address/80-or-443 policy, peer check, proxy/cookie bypass, four-redirect ceiling, fifteen-second whole-attempt deadline, HTML-only types, and a four-megabyte streamed ceiling | Phase 3K adds the shared per-user outbound-fetch allowance to request/check verification entry points | WEB-002, WEB-003 | MIGRATED_PHASE_2C |
| OF-006 | Next route `POST /api/profile/organization-identity` proxying to backend `POST /me/organization-page` | Authenticated same-origin callers only; user supplies an arbitrary organization URL (Instagram is canonicalized) | None | Shared pinned boundary in the backend: public-address/80-or-443 policy, validated-IP TCP pin, peer check, per-hop redirect revalidation, proxy/cookie bypass, HTML-only types, one-megabyte streamed ceiling, twelve-second whole-attempt deadline, and a per-hop platform predicate for YouTube/Instagram; only bounded structured fields cross back and no remote HTML reaches the Next runtime or the browser | Phase 3K adds the shared per-user outbound-fetch allowance | WEB-003 | MIGRATED_PHASE_2D_2 |
| OF-007 | `lib/youtubeIdentity` custom-path channel lookup | User URL is restricted syntactically to known YouTube hosts | None | No longer fetches: the caller injects a resolver backed by backend `POST /me/organization-page`, which reads the page through the shared pinned boundary and returns only the channel id; without that resolver a custom path falls back to URL-derived identity rather than fetching from the Next runtime | Nothing outstanding for this caller; fixed YouTube Data API calls remain OF-104 | WEB-003 | MIGRATED_PHASE_2D_3 |

## Fixed external provider destinations

| ID | Caller / endpoint | User influence | Secret exposure | Current boundary | Required next action | Owner |
|---|---|---|---|---|---|---|
| OF-101 | `google_oauth_refresh` → `https://oauth2.googleapis.com/token` | None; fixed POST | OAuth client secret and refresh credential in form body | Redirect-free, proxy-independent, operation timeout, 16 KiB decoded-body bound, redacted result/errors | Add operational metrics/alerts and live-provider drill; do not route through arbitrary GET fetcher | AUTH-004, OPS-004 |
| OF-102 | `google_oauth_revocation` → `https://oauth2.googleapis.com/revoke` | None; fixed POST | Provider access/refresh credential in form body | Redirect-free, proxy-independent, operation timeout, 4 KiB decoded-body bound, status-only result | Add operational metrics/alerts and live-provider drill | AUTH-004, OPS-004 |
| OF-103 | Backend `youtube_service` → fixed YouTube Data API URLs | IDs are validated/bounded parameters; endpoint is fixed | OAuth bearer or API key | Redirect-free and proxy-independent, but metadata response body/JSON and total request lifetime are not yet uniformly bounded | Add fixed-provider response/body/total-time contract without weakening OAuth error classification | WEB-008, RATE-004 |
| OF-104 | Next `lib/youtubeIdentity` → fixed YouTube Data API URLs | Channel/video identifiers become query parameters | YouTube API key in query | Operation timeout; automatic redirects and unbounded JSON; runs in server route today | Move behind bounded backend provider client or add an equivalent strict fixed-host adapter; ensure redirect cannot leak the key | WEB-003, WEB-008 |
| OF-105 | Authenticated backend `GET /me/location/{autocomplete,details}` → exact legacy Google Places URLs; same-origin Next routes are credential-free proxies | Query/place ID become application-bounded provider parameters; caller identity comes from the durable bearer session | Backend-only `SecretStr` Places API key in the fixed request query; absent key fails closed and the Next autocomplete proxy uses only its owned local catalogue | Redirect-free, proxy/cookie-independent fixed HTTPS destination; four-second operation and six-second whole-attempt deadlines; 128 KiB decoded JSON ceiling; JSON/content/status and per-field shape bounds; at most six normalized suggestions; privacy-safe errors; shared Redis 120/minute verified-user quota; exact source attribution in the dropdown | Before enabling the optional production key, restrict it to the backend/provider APIs, set Google billing quotas, review current [Places API policies](https://developers.google.com/maps/documentation/places/web-service/policies), and run a live lookup/attribution/outage drill. Keeping the key absent is a complete local-catalogue fallback, not a partial provider state | WEB-008, RATE-003, RATE-004 |
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
