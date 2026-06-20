export const TALENT_LISTING_DEFAULT_AVAILABILITY = "available" as const;

const EXPERIENCE_ERROR = "Use a format like 0–1, 2, 3–4, or 8+.";

const LEGACY_EXPERIENCE_MAPPINGS: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /\b(entry|beginner|novice)\b|less than\s*1/i, value: "0–1 years" },
  { pattern: /\bjunior\b/i, value: "1–2 years" },
  { pattern: /\bmid(?:\s*|-)?level\b|\bintermediate\b/i, value: "2–4 years" },
  { pattern: /\bsenior\b/i, value: "4–6 years" },
  { pattern: /\b(lead|expert|principal|staff)\b/i, value: "6+ years" },
];

const formatSingleYears = (value: number) => `${value} ${value === 1 ? "year" : "years"}`;
const formatRangeYears = (min: number, max: number) => (min === max ? formatSingleYears(min) : `${min}–${max} years`);
const formatPlusYears = (value: number) => `${value}+ years`;

const normalizeDashes = (value: string) => value.replace(/[–—−]/g, "-");
const digitsOnly = (value: string) => value.replace(/[^\d]/g, "");

export function normalizeTalentExperienceInput(
  rawValue: string,
  { allowLegacyAliases = false }: { allowLegacyAliases?: boolean } = {}
): { value: string | null; error: string | null } {
  const trimmed = rawValue.trim();
  if (!trimmed) return { value: null, error: null };

  const normalized = normalizeDashes(trimmed).replace(/\s+/g, " ");

  const rangeMatch = normalized.match(/^(\d+)\s*-\s*(\d+)(?:\s*(?:years?|yrs?))?$/i);
  if (rangeMatch) {
    const min = Number(rangeMatch[1]);
    const max = Number(rangeMatch[2]);
    if (max < min) return { value: null, error: EXPERIENCE_ERROR };
    return { value: formatRangeYears(min, max), error: null };
  }

  const plusMatch = normalized.match(/^(\d+)\s*\+(?:\s*(?:years?|yrs?))?$/i);
  if (plusMatch) {
    return { value: formatPlusYears(Number(plusMatch[1])), error: null };
  }

  const singleMatch = normalized.match(/^(\d+)(?:\s*(?:years?|yrs?))?$/i);
  if (singleMatch) {
    return { value: formatSingleYears(Number(singleMatch[1])), error: null };
  }

  if (allowLegacyAliases) {
    const legacyMapping = LEGACY_EXPERIENCE_MAPPINGS.find(({ pattern }) => pattern.test(trimmed));
    if (legacyMapping) return { value: legacyMapping.value, error: null };
  }

  return { value: null, error: EXPERIENCE_ERROR };
}

export function formatTalentExperience(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  const normalized = normalizeTalentExperienceInput(trimmed, { allowLegacyAliases: true });
  return normalized.value || trimmed;
}

export function parseTalentExperienceBounds(value?: string | null): { min: string; max: string } {
  const formatted = formatTalentExperience(value);
  if (!formatted) return { min: "", max: "" };

  const plusMatch = formatted.match(/^(\d+)\+\s+years?$/i);
  if (plusMatch) {
    return { min: digitsOnly(plusMatch[1]), max: "" };
  }

  const rangeMatch = formatted.match(/^(\d+)\s*[–-]\s*(\d+)\s+years?$/i);
  if (rangeMatch) {
    return { min: digitsOnly(rangeMatch[1]), max: digitsOnly(rangeMatch[2]) };
  }

  const singleMatch = formatted.match(/^(\d+)\s+years?$/i);
  if (singleMatch) {
    const years = digitsOnly(singleMatch[1]);
    return { min: years, max: years };
  }

  return { min: "", max: "" };
}

export function formatTalentExperienceBounds(minValue: string, maxValue: string) {
  const min = digitsOnly(minValue);
  const max = digitsOnly(maxValue);
  const hasMin = Boolean(min);
  const hasMax = Boolean(max);

  if (!hasMin && !hasMax) return "";
  if (hasMin && hasMax) {
    const minYears = Number(min);
    const maxYears = Number(max);
    if (Number.isNaN(minYears) || Number.isNaN(maxYears)) return "";
    if (maxYears < minYears) return formatSingleYears(minYears);
    return formatRangeYears(minYears, maxYears);
  }
  if (hasMin) return formatPlusYears(Number(min));
  return `${0}–${Number(max)} years`;
}
