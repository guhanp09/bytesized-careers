# Application And Inbox Testing

This guide covers the persisted job-application, hiring-request, Inbox, and
messaging workflows. It uses the local QA persona harness described in
`QA_PERSONA_TESTING.md`; it never uses Vercel, Render, Neon, or mock data.

## Product Rules

### One durable response per listing

- A Talent user can create one application for one immutable job listing.
- A recruiter can create one hiring request for one immutable talent listing.
- Retrying, double-clicking, or revisiting returns the original record. It does
  not create another application/request, conversation, or notification, and it
  does not rewrite the original opening response.
- Rejected, withdrawn, and archived records remain history and do not unlock a
  second response to the same listing. A materially new opportunity should be a
  new listing.

This rule keeps recruiter pipelines coherent and makes retries safe. The
database uniqueness constraints and transaction handling enforce it; the UI is
not the security boundary.

### Application to Inbox

Creating an application or hiring request also creates its one-to-one
conversation in the same transaction. The source record ID is the Inbox thread
ID used by deep links.

The opening thread contains:

1. A trusted CreatorJobs event describing what happened.
2. The sender's structured first-message answers, when the listing requested
   them.
3. The sender's conversational note only when it is not already represented by
   a structured fit-note answer.

No filler user message is required when a listing has no first-message
requirements. The event itself makes the new application/request discoverable
and explains why the thread exists.

### Modes and directions

`Talent` mode contains:

- sent job applications
- received hiring requests

`Recruiter` mode contains:

- received job applications
- sent hiring requests/outreach

The `All`, workflow-specific direction, and `Archived` filters operate only
inside the active mode. A direct link uses:

```text
/applications?view=inbox&mode=talent|recruiter&thread=<application-or-request-id>
```

Notification links choose the recipient's mode, not the sender's mode.

## Messaging Guarantees

- Only the two source-record participants can read or send in a conversation.
- User messages are trimmed, non-empty, and limited to 5,000 characters.
- Each send carries a client-generated UUID. Retrying the same content with the
  same UUID returns the existing message and does not duplicate its notification.
- A reused UUID with different content is rejected.
- Message order uses the persisted timestamp and ID.
- Sending marks the thread read for the sender. Opening it marks incoming
  messages read for that viewer.
- Active applications, hired work, and accepted hiring requests stay open.
- Rejected, declined, withdrawn, or archived source records are closed to
  ordinary messages. Trusted lifecycle/status events can still be added only by
  their server-side workflow.
- A suspended participant closes new ordinary messages.
- A closed job does not erase an existing application conversation. The source
  application status controls that historical thread.

The Inbox refreshes unread counts and the selected conversation with lightweight
polling. A failed send keeps the draft visible and retryable; it never renders a
false successful bubble.

## Private Notes

- Notes on a received application belong only to that job's recruiter/owner.
- Notes on a received hiring request belong only to that talent listing's owner.
- The sender cannot list, create, or delete those notes through the API.
- Multiple notes persist in backend history, newest first. Removing the newest
  restores the previous note as the pipeline summary.
- Browser storage is only a fast display cache in live mode. Clearing it and
  refreshing still restores the backend history.
- Explicit Sample data mode remains local-only and is visually labelled.

## Fast Automated Regression Check

From the repository root:

```bash
npx tsc --noEmit
npm run lint
npm run build
node --test tests/*.test.mjs
cd backend && APP_ENV=test .venv/bin/python -m pytest
cd .. && npm run test:e2e:qa
```

The QA browser configuration starts a disposable SQLite backend. Do not run the
database suites in parallel against the same SQLite file.

## Manual Two-Sided Walkthrough

Start the disposable backend and frontend using the exact commands in
`QA_PERSONA_TESTING.md`, then sign in as the local QA controller.

### Fresh job application

1. Open the QA drawer and restore `Inbox and pipeline` using `RESTORE INBOX`.
2. Act as `Priya Nair`.
3. Open Jobs and select `Thumbnail designer for a gaming channel`.
4. Click `Apply`, complete the requested rate, portfolio, and fit-note answers,
   then submit.
5. Click the success action. Confirm it opens Talent Inbox on that exact thread.
6. Return to the job. Confirm the CTA now says `Open conversation` and does not
   reopen the application form.
7. Return to the controller, act as `Finance Simplified`, and open Recruiter
   Inbox. Confirm Priya and the correct job appear.
8. Reply to Priya. Switch back to Priya and confirm the reply arrives.
9. As Finance Simplified, add two private notes, clear browser local storage,
   and refresh. Both notes must return. Priya must never see the note panel.

### Fresh hiring request

1. Restore `Hiring requests` using `RESTORE REQUESTS`.
2. Act as `Finance Simplified`, open Talent, and select Priya's retention-editor
   listing.
3. Click `Hire Me`, complete the requested project information, and submit.
4. Confirm Recruiter Inbox opens the exact request and the listing now offers
   `Open conversation` instead of another request form.
5. Act as Priya, open Talent Inbox, and confirm `Finance Simplified` is the
   counterparty with the same structured answers.
6. Reply and add a private note. Switch back to Finance Simplified: the reply is
   visible, the private note is not.

## Edge-Case Checklist

- Submit twice rapidly: one source record, one thread, one creation notification.
- Refresh after submit: relationship-aware CTA remains correct.
- Retry a failed message: one persisted message and one recipient notification.
- Send blank/whitespace: rejected.
- Send multiline text, URL, emoji, and punctuation: preserved.
- Send over 5,000 characters: rejected by the API/UI limit.
- Open another user's conversation or private-note endpoint: `403`.
- Withdraw as sender: succeeds unless hired/contacted; manager cannot forge it.
- Reject/decline/archive as manager: thread becomes read-only.
- Move to hired/accepted: thread remains available for ongoing work.
- Suspend either participant: new messages are rejected.
- Backend unavailable: show a load/retry error, never an empty or silent sample
  Inbox. Use `?demo=1` only when intentionally reviewing Sample data.
- Leave and return: active workspace shape, dock thread, and Inbox selection
  restore without default-thread races.

## Weekly Release Regression

Before releasing changes to applications or messaging, run the focused backend
files and both browser modes:

```bash
cd backend
APP_ENV=test .venv/bin/python -m pytest \
  tests/test_applicant_management.py \
  tests/test_marketplace_core.py \
  tests/test_marketplace_withdraw.py \
  tests/test_messaging.py
cd ..
npx playwright test tests/e2e/you-applications.spec.ts \
  tests/e2e/applications-pipeline.spec.ts
npx playwright test -c playwright.qa.config.ts -g \
  "two online personas|fresh job application|fresh hiring request"
```
