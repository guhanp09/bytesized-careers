const PRESERVED_LISTING_TERMS = new Map<string, string>([
  ["ai", "AI"],
  ["api", "API"],
  ["b2b", "B2B"],
  ["b2c", "B2C"],
  ["crm", "CRM"],
  ["seo", "SEO"],
  ["saas", "SaaS"],
  ["tiktok", "TikTok"],
  ["ugc", "UGC"],
  ["ui", "UI"],
  ["ux", "UX"],
  ["youtube", "YouTube"],
  ["instagram", "Instagram"],
]);

const hasLowercaseLetter = (value: string) => /[a-z]/.test(value);
const hasUppercaseLetter = (value: string) => /[A-Z]/.test(value);

const formatListingWord = (word: string) => {
  const preserved = PRESERVED_LISTING_TERMS.get(word.toLowerCase());
  if (preserved) return preserved;
  if (/^\d+[A-Z]+$/.test(word)) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
};

export const formatListingTitle = (title: string) => {
  const trimmed = title.trim();
  if (!trimmed) return title;
  if (!hasUppercaseLetter(trimmed) || hasLowercaseLetter(trimmed)) return title;

  return trimmed.replace(/[A-Z0-9]+/g, (word) => formatListingWord(word));
};
