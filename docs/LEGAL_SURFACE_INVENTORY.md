# Legal surface inventory (LEGAL-001)

**Purpose.** Make external legal review concrete and bounded. This document
inventories what the software actually does, so counsel is reviewing behaviour
rather than guessing at it, and so the questions that need a human decision are
listed in one place instead of being discovered one at a time.

**This document contains no legal wording and chooses no retention period.**
Writing the text and deciding how long data is kept are not engineering
decisions, and a plausible-looking answer produced here would be indistinguishable
from a decided one. Every such item is marked and left open.

Each row is classified as:

- `TECHNICAL CONTROL` — implemented and tested in this repository
- `NEEDS LEGAL COPY` — the mechanism exists; the wording does not
- `NEEDS PRODUCT DECISION` — someone with authority must choose
- `NEEDS COUNSEL REVIEW` — behaviour is implemented and should be reviewed for adequacy

---

## 1. Terms and Privacy documents

| Item | Status | Detail |
|---|---|---|
| Terms page exists | `NEEDS LEGAL COPY` | `app/terms/page.tsx` — beta summary copy, six sections, written by the product team. Not reviewed. |
| Privacy page exists | `NEEDS LEGAL COPY` | `app/privacy/page.tsx` — same shape and same status. |
| Document versioning | `TECHNICAL CONTROL` | `backend/app/core/legal_documents.py` declares `terms_of_service` and `privacy_policy` at version `2026-06-01`. Versions live in code so a running server cannot reference wording it does not ship. |
| Acceptance records | `TECHNICAL CONTROL` | Migration `0065`. One row per (user, document, version); written, never updated. A superseded acceptance counts for nothing, so changed terms require fresh agreement. |
| Acceptance API | `TECHNICAL CONTROL` | `GET /api/v1/me/legal`, `POST /api/v1/me/legal/accept`. The client names documents; the **server** chooses the version. |

### Open finding — the pages carry no version

The rendered Terms and Privacy pages have **no version marker**, while
acceptance records are stored against `2026-06-01`. Nothing currently ties the
wording a person accepted to the wording they were shown.

- `NEEDS PRODUCT DECISION` — how a version is surfaced to the reader (footer
  line, "last updated" date, or a permalinked archive of each version).
- `NEEDS COUNSEL REVIEW` — whether an accepted version must remain retrievable,
  which decides whether superseded wording has to be archived rather than
  replaced.

This is recorded rather than fixed: the answer determines the implementation.

---

## 2. What a person can control

| Item | Status | Detail |
|---|---|---|
| Notification consent | `TECHNICAL CONTROL` | Migration `0066`. Opt-out rows; absence means subscribed. |
| Essential mail cannot be switched off | `TECHNICAL CONTROL` / `NEEDS COUNSEL REVIEW` | Transactional and authentication mail is always sent, because unsubscribing from a password reset locks someone out of their own account. Counsel should confirm this categorisation is defensible in the target jurisdiction. |
| Unsubscribe link | `TECHNICAL CONTROL` | HMAC-signed per (user, category), **no expiry** (it must work from a two-year-old email), POST-only so a mail client prefetch cannot unsubscribe anyone. |
| Data export | `TECHNICAL CONTROL` | `build_export()`. Contains the person's own messages only — the other participant's words are theirs. No credentials; every field named by hand rather than reflected. |
| Export delivery | `NEEDS PRODUCT DECISION` | Reauthentication before export, an expiring download link, and async archive generation are not built. |
| Deletion request | `TECHNICAL CONTROL` | Migration `0067`. Recorded, account hidden immediately, all sessions revoked, cancellable. |
| Deletion vs suspension | `TECHNICAL CONTROL` | Migration `0068`. Independent states; neither cancels the other. A deletion request cannot pre-empt administrative suspension. |
| **Erasure** | `NEEDS PRODUCT DECISION` + `NEEDS COUNSEL REVIEW` | **Not built.** Requires a retention period, which is a legal decision. See §5. |

---

## 3. Enforcement and accountability

