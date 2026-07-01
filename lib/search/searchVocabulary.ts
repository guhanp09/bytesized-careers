// Creator-economy search vocabulary — the single, maintainable source of truth for
// synonyms/aliases the query parser and ranking layer use. Each entry maps a
// `canonical` value to the `aliases` users actually type. Keep aliases lowercase.
//
// Used by: lib/search/queryParser.ts (classify tokens) and lib/search/ranking.ts
// (expand a matched canonical back to aliases to test against listing fields).

import { INDIA_CITIES } from "../indiaCities.ts";

export type VocabEntry = { canonical: string; aliases: string[] };
export type SearchDimension =
  | "role"
  | "platform"
  | "niche"
  | "genre"
  | "format"
  | "workMode"
  | "language";

export const ROLE_VOCAB: VocabEntry[] = [
  { canonical: "video editor", aliases: ["video editor", "video editing", "video edit", "editor", "editing", "long form editor", "longform editor"] },
  { canonical: "shorts editor", aliases: ["shorts editor", "reels editor", "short form editor", "shortform editor", "short-form editor", "clip editor"] },
  { canonical: "thumbnail designer", aliases: ["thumbnail designer", "thumbnail artist", "thumb designer", "thumbnail"] },
  { canonical: "graphic designer", aliases: ["graphic designer", "designer", "graphics designer", "brand designer"] },
  { canonical: "motion designer", aliases: ["motion designer", "motion graphics", "motion graphics artist", "mograph", "animator", "motion artist"] },
  { canonical: "script writer", aliases: ["script writer", "scriptwriter", "writer", "scripting", "copywriter", "content writer"] },
  { canonical: "researcher", aliases: ["researcher", "content researcher", "research assistant"] },
  { canonical: "channel manager", aliases: ["channel manager", "youtube manager", "yt manager", "channel management", "channel ops"] },
  { canonical: "social media manager", aliases: ["social media manager", "smm", "social manager", "community manager"] },
  { canonical: "content strategist", aliases: ["content strategist", "strategist", "content strategy", "growth strategist"] },
  { canonical: "voice over artist", aliases: ["voice over artist", "voice over", "voiceover", "vo artist", "narrator"] },
  { canonical: "producer", aliases: ["producer", "creative producer", "video producer", "podcast producer"] },
];

export const PLATFORM_VOCAB: VocabEntry[] = [
  { canonical: "youtube", aliases: ["youtube", "yt", "you tube"] },
  { canonical: "instagram", aliases: ["instagram", "ig", "insta"] },
  { canonical: "tiktok", aliases: ["tiktok", "tik tok"] },
  { canonical: "podcast", aliases: ["podcast", "podcasts"] },
  { canonical: "linkedin", aliases: ["linkedin"] },
  { canonical: "twitter", aliases: ["twitter", "x"] },
  // Single-word so "instagram reels" / "youtube shorts" still resolve the platform
  // (instagram/youtube) AND the format (reels/shorts) rather than collapsing to one.
  { canonical: "shorts", aliases: ["shorts"] },
  { canonical: "reels", aliases: ["reels"] },
];

export const FORMAT_VOCAB: VocabEntry[] = [
  { canonical: "long-form video", aliases: ["long form", "long-form", "longform", "long form video", "long-form video"] },
  { canonical: "shorts/reels", aliases: ["short form", "short-form", "shortform", "shorts", "reels", "shorts reels"] },
  { canonical: "thumbnails", aliases: ["thumbnail", "thumb", "thumbnails"] },
  { canonical: "scripts", aliases: ["script", "scripts", "scripting"] },
  { canonical: "hooks", aliases: ["hooks", "hook", "intro"] },
  { canonical: "captions", aliases: ["captions", "subtitles", "subs"] },
  { canonical: "repurposed clips", aliases: ["repurposing", "clips", "cutdowns", "cut downs", "clipping", "repurposed clips"] },
  { canonical: "voice-over", aliases: ["voice over", "voice-over", "voiceover", "vo"] },
  { canonical: "motion graphics", aliases: ["motion graphics", "mograph"] },
  { canonical: "channel research", aliases: ["channel research", "research"] },
  { canonical: "content strategy", aliases: ["content strategy", "strategy"] },
  { canonical: "podcast editing", aliases: ["podcast editing", "podcast editor"] },
  { canonical: "social posts", aliases: ["social posts", "social media posts"] },
  { canonical: "youtube packaging", aliases: ["youtube packaging", "packaging"] },
  { canonical: "ad creatives", aliases: ["ad creatives", "ads", "ad creative"] },
];

