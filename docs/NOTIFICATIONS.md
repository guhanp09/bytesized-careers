# Notifications and durable email architecture

CreatorJobs has one in-app notification pipeline and one durable email outbox.
Real email delivery is **disabled by default**: authentication and notification
email intents still commit to the outbox. In production the worker **pauses**
without claiming or consuming them. A deterministic mock provider is available
only outside production.

Verification, password-reset, and invitation mail use the same outbox through
`queue_auth_email`. Local development still captures their links immediately at
`/api/v1/dev/emails`, but no request handler contacts SMTP.

## Pieces

| Concern | Location |
| --- | --- |
| Event registry (single source of truth) | `backend/app/notifications/registry.py` |
| Dispatch service (in-app + email) | `backend/app/notifications/service.py` |
| Email enqueue contract | `backend/app/notifications/email.py` |
| Claim/delivery state machine | `backend/app/notifications/worker.py` and `backend/app/repositories/email_outbox_*` |
| Provider adapters | `backend/app/notifications/provider.py` |
| Worker process | `backend/app/notifications/runner.py` |
| Suppression / consent | `backend/app/services/email_suppression_service.py` and `backend/app/core/notification_consent.py` |
| In-app notification model | `backend/app/models/marketplace.py` (`Notification`) |
| Email outbox model | `backend/app/models/email_outbox.py` (`EmailOutbox`) |
| In-app API | `GET/PATCH /api/v1/notifications…` in `routers/marketplace.py` |
| Dev outbox viewer | `GET /api/v1/dev/emails/outbox` (`routers/dev_emails.py`, dev/test only) |
| In-app UI | `components/Header.tsx` (bell) + `app/notifications/page.tsx` + `components/marketplace/NotificationList.tsx` |
| Feature flag | `EMAIL_DELIVERY_ENABLED` (`backend/app/core/config.py`, default **false**) |

## Flow

```
domain action                              authentication action
     │                                             │
     ▼                                             ▼
dispatch_notification(...)                 queue_auth_email(...)
     │                                             │
     ├── Notification row ──► bell/page            │
     └── email-enabled event ───────┬──────────────┘
                                    ▼
                            email_outbox row
                                    │
                 production gate (off = leave queued)
                                    │
                 worker claims with lease + retry state
                                    │
                       suppression and consent checks
                                    │
                    SMTP (mock only outside production)
                                    │
                         sent / failed / skipped
```

Rows are added to the **caller's** DB session, so a notification commits atomically
with the action that triggered it (and never on its own).

## Events (current)

`backend/app/notifications/registry.py` is authoritative. Its current producers
cover applications and talent interest, published jobs, real messages,
interviews, engagements and verified reviews, and administrator warnings/notices.
`default_channels` decides whether each producer also writes an outbox row;
message and moderation events are intentionally in-app-only by default, while
high-value application/interview events also default to email.

## How to add a new notification event

1. **Register it** in `registry.py` — add a `NotificationEvent` with `key`,
   `category`, `recipient`, `actor`, `channels`, `default_channels`, `priority`,
   `required_payload`, and `notes`. Keep `email` out of `default_channels` for
   low-value/self events.
2. **Dispatch it** from the flow that causes it:
   ```python
   from app.notifications import dispatch_notification
   await dispatch_notification(
       session,
       event_key="your_event",
       recipient_user_id=recipient.id,
       actor_user_id=actor.id,          # optional
       title="…", body="…",
       category="application",          # in-app UI grouping
       action_url="/applications",
       resource_type="job_application", resource_id=str(x.id),
       payload={"job_title": job.title},  # must include required_payload keys
   )
   ```
   Do not commit inside the trigger just for the notification — it commits with the
   surrounding transaction.
3. The in-app row appears in the bell/page automatically, and a durable email
   intent is queued if the event has email enabled. The caller never sends it.

## Testing locally

- **Unit/integration:** `cd backend && .venv/bin/python -m pytest tests/test_notifications.py`
  - registry validity + payload validation (pure)
  - apply → recruiter gets in-app `new_applicant` + a queued outbox row
  - status change → applicant notified; job published → poster notified; mark-all-read clears unread
- **Manually (dev):**
  - In-app: open the bell / `/notifications` as the recipient.
  - Queued/delivered intent: `GET /api/v1/dev/emails/outbox` (dev/test only).
  - Immediate local auth-link capture: `GET /api/v1/dev/emails`.
  - Start the worker with `python -m app.notifications.runner`, or use
    `EMAIL_WORKER_IN_PROCESS=true` for local development only.

## Real delivery gate

- `EMAIL_DELIVERY_ENABLED` defaults to **false**. With `APP_ENV=production`,
  delivery is paused unless this flag is true **and** `EMAIL_MODE=smtp`. Paused
  passes do not claim rows, spend retries, or record successful delivery. The
  runner does not open a database session while paused. Production mock provider
  selection and use are forbidden, including explicit worker injection.
- Outside production, the disabled default still uses `MockEmailProvider`. It
  exercises the ordinary success transition and records a `mock-*` provider ID;
  there is no second `mocked` state. Never run a nonproduction worker against a
  production outbox.
- The worker rechecks loaded settings each pass and before sending. Environment
  variables are still loaded at process startup: changing an environment flag
  requires restarting **every** worker. This is not yet a shared runtime switch.
- If a pause is observed mid-batch, unattempted rows remain queued without a retry
  charge. Already acquired leases expire normally (currently 120 seconds); no
  unfenced lease release is added. A send already accepted by SMTP cannot be
  recalled. Resuming does not resend rows already recorded as sent.
- **To enable real delivery later** (after a domain + provider exist):
  1. Set `EMAIL_DELIVERY_ENABLED=true` **and** `EMAIL_MODE=smtp` with valid `SMTP_*`.
  2. Start/restart the standalone worker and verify an approved real recipient,
     provider ID, webhook signature, and suppression behavior.
  3. Keep `EMAIL_WORKER_IN_PROCESS=false` in production so deploys and API
     restarts do not own the worker lifetime.

## Intentionally deferred (no fake data)

These remain deliberately outside the current delivery contract:

- Lifecycle / retention digests remain intentionally absent. Do not synthesize
  urgency, activity, demand, or engagement metrics to create them.
- HTML/template-provider integration is not implemented; the provider currently
  sends the stored plaintext body.

## Known gaps to close before production email

- No **digest scheduler** / cron.
- Provider/DNS configuration and a real webhook exercise remain external gates.
- `EMAIL-006B`: time-sensitive message expiry/revalidation on resume and a read-only
  report of historical `mock-*` success records remain required. **Do not enable
  production delivery until these and the delivery-safety gates below pass.**
  Never automatically mass-resend historical mock-success records.
- `EMAIL-007`: claims must commit before provider I/O, completion needs lease/attempt
  fencing, and blocking SMTP needs bounded off-event-loop execution. Crash/unknown
  acceptance tests remain required. SMTP is at-least-once, not exactly-once.
- The SMTP adapter has only coarse retryable-error classification because the
  existing SMTP service exposes one delivery exception type.
- `account_type` is a single value, so a user who is both Talent and Recruiter has
  one mode — decide how digests treat dual-role users.
