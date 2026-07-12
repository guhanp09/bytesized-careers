# Messaging Architecture

This document describes the local, backend-authoritative conversation system for
CreatorJobs. It applies to job applications and recruiter-initiated talent
requests. It does not describe a hosted deployment; this work has not been
pushed or deployed.

## Source Of Truth

The PostgreSQL/SQLite database remains the source of truth for applications,
talent interests, conversations, messages, read progress, notifications, and
blocks.

- A job application has at most one conversation.
- A talent interest has at most one conversation.
- HTTP creates messages and retrieves history.
- WebSockets only publish low-latency events after HTTP-backed persistence
  succeeds. They cannot create messages, status updates, applications, or
  hiring requests.
- A reconnect always reloads the selected thread through HTTP, so missed socket
  events never become missing history.

## Integration Matrix

| Concern | Prior Inbox consistency work | Broader workflow work | Final behavior |
| --- | --- | --- | --- |
| Browser storage | State keys scoped by backend user; old global keys purged | Inbox/dock/note state uses the stored key | Each account or QA persona restores only its own mode, selection, dock, and note cache. |
| Persona switching | Switches open the new persona route instead of reusing the prior URL | Backend persona access token changes identity | The real-time client closes its old identity socket before acquiring the new one. |
| Notification deep links | Mounted `/applications` follows later query-string changes | Notifications carry recipient-specific mode and source thread ID | A bell click opens the correct participant's Inbox thread without a page remount. |
| Conversation fetch | Existing HTTP detail endpoints | One conversation per application/interest | HTTP remains authoritative for history, source context, engagement state, and block state. |
| Conversation refresh | Three-second polling for Inbox and dock | Idempotent sends and unread state | Healthy sockets slow background polling to 15 seconds; disconnected sockets retain the three-second fallback. |
| Sending messages | Existing HTTP message endpoint | UUID idempotency and recipient notification | A sent message is persisted once, then emits socket events to subscribed participants. |
| Unread state | HTTP list endpoint | Persisted participant read timestamps | Socket unread events update the relevant thread immediately; polling reconciles after reconnect. |
| Status events | Existing trusted status endpoint | Server validates pipeline transition | Clients cannot forge status events through WebSockets. |
| Accepted/hired work | Existing source-status checks | Engagement lifecycle remains additive | Hired applications and accepted requests remain messageable unless blocked. |
| Terminal threads | Existing rejected/declined/withdrawn/archive rules | Server-side status updates remain allowed only through trusted workflows | Normal composer is unavailable; historical messages remain readable. |
| Private notes | User-scoped browser cache | Backend-only owner authorization | Notes never cross a persona boundary and do not produce presence or typing signals. |
| Cache invalidation | Scoped local persistence | Live HTTP responses | Socket reconnect/block events trigger an authoritative refresh instead of fabricating state. |

The Fable consistency fix remains intact: it owns browser-state isolation and
deep-link synchronization. The real-time layer consumes that behavior rather
than replacing it.

## HTTP And WebSocket Responsibilities

### HTTP APIs

HTTP is required for the durable operations:

- `GET /api/v1/me/conversations`
- `GET /api/v1/me/applications/{id}/conversation`
- `GET /api/v1/me/talent-interests/{id}/conversation`
- `POST /api/v1/me/conversations/{id}/messages`
- `POST /api/v1/me/conversations/{id}/read`
- `POST /api/v1/me/blocks/{user_id}`
- `DELETE /api/v1/me/blocks/{user_id}`
- `GET /api/v1/me/blocks`

The message endpoint validates participant membership, source-thread state,
block state, body length, and client message idempotency. A retry using the
same client UUID and body returns the original persisted message. A reused UUID
with different content is rejected.

### WebSocket API

The low-latency endpoint is:

```text
ws(s)://<backend>/api/v1/ws/conversations
```

The client sends the backend access token in the WebSocket subprotocol list:

```text
creatorjobs.realtime.v1, <access JWT>
```