export const NICHE_VOCAB: VocabEntry[] = [
  { canonical: "Tech", aliases: ["tech", "technology"] },
  { canonical: "Finance", aliases: ["finance", "fintech", "money", "investing"] },
  { canonical: "Gaming", aliases: ["gaming", "games"] },
  { canonical: "Education", aliases: ["education", "educational", "learning"] },
  { canonical: "Food", aliases: ["food", "cooking"] },
  { canonical: "Fitness", aliases: ["fitness", "health"] },
  { canonical: "Beauty", aliases: ["beauty"] },
  { canonical: "Fashion", aliases: ["fashion"] },
  { canonical: "Travel", aliases: ["travel"] },
  { canonical: "Business", aliases: ["business", "startups", "startup"] },
  { canonical: "Comedy", aliases: ["comedy", "funny"] },
  { canonical: "News", aliases: ["news"] },
  { canonical: "Entertainment", aliases: ["entertainment"] },
  { canonical: "Sports", aliases: ["sports"] },
  { canonical: "Parenting", aliases: ["parenting"] },
  { canonical: "Real estate", aliases: ["real estate", "property"] },
  { canonical: "Spirituality", aliases: ["spirituality", "spiritual"] },
];

export const GENRE_VOCAB: VocabEntry[] = [
  { canonical: "Explainers", aliases: ["explainer", "explainers"] },
  { canonical: "Tutorials", aliases: ["tutorial", "tutorials", "how to"] },
  { canonical: "Reviews", aliases: ["review", "reviews"] },
  { canonical: "Commentary", aliases: ["commentary", "reaction"] },
  { canonical: "Interviews", aliases: ["interview", "interviews"] },
  { canonical: "Vlogs", aliases: ["vlog", "vlogs"] },
  { canonical: "Podcasts", aliases: ["podcast", "podcasts"] },
  { canonical: "Documentaries", aliases: ["documentary", "documentaries", "docu"] },
  { canonical: "Shorts/Reels", aliases: ["shorts", "reels", "shorts reels"] },
  { canonical: "Skits", aliases: ["skit", "skits"] },
  { canonical: "Live streams", aliases: ["live stream", "live streams", "livestream"] },
  { canonical: "Case studies", aliases: ["case study", "case studies"] },
  { canonical: "Product demos", aliases: ["product demo", "product demos", "demo"] },
  { canonical: "Behind-the-scenes", aliases: ["behind the scenes", "bts"] },
];

export const WORK_MODE_VOCAB: VocabEntry[] = [
  { canonical: "remote", aliases: ["remote", "wfh", "work from home"] },
  { canonical: "onsite", aliases: ["onsite", "on-site", "on site", "in office", "in-office"] },
  { canonical: "hybrid", aliases: ["hybrid"] },
  { canonical: "freelance", aliases: ["freelance", "contract", "contractor"] },
  { canonical: "retainer", aliases: ["retainer", "monthly retainer"] },
  { canonical: "part-time", aliases: ["part time", "part-time", "parttime"] },
  { canonical: "full-time", aliases: ["full time", "full-time", "fulltime"] },
];

export const LANGUAGE_OPTIONS: string[] = [
  "Hindi",
  "English",
  "Tamil",
  "Telugu",
  "Kannada",
  "Malayalam",
  "Marathi",
  "Bengali",
  "Punjabi",
  "Gujarati",
  "Urdu",
];

const INDIA_FIRST_LANGUAGE_VOCAB: VocabEntry[] = [
  { canonical: "Hindi", aliases: ["hindi"] },
  { canonical: "English", aliases: ["english"] },
  { canonical: "Tamil", aliases: ["tamil"] },
  { canonical: "Telugu", aliases: ["telugu"] },
  { canonical: "Kannada", aliases: ["kannada"] },
  { canonical: "Malayalam", aliases: ["malayalam"] },
  { canonical: "Marathi", aliases: ["marathi"] },
  { canonical: "Bengali", aliases: ["bengali", "bangla"] },
  { canonical: "Punjabi", aliases: ["punjabi"] },
  { canonical: "Gujarati", aliases: ["gujarati"] },
  { canonical: "Urdu", aliases: ["urdu"] },
];

