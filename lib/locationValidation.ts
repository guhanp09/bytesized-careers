export const normalizeCustomLocationInput = (value: string) => value.replace(/\s+/g, " ").trim();

export const getCustomLocationValidationError = (value: string): string | null => {
  const normalized = normalizeCustomLocationInput(value);
  if (!normalized) return null;
  if (normalized.length > 120) return "Enter a shorter location.";
  if (!/[A-Za-z]{2,}/.test(normalized)) return "Enter a valid location.";
  if (/^\d+$/.test(normalized)) return "Enter a valid location.";
  if (/^[\W_]+$/.test(normalized)) return "Enter a valid location.";
  if (/([.,;:!?_-])\1{3,}/.test(normalized)) return "Enter a valid location.";
  if (/^https?:\/\//i.test(normalized) || /^www\./i.test(normalized)) return "Enter a location, not a URL.";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return "Enter a location, not an email.";
  return null;
};

export const canUseCustomLocation = (value: string) =>
  Boolean(normalizeCustomLocationInput(value)) && !getCustomLocationValidationError(value);