It never places an access token in a URL query string. The server derives the
user identity from the same JWT validation used by HTTP. It validates the
origin against `CORS_ORIGINS` and `FRONTEND_BASE_URL`, permits only
participant-owned conversation subscriptions, and periodically revalidates a
quiet socket so an expired or revoked QA token cannot remain usable.

Client-to-server messages are deliberately limited to:

```json
{"type":"subscribe","conversation_id":"..."}
{"type":"unsubscribe","conversation_id":"..."}
{"type":"typing","conversation_id":"...","is_typing":true}
{"type":"ping"}
```

The client cannot create messages or lifecycle/status events through this
channel.

Server events are:

| Event | Meaning |
| --- | --- |
| `connected` | Authenticated socket is ready. The client refetches current state. |
| `message.created` | A persisted message for an open subscribed thread. |
| `conversation.unread` | Current participant unread count for one source thread. |
| `conversation.read_progress` | The other participant has advanced their durable read position. |
| `conversation.typing` | Ephemeral counterpart typing presence. |
| `interaction.blocked` | Refresh authorization and composer state; it intentionally omits block-owner identity. |
| `subscribed`, `pong`, `error` | Transport acknowledgement or safe validation feedback. |

The current broadcaster is intentionally process-local. Its small boundary in
`backend/app/realtime/` can later be backed by Redis or another pub/sub service
for multi-instance hosting. Do not expect delivery between separate backend
instances until that future transport adapter exists; HTTP polling remains the
reliable fallback.

## Client Lifecycle And Recovery

There is one shared browser socket per backend user and access token, even when
both the full Inbox and compact chat dock are mounted. It:

- opens only for an authenticated backend user;
- closes when all consumers unmount, sign out, or switch QA persona;
- uses bounded exponential reconnects up to eight seconds;
- does not retry a rejected authentication/origin connection in a loop;
- resubscribes the active thread after reconnecting;
- de-duplicates events by stable event/message ID;
- throttles typing transmissions;
- refetches HTTP state after reconnecting;
- keeps short HTTP polling as a fallback when the socket is unhealthy.

No normal-product "socket connected" label is shown. The UI only retains its
existing retry states when HTTP history cannot be loaded.

## Typing Semantics

Typing is never stored in the database and never creates a notification.

- It is sent only for an active, messageable thread.
- The server derives the sender from the socket identity and verifies both
  participants and the block/source status.
- The other participant sees `Name is typing...` only in that same open thread.
- The signal expires after six seconds on the server and 6.5 seconds in the
  client as a stale-state guard.
- Sending, clearing the composer, unsubscribing, switching conversation, socket
  disconnect, or persona switch clears it.
- Multiple tabs for the same sender do not flicker the indicator: it clears only
  after the last active tab stops typing.

## Read Receipt Semantics

Message read state is not notification read state.

Each conversation already carries one `last_read_at` timestamp per participant.
The `/read` endpoint advances only the caller's timestamp, monotonically. A
thread is marked read only when it is the active visible conversation and its
loaded detail reports unread messages. Listing an Inbox, receiving a bell
notification, or receiving a socket event does not mark messages read.

For a compact UI, only the sender's latest outgoing non-status bubble can show
`Seen`. The backend calculates this from the other participant's durable read
timestamp. It survives refresh and is broadcast live to the sender after the
recipient opens and marks the thread read. Blocked conversations never expose
counterparty read progress.

## User Blocking

`user_blocks` is a dedicated domain table. It is not a rejection, archive,
suspension, moderation action, or frontend-only filter.

- A record is directional: only its blocker can remove it.
- Interaction prevention is pair-level: a block in either direction prevents
  direct messaging, applications, and recruiter hiring requests between the
  two user accounts. A hiring identity cannot bypass it.
- Self-blocking, missing targets, and duplicate records are handled safely.
- Existing applications, requests, engagements, reviews, conversations, and
  messages remain as historical records.
