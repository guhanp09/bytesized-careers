export type ProjectTypePreference = "oneOff" | "retainer" | "either";

export const PROJECT_TYPE_DISPLAY_LABELS: Record<ProjectTypePreference, string> = {
  oneOff: "One-off projects",
  retainer: "Retainer / ongoing work",
  either: "Open to one-off projects and retainers",
};

const TURNAROUND_DISPLAY_LABELS: Record<string, string> = {
  "24 hours": "within 24 hours",
  "within 24 hours": "within 24 hours",
  "2-3 days": "within 2–3 days",
  "about a week": "about a week",
  "2+ weeks": "2+ weeks",
  flexible: "flexible / depends on scope",
  "flexible / depends on scope": "flexible / depends on scope",
};

const REVISION_DISPLAY_LABELS: Record<string, string> = {
  "1 round": "1 round included",
  "2 rounds": "2 rounds included",
  "3 rounds": "3 rounds included",
  unlimited: "unlimited within agreed scope",
  "case by case": "case by case",
};

const cleanPreferenceText = (value?: string | null) => {
  const text = value?.trim();
  if (!text) return null;
  const normalized = text.toLowerCase();
  if (["-", "–", "not set", "not shared", "none"].includes(normalized)) return null;
  return text;
};

const comparisonKey = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ");

const capitalizeFirst = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const isBareNumber = (value: string) => /^\d+(\.\d+)?$/.test(value.trim());

const hasTurnaroundUnit = (value: string) =>
  /\b(hour|hours|hr|hrs|day|days|business day|week|weeks|month|months)\b/i.test(value);

const hasFlexibleTurnaroundLanguage = (value: string) =>
  /\b(flexible|depends|scope|varies|variable|case by case)\b/i.test(value);

const withLabel = (label: string, value: string) => `${label}: ${value}`;

const stripLegacyTurnaroundRoleLanguage = (value: string) =>
  value
    .replace(/^first\s+(cut|draft|edit)\s+(usually\s+)?(delivered\s+)?/i, "")
    .replace(/^first\s+(cut|draft|edit)\s+/i, "")
    .trim();

export const formatProjectTypePreference = (value?: string | null) => {
  const text = cleanPreferenceText(value);
  if (!text) return null;
  const key = comparisonKey(text).replace(/\s+/g, "");
  if (key === "oneoff" || key === "one-off") return withLabel("Project type", PROJECT_TYPE_DISPLAY_LABELS.oneOff);
  if (key === "retainer" || key === "ongoing") return withLabel("Project type", PROJECT_TYPE_DISPLAY_LABELS.retainer);
  if (key === "either" || key === "both" || key === "one-offorretainer" || key === "oneofforretainer") {
    return withLabel("Project type", PROJECT_TYPE_DISPLAY_LABELS.either);
  }
  return withLabel("Project type", text);
};

export const formatTurnaroundPreference = (value?: string | null) => {
  const originalText = cleanPreferenceText(value);
  const text = originalText ? stripLegacyTurnaroundRoleLanguage(originalText) : null;
  if (!text || isBareNumber(text)) return null;

  const key = comparisonKey(text);
  if (TURNAROUND_DISPLAY_LABELS[key]) return withLabel("Turnaround", TURNAROUND_DISPLAY_LABELS[key]);
  if (/^turnaround\s*:/i.test(text)) return capitalizeFirst(text);
  if (/^turnaround\b/i.test(text)) return text.replace(/^turnaround\b\s*/i, "Turnaround: ");
  if (hasFlexibleTurnaroundLanguage(text)) return withLabel("Turnaround", text.toLowerCase());
  if (!hasTurnaroundUnit(text)) return null;
  if (/^in\s+/i.test(text)) return withLabel("Turnaround", text.replace(/^in\s+/i, ""));
  return withLabel("Turnaround", text);
};

export const normalizeRevisionsPreferenceForSave = (value: string) => {
  const text = value.trim();
  if (!text) return "";
  if (!isBareNumber(text)) return text;
  const number = Number(text);
  const rounded = Number.isInteger(number) ? String(number) : text;
  return `${rounded} ${number === 1 ? "round" : "rounds"}`;
};

export const formatRevisionsPreference = (value?: string | null) => {
  const text = cleanPreferenceText(value);
  if (!text) return null;

  const normalized = normalizeRevisionsPreferenceForSave(text);
  const key = comparisonKey(normalized);
  if (REVISION_DISPLAY_LABELS[key]) return withLabel("Revisions", REVISION_DISPLAY_LABELS[key]);
  if (/^revisions\s*:/i.test(normalized)) return capitalizeFirst(normalized);
  if (/revision/i.test(normalized)) return withLabel("Revisions", normalized.replace(/^revisions?\s*:?\s*/i, ""));
  if (/\brounds?\b/i.test(normalized)) return withLabel("Revisions", `${normalized} included`);
  if (/\b(unlimited|scope|case by case)\b/i.test(normalized)) return withLabel("Revisions", normalized.toLowerCase());
  return null;
};

export const formatWorkingHoursPreference = (value?: string | null) => {
  const text = cleanPreferenceText(value);
  if (!text || isBareNumber(text)) return null;
  if (/^availability\s*:/i.test(text)) return capitalizeFirst(text);
  if (/^flexible\b/i.test(text)) return withLabel("Availability", "Flexible working hours");
  if (/working hours/i.test(text)) return withLabel("Availability", text.replace(/^working hours\s*:?\s*/i, ""));
  return withLabel("Availability", text);
};

export const validateTurnaroundPreference = (value: string) => {
  const text = cleanPreferenceText(value);
  if (!text) return null;
  const key = comparisonKey(text);
  if (TURNAROUND_DISPLAY_LABELS[key]) return null;
  if (/^first\s+(cut|draft|edit)\b/i.test(text)) {
    return "Use role-neutral turnaround wording, like 5 days or 48 hours.";
  }
  if (isBareNumber(text) || (!hasTurnaroundUnit(text) && !hasFlexibleTurnaroundLanguage(text))) {
    return "Add a turnaround with a unit, like 5 days or 48 hours.";
  }
  return null;
};

export const validateRevisionsPreference = (value: string) => {
  const text = cleanPreferenceText(value);
  if (!text) return null;
  if (isBareNumber(text)) return null;
  if (/\b(round|rounds|revision|revisions|unlimited|scope|case by case)\b/i.test(text)) return null;
  return "Describe revisions as rounds, like 2 rounds, or choose Case by case.";
};
