import type { BackendTalentListing } from "./backendClient";

export const TALENT_LISTING_DEFAULT_AVAILABILITY = "available" as const;

type TalentRateSource = Pick<
  BackendTalentListing,
  "rate_min" | "rate_max" | "rate_currency" | "rate_note"
>;

const finiteRate = (value?: number | null) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const formatRateNumber = (amount: number) =>
  new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);

const formatTalentMoney = (amount: number, currency?: string | null) => {
  const code = currency?.trim().toUpperCase() || "";
  if (!code) return formatRateNumber(amount);
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: code,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  } catch {
    // Preserve an unsupported legacy code verbatim. Guessing a known currency
    // or silently changing it to INR would be a materially different price.
    return `${code} ${formatRateNumber(amount)}`;
  }
};

/**
 * The single human rate label for a talent listing. Notes are the creator's
 * explicit pricing intent (including "Flexible", "Contact for pricing" and
 * "Unpaid") and therefore remain verbatim. Numeric rates retain their stored
 * currency; missing currency is disclosed instead of being silently treated as
 * INR. An absent rate is unknown, not flexible.
 */
export function formatTalentRate(listing: TalentRateSource): string {
  const note = listing.rate_note?.trim();
  if (note) return note;

  const minimum = finiteRate(listing.rate_min);
  const maximum = finiteRate(listing.rate_max);
  if (minimum === null && maximum === null) return "Rate not specified";

  const suffix = listing.rate_currency?.trim() ? "" : " (currency not specified)";
  if (minimum !== null && maximum !== null) {
    if (minimum === maximum) return `${formatTalentMoney(minimum, listing.rate_currency)}${suffix}`;
    if (minimum > maximum) {
      return `${formatTalentMoney(minimum, listing.rate_currency)} minimum · ${formatTalentMoney(
        maximum,
        listing.rate_currency,
      )} maximum${suffix}`;
    }
    return `${formatTalentMoney(minimum, listing.rate_currency)}–${formatTalentMoney(
      maximum,
      listing.rate_currency,
    )}${suffix}`;
  }
  if (minimum !== null) return `${formatTalentMoney(minimum, listing.rate_currency)}+${suffix}`;
  return `Up to ${formatTalentMoney(maximum as number, listing.rate_currency)}${suffix}`;
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
