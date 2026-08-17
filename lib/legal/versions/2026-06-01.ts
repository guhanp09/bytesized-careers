/**
 * The legal wording published as version 2026-06-01.
 *
 * This file is an ARCHIVE. Once a version has been published and somebody has
 * accepted it, its bytes are the answer to "what did they agree to" — so
 * editing it is not an edit, it is a rewrite of history that no acceptance
 * record could detect. A checksum test fails if this content changes.
 *
 * Changing the wording means adding a NEW file with a new version and pointing
 * the registry at it. That is more work than editing this one, deliberately:
 * the extra step is where somebody notices that existing acceptances no longer
 * cover what is being shown.
 *
 * The text here was moved verbatim out of app/terms/page.tsx and
 * app/privacy/page.tsx. Nothing was reworded — this closes a provenance gap,
 * and writing new wording is counsel's work (LEGAL-002), not a side effect of
 * relocating a constant.
 */

export const VERSION = "2026-06-01";

export const TERMS_SECTIONS = [
  {
    title: "Use the marketplace responsibly",
    icon: "shield",
    body: "CreatorJobs helps hiring teams and talent discover each other. Do not post misleading listings, impersonate another person or business, scrape the platform, or use the service for spam or harassment.",
  },
  {
    title: "Listings, profiles, and work samples",
    icon: "file",
    body: "You are responsible for the accuracy of the jobs, talent listings, profiles, portfolio links, and messages you share. Only publish work samples you are allowed to share.",
  },
  {
    title: "Hiring and payment expectations",
    icon: "wallet",
    body: "Agree on scope, timeline, revisions, ownership, and payment terms before starting work. During beta, CreatorJobs may offer launch-free posting or listing access without processing payment.",
  },
  {
    title: "Reports and moderation",
    icon: "alert",
    body: "CreatorJobs may remove listings, profiles, or accounts that appear unsafe, misleading, abusive, or outside the marketplace purpose.",
  },
] as const;

export const PRIVACY_SECTIONS = [
  {
    title: "Information you provide",
    icon: "file",
    body: "CreatorJobs stores account details, profile fields, job posts, talent listings, applications, saved items, reports, and messages needed to operate the marketplace.",
  },
  {
    title: "Public marketplace information",
    icon: "globe",
    body: "Published jobs, talent listings, public profiles, and public work samples may be visible to other users and visitors. Keep private client information out of public descriptions and portfolio notes.",
  },
  {
    title: "Service operations",
    icon: "settings",
    body: "We use authentication, email delivery, logs, rate limiting, and health checks to run the service, protect accounts, and diagnose issues.",
  },
  {
    title: "Your choices",
    icon: "sliders-horizontal",
    body: "You can edit profile details, manage listings, remove saved items, and report unsafe listings. During beta, contact support for account or data requests.",
  },
] as const;