const GLOBAL_LANGUAGE_VOCAB: VocabEntry[] = [
  { canonical: "Spanish", aliases: ["spanish", "espanol"] },
  { canonical: "French", aliases: ["french"] },
  { canonical: "German", aliases: ["german", "deutsch"] },
  { canonical: "Arabic", aliases: ["arabic"] },
  { canonical: "Portuguese", aliases: ["portuguese", "brazilian portuguese"] },
  { canonical: "Russian", aliases: ["russian"] },
  { canonical: "Japanese", aliases: ["japanese"] },
  { canonical: "Korean", aliases: ["korean"] },
  { canonical: "Mandarin Chinese", aliases: ["mandarin", "mandarin chinese", "chinese", "putonghua"] },
  { canonical: "Cantonese", aliases: ["cantonese"] },
  { canonical: "Vietnamese", aliases: ["vietnamese"] },
  { canonical: "Thai", aliases: ["thai"] },
  { canonical: "Indonesian", aliases: ["indonesian", "bahasa indonesia"] },
  { canonical: "Turkish", aliases: ["turkish"] },
  { canonical: "Italian", aliases: ["italian"] },
  { canonical: "Dutch", aliases: ["dutch"] },
  { canonical: "Polish", aliases: ["polish"] },
  { canonical: "Swahili", aliases: ["swahili", "kiswahili"] },
  { canonical: "Afrikaans", aliases: ["afrikaans"] },
  { canonical: "Hebrew", aliases: ["hebrew"] },
  { canonical: "Persian", aliases: ["persian", "farsi", "dari"] },
  { canonical: "Greek", aliases: ["greek"] },
  { canonical: "Ukrainian", aliases: ["ukrainian"] },
  { canonical: "Filipino / Tagalog", aliases: ["filipino", "tagalog", "filipino tagalog"] },
  { canonical: "Malay", aliases: ["malay", "bahasa melayu"] },
  { canonical: "Burmese", aliases: ["burmese", "myanmar"] },
  { canonical: "Nepali", aliases: ["nepali"] },
  { canonical: "Sinhala", aliases: ["sinhala", "sinhalese"] },
  { canonical: "Assamese", aliases: ["assamese"] },
  { canonical: "Odia", aliases: ["odia", "oriya"] },
  { canonical: "Konkani", aliases: ["konkani"] },
  { canonical: "Sanskrit", aliases: ["sanskrit"] },
  { canonical: "Maithili", aliases: ["maithili"] },
  { canonical: "Bhojpuri", aliases: ["bhojpuri"] },
  { canonical: "Rajasthani", aliases: ["rajasthani"] },
  { canonical: "Haryanvi", aliases: ["haryanvi"] },
  { canonical: "Kashmiri", aliases: ["kashmiri"] },
  { canonical: "Manipuri", aliases: ["manipuri", "meitei"] },
  { canonical: "Santali", aliases: ["santali"] },
  { canonical: "Lao", aliases: ["lao", "laotian"] },
  { canonical: "Khmer", aliases: ["khmer", "cambodian"] },
  { canonical: "Mongolian", aliases: ["mongolian"] },
  { canonical: "Tibetan", aliases: ["tibetan"] },
  { canonical: "Uzbek", aliases: ["uzbek"] },
  { canonical: "Kazakh", aliases: ["kazakh"] },
  { canonical: "Kyrgyz", aliases: ["kyrgyz"] },
  { canonical: "Azerbaijani", aliases: ["azerbaijani", "azeri"] },
  { canonical: "Armenian", aliases: ["armenian"] },
  { canonical: "Georgian", aliases: ["georgian"] },
  { canonical: "Romanian", aliases: ["romanian"] },
  { canonical: "Czech", aliases: ["czech"] },
  { canonical: "Slovak", aliases: ["slovak"] },
  { canonical: "Hungarian", aliases: ["hungarian"] },
  { canonical: "Bulgarian", aliases: ["bulgarian"] },
  { canonical: "Serbian", aliases: ["serbian"] },
  { canonical: "Croatian", aliases: ["croatian"] },
  { canonical: "Bosnian", aliases: ["bosnian"] },
  { canonical: "Slovenian", aliases: ["slovenian"] },
  { canonical: "Albanian", aliases: ["albanian"] },
  { canonical: "Macedonian", aliases: ["macedonian"] },
  { canonical: "Lithuanian", aliases: ["lithuanian"] },
  { canonical: "Latvian", aliases: ["latvian"] },
  { canonical: "Estonian", aliases: ["estonian"] },
  { canonical: "Finnish", aliases: ["finnish"] },
  { canonical: "Swedish", aliases: ["swedish"] },
  { canonical: "Norwegian", aliases: ["norwegian"] },
  { canonical: "Danish", aliases: ["danish"] },
  { canonical: "Icelandic", aliases: ["icelandic"] },
  { canonical: "Irish", aliases: ["irish", "gaelic"] },
  { canonical: "Welsh", aliases: ["welsh"] },
  { canonical: "Basque", aliases: ["basque"] },
  { canonical: "Catalan", aliases: ["catalan"] },
  { canonical: "Galician", aliases: ["galician"] },
  { canonical: "Haitian Creole", aliases: ["haitian creole", "creole"] },
  { canonical: "Quechua", aliases: ["quechua"] },
  { canonical: "Guarani", aliases: ["guarani"] },
  { canonical: "Aymara", aliases: ["aymara"] },
  { canonical: "Yoruba", aliases: ["yoruba"] },
  { canonical: "Igbo", aliases: ["igbo"] },
  { canonical: "Hausa", aliases: ["hausa"] },
  { canonical: "Amharic", aliases: ["amharic"] },
  { canonical: "Somali", aliases: ["somali"] },
  { canonical: "Zulu", aliases: ["zulu"] },
  { canonical: "Xhosa", aliases: ["xhosa"] },
  { canonical: "Shona", aliases: ["shona"] },
  { canonical: "Kinyarwanda", aliases: ["kinyarwanda", "rwandan"] },
  { canonical: "Wolof", aliases: ["wolof"] },
  { canonical: "Lingala", aliases: ["lingala"] },
  { canonical: "Tamil (Sri Lanka)", aliases: ["sri lankan tamil", "srilankan tamil"] },
];

