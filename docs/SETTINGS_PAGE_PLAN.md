# CreatorJobs Settings Page Plan

## Summary

CreatorJobs should have a dedicated authenticated `/settings` page that complements, rather than replaces, the `/you` profile workspace. Settings should manage account, privacy, notification, marketplace, security, data, and future billing preferences. Rich profile content such as bio, work samples, jobs, and talent listing content should stay in `/you`, `/post-job`, and `/post-talent`.

Current audit:

- No existing `/settings` route.
- No dedicated Account page.
- The logged-in profile dropdown lives in `components/Header.tsx`.
- The dropdown currently routes `Account` to `/you`, `Public profile` to `/u/[username]`, `Support` to `/support`, and `Logout` through NextAuth.
- Existing account/profile data comes from `getMe`, `getMyProfile`, `privacy_settings`, social connections, and session fields.

## Recommended Structure

Use a dedicated `/settings` page with a dark, premium two-column layout:

- Desktop: left category nav, right grouped settings panels.
- Mobile: stacked panels with a compact top section nav.
- Rows should have a title, short description, current status or action, and optional `Coming soon` status.
- Disabled/future rows should be visibly unavailable without pretending to work.
- Destructive actions should be visually separated.

Categories:

1. **Account**
   - Active now: display name, username, email, account type, login method, connected accounts summary.
   - Link profile/account edits to `/you`.
   - Future: phone, password, account status, sign out all devices.
   - Cross-link account deletion to Privacy, Safety & Data.

2. **Profile & Visibility**
   - Active now: current `privacy_settings` display, public profile preview, edit profile link.
   - Future: talent profile visibility, recruiter profile visibility, search discovery, work sample visibility.

3. **Notifications**
   - Active now: link to `/notifications`.
   - Future: email and in-app toggles for applications, hiring requests, messages, saved alerts, recommendations, drafts, profile completion, and product updates.

4. **Marketplace Preferences**
   - Active now: links to `/post-job`, `/post-talent`, `/applications`, `/drafts`, and `/you`.
   - Future: default hiring identity, default job visibility, screening preferences, who can send hiring requests, job recommendation preferences, preferred categories/platforms/work modes.

5. **Payments, Billing & Payouts**
   - Present now as coming soon.
   - Future: UPI ID, payment methods, billing details, GST/invoice details, payouts, invoices, receipts, platform fees, subscriptions or featured placement billing.
   - Copy must clearly say CreatorJobs beta does not require a payment method.

6. **Privacy, Safety & Data**
   - Active now: Terms and Privacy links.
   - Future: blocked users, message privacy, reported interactions, data export, deactivate account.
   - Mandatory: delete account destructive flow.

7. **Security**
   - Active now: login method and connected OAuth/account summary.
   - Future: password, two-factor authentication, sessions/devices, login history, revoke OAuth, sign out all devices.

8. **Preferences**
   - Active now: timezone, region, and currency display if available.
   - Future: theme, accent color, language, date/time format, default currency.

9. **Support & Legal**
   - Active now: Support, Terms, Privacy links.
   - Future: bug report, help center, community guidelines, cancellation/refund policy.

## Dropdown Plan

Add a `Settings` item to the logged-in profile dropdown:

- Icon: existing `Icon name="settings"`.
- Route: `/settings`.
- Placement: after `Public profile`, before `Support`.
- Preserve existing Account, Public profile, Support, and Logout behavior.

## Backend/Data Requirements

Phase 1 should reuse current data:

- NextAuth session for email/name/account type.
- `getMyProfile` for username, display name, social connections, timezone, and `privacy_settings`.
- Gracefully render the shell if profile fetch fails.

Later backend support:

- `GET /me/settings` aggregate settings endpoint.
- `PATCH /me/settings/privacy`.
- `PATCH /me/settings/notifications`.
- `PATCH /me/settings/marketplace-preferences`.
- `POST /me/data-export`.
- `POST /me/deactivate`.
- `DELETE /me` or a scheduled account deletion endpoint.

## Account Deletion Flow

Account deletion belongs in **Privacy, Safety & Data**, with a cross-link from **Account**.

Required future UX:

- Separate danger panel.
- Explain consequences before action.
- Require typed confirmation using username or email.
- Require re-authentication when backend support exists.
- Consider a reversible deactivation flow separately.

Backend policy must define:

- Immediate vs scheduled deletion.
- Public profile removal or anonymization.
- What happens to active jobs, talent listings, drafts, saved items, applications, messages, reviews, moderation records, and payment records.
- Retention requirements for legal, safety, audit, and payment records.

## Implementation Phases

1. **Frontend shell**
   - Add dropdown item.
   - Add authenticated `/settings` page.
   - Render all planned sections with active links and disabled future rows.
   - Add focused E2E tests for dropdown and auth redirect.

2. **Functional profile/privacy settings**
   - Wire existing `privacy_settings` to real toggles.
   - Add save/error states with existing backend auth handling patterns.

3. **Notifications and marketplace preferences**
   - Add backend-backed notification settings.
   - Add hiring/talent defaults without duplicating profile editing.

4. **Payments, security, and data controls**
   - Add billing/payout infrastructure.
   - Add sessions/devices and connected-account management.
   - Add data export, deactivation, and account deletion.

## Acceptance Criteria

- Dropdown shows `Settings` for authenticated users.
- Clicking `Settings` opens `/settings`.
- Signed-out `/settings` redirects to `/auth?mode=login&next=/settings`.
- `/settings` renders Account, Profile & Visibility, Notifications, Marketplace Preferences, Payments, Privacy/Safety/Data, Security, Preferences, and Support/Legal.
- Future settings are clearly disabled or marked `Coming soon`.
- Account deletion appears as a planned destructive section, but is not functional until backend support exists.
- Existing Account, Public profile, Support, and Logout dropdown behavior remains unchanged.
- Desktop and mobile layouts do not horizontally overflow.
