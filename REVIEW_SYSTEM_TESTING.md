# Review System Testing

CreatorJobs reviews are tied to mutually acknowledged work, not profile visits or messages. Recruitment status and engagement status are separate: `Hired`/`Accepted` creates the work context, then both participants confirm the start and outcome.

## Safe local seed

From `backend/`:

```bash
APP_ENV=development .venv/bin/python scripts/seed_staging_demo.py --confirm development
```

The command is idempotent and inserts only deterministic demo records. It refuses `APP_ENV=production`. Do not add `--reset` unless you intentionally want to replace only seed-owned demo rows.

Local persona login is available through the existing dev persona tools. The useful review personas are:

- `Recruiter — active jobs` (`dev-recruiter`): owns all seeded review engagements.
- `Talent — incomplete profile` (`dev-talent-wip`): has start-pending, completion-pending, and pre-start-cancelled examples.
- `Both sides user` (`dev-both-sides`): has active and completed review-opportunity examples.
- `Notifications test user` (`dev-notify`): has blind-submitted, reciprocal-published, and ended-after-start examples.

## Seeded states

Open `/applications?view=inbox` and select hired conversations to inspect:

1. Active engagement
2. Start confirmation pending
3. Completion confirmation pending
4. Completed and review-eligible
5. One blind review awaiting publication
6. Reciprocal published reviews
7. Cancelled before start
8. Ended after work began

Lifecycle events appear as centered system updates. The selected conversation shows the compact engagement status row; Pipeline cards remain recruitment-focused.

Open `/you?tab=reviews` and switch profile mode:

- **About you** shows only published reviews for that profile mode.
- **Your feedback** shows available, awaiting-publication, published, and expired feedback states.

## Two-account walkthrough

For an interactive test, use two separate authenticated browser sessions (for example, a normal window and a private window):

1. Talent applies to a job, or a recruiter sends a hiring request.
2. The receiving side moves the application to `Hired` or accepts the hiring request.
3. Either side selects **Start work** in Inbox.
4. The other side selects **Confirm start**.
5. Either side selects **Update outcome**, then **Work completed** or **Ended after start**.
6. The other side confirms. Choosing **Needs attention** returns the work to Active and creates no review eligibility.
7. The first participant submits feedback. It must remain absent from public profiles and the other participant must not be told it was submitted.
8. The second participant submits feedback. Both reviews publish and role-specific profile aggregates update.

Expected in-app notifications include start requested, work started, completion requested, needs attention (when used), outcome confirmed, feedback available, and feedback published. Email is intentionally not part of this version.

## Hosted staging

Hosted staging uses real backend data and must not expose dev persona or data-source controls. The deterministic seed provides public published-review examples, but an interactive lifecycle test must use two real authenticated staging accounts. Do not deploy a shared persona password or public persona switcher.

The staging seed automatically replaces every deterministic persona password with an unlogged random credential after seeding. The public examples remain visible, but the development persona password cannot be used to sign in on staging.

## Automated checks

```bash
cd backend
APP_ENV=test .venv/bin/python -m pytest tests/test_engagement_reviews.py tests/test_staging_seed_integrity.py

cd ..
node --test tests/*.test.mjs
```
