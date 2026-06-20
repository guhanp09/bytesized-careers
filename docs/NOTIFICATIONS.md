# Notifications — Architecture (Phase 1)

CreatorJobs has one notification pipeline that powers **in-app notifications today**
and is wired for **email notifications later**. Real email delivery is **disabled by
default** — notification emails are written to an outbox and mocked until a
production domain + provider are ready.

> Auth emails (email verification, password reset) are a separate, already-live
> path (`app/services/email_service.py` → `send_auth_email`) and are **not** changed
> by this system.

## Pieces

| Concern | Location |
| --- | --- |
| Event registry (single source of truth) | `backend/app/notifications/registry.py` |
| Dispatch service (in-app + email) | `backend/app/notifications/service.py` |
| Email outbox + adapters (mock / smtp) | `backend/app/notifications/email.py` |
| In-app notification model | `backend/app/models/marketplace.py` (`Notification`) |
| Email outbox model | `backend/app/models/email_outbox.py` (`EmailOutbox`) |
| In-app API | `GET/PATCH /api/v1/notifications…` in `routers/marketplace.py` |
| Dev outbox viewer | `GET /api/v1/dev/emails/outbox` (`routers/dev_emails.py`, dev/test only) |
| In-app UI | `components/Header.tsx` (bell) + `app/notifications/page.tsx` + `components/marketplace/NotificationList.tsx` |
| Feature flag | `EMAIL_DELIVERY_ENABLED` (`backend/app/core/config.py`, default **false**) |

## Flow

```
user action (apply / status change / job published / hiring request …)
        │
        ▼
dispatch_notification(session, event_key, recipient_user_id, title, body, payload, …)
        │
        ├── always: insert Notification row  ──►  bell + /notifications page
        └── if registry.default_channels has "email" and event.wired:
                 queue_notification_email(...)  ──►  email_outbox row
                        └── adapter: mocked (default)  |  smtp (only if EMAIL_DELIVERY_ENABLED)
```

Rows are added to the **caller's** DB session, so a notification commits atomically
with the action that triggered it (and never on its own).

## Events (current)

Declared in `registry.py`. `wired=True` means a real trigger exists today.

| Event | Recipient | In-app | Email default | Source |
| --- | --- | --- | --- | --- |
| `application_submitted` | applicant (self) | ✓ | — (no self-email) | `marketplace.apply_to_job` |
| `new_applicant` | recruiter | ✓ | ✓ (mocked) | `marketplace.apply_to_job` |
| `application_status_changed` | applicant | ✓ | ✓ (mocked) | `marketplace.update_application_status` |
| `talent_interest_received` | talent | ✓ | ✓ (mocked) | `marketplace.send_talent_interest` |
| `talent_interest_status_changed` | recruiter | ✓ | — | `marketplace.update_talent_interest_status` |
| `job_posted_successfully` | poster | ✓ | ✓ (mocked) | `job_service.create_job` (published) |
| `talent_listing_created` | talent (self) | ✓ | — | `marketplace.create_talent_listing` |
| `launch_free_checkout_completed` | user (self) | ✓ | — | `marketplace.complete_launch_free_checkout` |
| `message_received` | participant | (declared) | (declared) | **DEFERRED — no messaging backend yet** |

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
3. That's it — the in-app row appears in the bell/page automatically, and a mocked
   email is queued if the event has `email` enabled.

## Testing locally

- **Unit/integration:** `cd backend && .venv/bin/python -m pytest tests/test_notifications.py`
  - registry validity + payload validation (pure)
  - apply → recruiter gets in-app `new_applicant` + a **mocked** outbox row (never `sent`)
  - status change → applicant notified; job published → poster notified; mark-all-read clears unread
- **Manually (dev):**
  - In-app: open the bell / `/notifications` as the recipient.
  - Queued emails: `GET /api/v1/dev/emails/outbox` (dev/test only) lists mocked notification emails (status `mocked`).
  - Auth emails remain at `/dev/emails`.

## Email is mocked / disabled — how it works and how to enable later

- `EMAIL_DELIVERY_ENABLED` defaults to **false**. With it off, every notification
  email row is written with status `queued` and immediately marked **`mocked`** by
  `MockEmailAdapter` — nothing is sent. This is safe with no domain.
- **To enable real delivery later** (after a domain + provider exist):
  1. Set `EMAIL_DELIVERY_ENABLED=true` **and** `EMAIL_MODE=smtp` with valid `SMTP_*`.
  2. The smtp path in `email.py` reuses the existing SMTP sender; rows flip to
     `sent`/`failed`. Consider replacing the synchronous send with a background
     worker/queue before high volume.
  3. Add HTML templates per `template_key` (currently plaintext subject/body).

## Intentionally deferred (no fake data)

These are **not** implemented because the data/flows don't exist yet — implementing
them now would require fake activity, which we don't do:

- `message_received` + unread-message digest — **no messaging backend** (the reply
  composer is demo-only).
- Review received / review request — **no reviews backend** (frontend-only display).
- Lifecycle / retention / FOMO (weekly job/talent digests, dormant reactivation,
  "saved job closing soon", "low applicants" nudge) — require **email preferences,
  an unsubscribe token, `last_active`, and a digest scheduler**, none of which exist
  yet. Add those first; only send digests backed by real activity.

## Known gaps to close before production email

- No per-user **email preferences** / **unsubscribe token** on `User`.
- No **delivery logs** beyond outbox status, no bounce handling.
- No **digest scheduler** / cron.
- `account_type` is a single value, so a user who is both Talent and Recruiter has
  one mode — decide how digests treat dual-role users.
