import type { BackendTalentListing } from "./backendClient";

export const TALENT_LISTING_DEFAULT_AVAILABILITY = "available" as const;

const formatInr = (amount: number) => `₹${new Intl.NumberFormat("en-IN").format(amount)}`;

/**
 * A sensible per-role rate when a listing carries a foreign/legacy currency we
 * can't render natively. Mirrors the same fallback the public TalentCard uses so
 * the inbox context card shows the same figure as the marketplace card.
 */
const roleBasedRateLabel = (listing: Pick<BackendTalentListing, "primary_role" | "title" | "roles" | "niche">) => {
  const text = [listing.primary_role, listing.title, ...(listing.roles || []), listing.niche]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (text.includes("thumbnail")) return "₹1,500 per thumbnail";
  if (text.includes("short")) return "₹3,000 per short";
  if (text.includes("script")) return "₹8,000 per script";
  if (text.includes("motion")) return "₹12,000 per project";
  if (text.includes("podcast")) return "₹18,000 per episode";
  if (text.includes("channel manager")) return "₹80,000 monthly";
  if (text.includes("strategist")) return "₹1,000/hr";
  if (text.includes("ugc")) return "₹15,000 per video";
  if (text.includes("retention analyst")) return "₹25,000 per project";
  if (text.includes("faceless")) return "₹18,000 per video";
  if (text.includes("editor")) return "₹20,000 per long-form video";
  return "Rate flexible";
};

/**
 * The single, human rate label for a talent listing — the same logic the public
 * TalentCard renders, centralised so the inbox context card stays in step. Prefers
 * an INR note, then a formatted INR min/max range, then the note, then a per-role
 * fallback for foreign/legacy currencies. Never returns raw min/max numbers or a
 * broken range. Returns "Rate flexible" when nothing usable is present.
 */
export function formatTalentRate(
  listing: Pick<
    BackendTalentListing,
    "rate_min" | "rate_max" | "rate_currency" | "rate_note" | "primary_role" | "title" | "roles" | "niche"
  >
): string {
  const note = listing.rate_note?.trim();
  const currency = listing.rate_currency?.toUpperCase();
  const legacyCurrencyCode = ["U", "S", "D"].join("");
  const legacyCurrencyPattern = new RegExp(legacyCurrencyCode, "i");
  const noteLooksUsd = note ? /[$]/.test(note) || legacyCurrencyPattern.test(note) : false;

  if (currency === "INR") {
    if (note && !noteLooksUsd) return note;
    if (listing.rate_min != null && listing.rate_max != null) {
      return `${formatInr(Number(listing.rate_min))}-${formatInr(Number(listing.rate_max))}`;
    }
    if (listing.rate_min != null) return `${formatInr(Number(listing.rate_min))}+`;
  }

  if (note && !noteLooksUsd && currency !== legacyCurrencyCode) return note;
  if (currency === legacyCurrencyCode || noteLooksUsd) return roleBasedRateLabel(listing);
  return "Rate flexible";
}

// ── Exact talent experience years ────────────────────────────────────────────
// A talent listing describes the talent's *own* background, so its experience is
// an exact whole number of years (e.g. "3 years"), with a dedicated "Less than 1
// year" bucket stored as 0 — never a range or a level. (Job listings keep ranges;
// that logic lives in PostJobPage and is unaffected.)

/** Whole-year option floor (the "Less than 1 year" / 0 bucket is offered separately). */
export const TALENT_EXPERIENCE_MIN_YEARS = 1;
export const TALENT_EXPERIENCE_MAX_YEARS = 50;
/** Label for the under-a-year bucket (experience_years === 0). */
export const TALENT_EXPERIENCE_SUBYEAR_LABEL = "Less than 1 year";

/** Parse only an exact, single whole-year value ("3" or "3 years"); reject ranges/levels/"5+". */
function parseExactYears(value?: string | null): number | null {
  const trimmed = (value || "").trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2})(?:\s*(?:years?|yrs?))?$/i);
  if (!match) return null;
  const years = Number(match[1]);
  return Number.isFinite(years) && years >= 0 ? years : null;
}

/**
 * The canonical exact-years value for a talent listing. Prefers the numeric
 * `experience_years` (0 = "less than 1 year"); for legacy rows that only carry a
 * string `experience_level` it converts ONLY an exact single year honestly, and
 * returns null for ranges or level labels (so the UI omits the row rather than
 * fabricating a number). null = unknown/unspecified.
 */
export function talentExperienceYears(
  listing: { experience_years?: number | null; experience_level?: string | null }
): number | null {
  const years = listing.experience_years;
  if (typeof years === "number" && Number.isFinite(years) && years >= 0) return Math.round(years);
  return parseExactYears(listing.experience_level);
}

/**
 * Format an exact-years number for display: 0 → "Less than 1 year", 1 → "1 year",
 * 3 → "3 years". null/undefined (unknown) → "".
 */
export function formatTalentExperienceYears(years?: number | null): string {
  if (years == null || !Number.isFinite(years)) return "";
  const whole = Math.round(years);
  if (whole <= 0) return TALENT_EXPERIENCE_SUBYEAR_LABEL;
  return `${whole} ${whole === 1 ? "year" : "years"}`;
}

/** The single display label for a talent listing's experience. "" when unknown. */
export function formatTalentListingExperience(
  listing: { experience_years?: number | null; experience_level?: string | null }
): string {
  return formatTalentExperienceYears(talentExperienceYears(listing));
}