- Blocking disables the composer and typing/read-presence transport. The person
  who did not create the record sees only a neutral unavailable state.
- Public listings can remain browseable; a prohibited direct action receives a
  neutral unavailable response without exposing who blocked whom.
- Unblocking removes only the caller's record. It does not recreate a source
  record, reset pipeline status, restore stale presence, or notify the other
  party. Messaging resumes only if the underlying thread is otherwise open.

The conversation overflow menu offers Block/Unblock with a confirmation step.
The compact dock presents a neutral blocked state and directs the user to the
full Inbox, where the owner can unblock.

### QA restore boundary

Restoring an Inbox, application, hiring-request, or full QA scenario also clears
transient interactions and blocks created **between deterministic QA personas and
deterministic QA listings**. It removes their dependent conversations, messages,
notes, and interaction notifications in dependency order before reseeding the
fixture. An ordinary user's application to a seeded listing is deliberately not
considered QA-owned and remains intact. This makes repeated two-sided QA runs
safe without turning restore into a destructive staging reset.

## Database Migration

`backend/alembic/versions/0037_user_blocks.py` creates `user_blocks` after
`0036_private_note_history`.

It includes:

- directional uniqueness;
- two indexed user foreign keys;
- cascade removal for deleted users; and
- a database check preventing self-block rows.

For a future release, use the normal backend migration workflow against the
intended environment only:

```bash
cd backend
uv run alembic upgrade head
```

Do not run that command against a hosted database as part of local testing.

`alembic heads` reports one head: `0037_user_blocks`. The project's historical
`0001_initial_jobs` migration uses PostgreSQL `JSONB` directly, so replaying the
entire migration history against disposable SQLite stops at that pre-existing
initial migration. The local test harness correctly uses SQLAlchemy metadata to
create the isolated SQLite schema; it does not weaken the PostgreSQL migration
history. Before release, run `alembic upgrade head` against an isolated
PostgreSQL database matching the intended deployment engine.

## Local Two-Browser Check

Use the disposable QA setup in `QA_PERSONA_TESTING.md`, then:

1. Restore `Inbox and pipeline` as the controller.
2. Open two browser profiles or an incognito window.
3. In one, switch to `Finance Simplified`; in the other, switch to `Priya Nair`.
4. Open their shared application Inbox thread in both windows.
5. Type in Priya's composer. Finance should see `Priya is typing...` without a
   page reload. Stop typing and confirm it clears.
6. Send a message from Priya. Finance should receive it immediately; refresh
   either page and confirm there is exactly one bubble.
7. With Finance's thread active and visible, confirm the message is read. Priya
   should see `Seen` under only her latest outgoing message.
8. As Finance, open the overflow menu and block Priya. Verify history remains,
   compose controls close, and a new job application or talent request between
   those accounts is rejected.
9. Unblock from Finance's Inbox. Verify the existing active thread can send
   messages again, without creating a new application or conversation.
10. Switch either browser to another QA persona. Confirm the old thread,
    typing state, notifications, storage selection, and socket events do not
    carry into that persona.

## Focused Local Commands

```bash
npx tsc --noEmit
npm run lint
npm run build
node --test tests/messaging.test.mjs tests/realtimeMessaging.test.mjs tests/userScopedStorage.test.mjs
cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_messaging.py tests/test_realtime_blocking.py
cd .. && npm run test:e2e:qa
```

The QA command starts an isolated SQLite database and local servers. It must
not be pointed at Render, Vercel, Neon, or any hosted environment.

## Future Release Configuration

No hosted configuration was changed by this work. Before enabling this feature
in a later release, verify the frontend origin appears in both backend
`FRONTEND_BASE_URL` and `CORS_ORIGINS`, and verify the chosen backend host/proxy
supports WebSocket upgrades. The process-local broadcaster is appropriate for a
single backend instance. Multi-instance deployment requires a shared broadcast
adapter before promising cross-instance real-time delivery.
