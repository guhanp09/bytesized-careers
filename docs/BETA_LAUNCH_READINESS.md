# CreatorJobs Beta Launch Readiness

Date: 2026-06-02

## Beta Data And Staging Readiness

- Staging/demo may use realistic creator-economy seed data for jobs, talent listings, public profiles, and work samples.
- Production must not use mock or demo inventory unless a separate demo mode is explicitly enabled outside production.
- All visible mock/staging rates should use INR examples such as `₹20,000 per long-form video`, `₹1,500 per thumbnail`, `₹3,000 per short`, and `₹0 during beta`.
- Demo content should cover YouTube, Shorts, podcasts, faceless channels, education, finance, gaming, tech, and creator-led teams.

## Final Copy Rules

- Use `Talent listing`, `Create talent listing`, `Work samples`, `Report listing`, and `Safety & expectations`.
- Use `content creator` when referring to actual content-producing people or channels.
- Use `talent`, `freelancer`, or role names for job-seeking professionals.
- Avoid `Proof`, `Post availability`, `Enlist as talent`, fake reviews, fake ratings, fake response metrics, fake verification, and USD examples.
- Keep beta/free copy clear: `Free during beta`, `No payment required right now`, and `₹0 during beta`.

## Support And Safety Basics

- `/support` provides the beta support path.
- Job and talent detail pages should keep `Report listing` visible.
- Safety copy should remind users to agree on scope, timeline, revisions, and payment terms before work starts.
- Founder/operators should review reports daily during beta.

## Legal Basics

- `/terms` and `/privacy` exist as beta placeholders.
- Both pages are marked for legal review and should not be treated as final legal advice.
- A human legal review is required before a broader public launch.

## Manual QA Checklist

- Signup with email/password.
- Login and logout.
- Email verification request and resend.
- Password reset request and confirmation.
- Edit owner profile.
- View public profile.
- Browse jobs and open a job detail page.
- Apply to a job with a proposal.
- Save, unsave, and share a job.
- Report a job listing.
- Browse talent and open a talent listing detail page.
- Click a talent name to public profile.
- Invite/contact talent.
- Save, unsave, and share a talent listing.
- Report a talent listing.
- Post a job, save draft, resume draft, and publish through launch-free checkout.
- Create a talent listing, save draft, resume draft, and publish through launch-free checkout.
- Verify Activity tabs show applications, interests, drafts, and updates.
- Verify Saved Jobs and Saved Talent tabs.
- Verify Search empty, results, and no-results states.
- Verify Notifications empty, read/unread, and mark-read behavior.
- Verify owner controls appear only for owned jobs/listings.
- Verify mobile layouts for home, jobs, job detail, talent, talent detail, post flows, saved, activity, search, notifications, profile, auth, and checkout.
- Verify backend-down states do not show fake production data.
- Verify production boot fails with placeholder secrets.

## Founder/Admin Beta Checklist

- Confirm support inbox ownership and response SLA.
- Confirm Google OAuth redirect URLs for staging and production.
- Confirm SMTP sender/domain verification.
- Confirm Redis/rate-limit posture.
- Confirm database backups and rollback plan.
- Review open reports daily.
- Review new jobs and talent listings daily during beta.
- Remove or archive unsafe/misleading listings.
- Seed initial staging/demo inventory only outside production.
- Monitor frontend and backend health checks.
- Monitor auth, email, invite/contact, report, and checkout/free-beta errors.
- Keep a daily note of user friction, broken links, confusing copy, and support themes.

## Beta Readiness Verdict

CreatorJobs is beta-ready when production env validation passes, staging manual QA passes, SMTP and support inboxes are confirmed, the production database is migrated, and founder/operator review routines are active.