export const LANGUAGE_VOCAB: VocabEntry[] = [...INDIA_FIRST_LANGUAGE_VOCAB, ...GLOBAL_LANGUAGE_VOCAB];

export const GLOBAL_LANGUAGE_OPTIONS: string[] = LANGUAGE_VOCAB.map((entry) => entry.canonical);

export const VOCAB_BY_DIMENSION: Record<SearchDimension, VocabEntry[]> = {
  role: ROLE_VOCAB,
  platform: PLATFORM_VOCAB,
  niche: NICHE_VOCAB,
  genre: GENRE_VOCAB,
  format: FORMAT_VOCAB,
  workMode: WORK_MODE_VOCAB,
  language: LANGUAGE_VOCAB,
};

// ---- Locations ----
// Canonical city names come from the shared INDIA_CITIES list; aliases map common
// spellings/older names to the canonical, and expansions cover regions like NCR.
export const LOCATION_CANONICALS: string[] = INDIA_CITIES;

export const LOCATION_ALIASES: Record<string, string> = {
  bangalore: "Bengaluru",
  bengaluru: "Bengaluru",
  blr: "Bengaluru",
  gurgaon: "Gurugram",
  gurugram: "Gurugram",
  bombay: "Mumbai",
  calcutta: "Kolkata",
  madras: "Chennai",
  trivandrum: "Thiruvananthapuram",
  vizag: "Visakhapatnam",
  pondicherry: "Panaji",
  baroda: "Vadodara",
};

// Region tokens that expand to multiple cities (only the ones present in our data).
export const LOCATION_EXPANSIONS: Record<string, string[]> = {
  ncr: ["Delhi", "Noida", "Gurugram", "Ghaziabad", "Faridabad"],
  "delhi ncr": ["Delhi", "Noida", "Gurugram", "Ghaziabad", "Faridabad"],
};

export const REMOTE_TOKENS = ["remote", "wfh", "anywhere"];
export const COUNTRY_TOKENS = ["india"];

/** All aliases for a canonical within a dimension (used by ranking to test fields). */
export function aliasesForCanonical(dimension: SearchDimension, canonical: string): string[] {
  const entry = VOCAB_BY_DIMENSION[dimension].find((item) => item.canonical === canonical);
  return entry ? entry.aliases : [canonical.toLowerCase()];
}

/** Lowercase, collapse whitespace, drop most punctuation (keep + and # for tools). */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s+#/.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalizeLanguageValue(value: string): string {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  const match = LANGUAGE_VOCAB.find((entry) => {
    if (normalizeText(entry.canonical) === normalized) return true;
    return entry.aliases.some((alias) => normalizeText(alias) === normalized);
  });
  return match?.canonical ?? value.trim().replace(/\s+/g, " ");
}

export function languageIdentityKey(value: string): string {
  return normalizeText(canonicalizeLanguageValue(value));
}

export function normalizeLanguageSelections(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const canonical = canonicalizeLanguageValue(value);
    const key = languageIdentityKey(canonical);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(canonical);
  }
  return out;
}

export function searchLanguageOptions(query: string, limit = 60): string[] {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return GLOBAL_LANGUAGE_OPTIONS.slice(0, limit);

  return LANGUAGE_VOCAB.map((entry) => {
    const canonical = normalizeText(entry.canonical);
    const aliases = entry.aliases.map(normalizeText);
    const allTerms = [canonical, ...aliases];
    const exact = allTerms.some((term) => term === normalizedQuery);
    const starts = allTerms.some((term) => term.startsWith(normalizedQuery));
    const includes = allTerms.some((term) => term.includes(normalizedQuery));
    if (!includes) return null;
    return {
      value: entry.canonical,
      score: exact ? 0 : starts ? 1 : 2,
    };
  })
    .filter((item): item is { value: string; score: number } => Boolean(item))
    .sort((a, b) => a.score - b.score || a.value.localeCompare(b.value))
    .slice(0, limit)
    .map((item) => item.value);
}