| Item | Status | Detail |
|---|---|---|
| Blocking is server-side | `TECHNICAL CONTROL` | `account_block()` is the single combined read; tested through tokens issued **before** the block, across posting, applying, messaging, login, public profile and public listing. |
| Administrative suspension | `TECHNICAL CONTROL` | Suspend/unsuspend with reason, actor, session revocation, audit entry. |
| Audit log | `TECHNICAL CONTROL` | `AdminAuditLog`, append-only — enforced by a structural test, not only documented. Actor reference is SET NULL, so an administrator cannot erase their trail by deleting their account. |
| Audit retention | `NEEDS PRODUCT DECISION` | How long entries are kept is undecided; the append-only invariant means any future purge is an explicit decision rather than a quiet cleanup. |
| Moderation reports | `TECHNICAL CONTROL` | `Report` model with category, status and admin note. |
| Support tickets | `TECHNICAL CONTROL` | Migration `0069`. Internal only; staff log requests arriving by email. |
| Support intake | `NEEDS PRODUCT DECISION` | There is deliberately **no** customer-facing intake surface. Whether beta needs one is a product question. |

---

## 4. Third parties that receive data

Each of these is a processor relationship that a privacy policy has to name.
Listed with what actually crosses the boundary, from the code.

| Processor | Configured by | Data that leaves | Status |
|---|---|---|---|
| AI provider (job import) | `OPENAI_API_KEY`, `OPENAI_MODEL` | Source job text the recruiter supplied, plus the schema and rules for filling it. **No account, email, session or internal id** — pinned by a test that fails if the payload grows. `store=False` on every call. | `NEEDS LEGAL COPY` (must be named); `TECHNICAL CONTROL` (minimisation) |
| Email provider (SMTP) | `SMTP_*` | Recipient address, subject, body of transactional and notification mail. | `NEEDS LEGAL COPY` |
| Email provider webhooks | `EMAIL_WEBHOOK_SECRET` | Inbound bounce/complaint reports; signature-verified, replay-resistant. | `TECHNICAL CONTROL` |
| Google (sign-in) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth identity; verified id-token claims. Credentials encrypted at rest. | `NEEDS LEGAL COPY` |
| Google (YouTube, optional) | incremental consent | Channel metadata, only with explicit separate consent. | `NEEDS LEGAL COPY` |
| Media storage | `MEDIA_PUBLIC_BASE_URL`, `MEDIA_ROOT` | Avatars and banners. Currently the application filesystem; an object store is `BLOCKED_EXTERNAL`. EXIF, including GPS, is stripped before storage. | `TECHNICAL CONTROL`; provider `NEEDS PRODUCT DECISION` |
| Realtime broker | `REALTIME_BUS`, `REDIS_URL` | **Nothing today** — the process-local bus is the only implemented adapter, and production refuses it unless explicitly acknowledged. A future broker would carry event hints (ids and counts), not message bodies. | `NEEDS PRODUCT DECISION` (whether to adopt one) |

---

## 5. Open questions that engineering must not answer

These are recorded so nobody has to rediscover them, and left open because a
number or a sentence invented here would be indistinguishable from a decided one.

| Question | Blocked as | Why it cannot be answered here |
|---|---|---|
| How long is data retained after a deletion request? | `BLOCKED_PRODUCT_DECISION` / `BLOCKED_EXTERNAL` | Depends on dispute windows, fraud investigation, tax and statutory obligations in the target jurisdiction. A plausible thirty or ninety days would look decided. |
| What survives erasure, and in what form? | `BLOCKED_PRODUCT_DECISION` | Messages are half of another person's conversation; applications are half of a recruiter's decision. Anonymisation versus deletion is a policy choice. |
| Is a legal hold ever required, and who may set one? | `BLOCKED_EXTERNAL` | Needs counsel. |
| How long are audit entries kept? | `BLOCKED_PRODUCT_DECISION` | Accountability argues for long; data minimisation argues for short. |
| Is the essential/optional mail split defensible? | `BLOCKED_EXTERNAL` | Implemented; needs review, not invention. |
| Must superseded legal wording remain retrievable? | `BLOCKED_EXTERNAL` | Decides whether versions are archived or replaced. |
| Final Terms and Privacy wording | `BLOCKED_EXTERNAL` | LEGAL-002. Counsel work. |
| Effective date and jurisdiction | `BLOCKED_EXTERNAL` | Counsel work. |

---

## 6. What this inventory does not claim

- No compliance certification of any kind.
- No statement that the current implementation satisfies any specific regulation.
- No approval of the existing beta copy on the Terms or Privacy pages.
- No retention period.

The technical controls above are implemented and tested. Whether they are
*sufficient* is precisely the external review this document exists to bound.
