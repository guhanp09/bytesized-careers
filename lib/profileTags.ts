const PROFILE_TAG_ERROR = "Enter a clear skill, tool, niche, or content type.";
const MAX_PROFILE_TAG_LENGTH = 32;

export const normalizeProfileTag = (value: string) => value.trim().replace(/\s+/g, " ");

const tagKey = (value: string) => normalizeProfileTag(value).toLowerCase();

const hasLetterOrNumber = (value: string) => /[\p{L}\p{N}]/u.test(value);

const isMostlyRepeatedCharacters = (value: string) => {
  const compact = value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (compact.length < 4) return false;
  if (/^(.)\1{3,}$/.test(compact)) return true;
  if (/^.(.)\1{3,}$/.test(compact)) return true;

  if (compact.length >= 5) {
    const counts = new Map<string, number>();
    for (const char of compact) counts.set(char, (counts.get(char) || 0) + 1);
    const maxCount = Math.max(...counts.values());
    return maxCount / compact.length >= 0.8;
  }

  return false;
};

export const validateProfileTag = (value: string, existing: string[] = []) => {
  const tag = normalizeProfileTag(value);
  if (!tag) return "Enter a tag.";
  if (tag.length < 2) return PROFILE_TAG_ERROR;
  if (tag.length > MAX_PROFILE_TAG_LENGTH) return `Keep tags under ${MAX_PROFILE_TAG_LENGTH} characters.`;
  if (!hasLetterOrNumber(tag)) return PROFILE_TAG_ERROR;
  if (isMostlyRepeatedCharacters(tag)) return PROFILE_TAG_ERROR;
  if (existing.some((item) => tagKey(item) === tagKey(tag))) return `"${tag}" is already added.`;
  return null;
};

export const sanitizeProfileTags = (values: Array<string | null | undefined>) => {
  const out: string[] = [];
  for (const value of values) {
    const tag = normalizeProfileTag(value || "");
    if (validateProfileTag(tag, out)) continue;
    out.push(tag);
  }
  return out;
};

export const validateProfileTags = (values: string[]) => {
  const seen: string[] = [];
  for (const value of values) {
    const tag = normalizeProfileTag(value);
    const error = validateProfileTag(tag, seen);
    if (error) return error;
    seen.push(tag);
  }
  return null;
};
