/**
 * The creator-hiring projection.
 *
 * CreatorJobs already stores everything this phase needs to display — jobs carry
 * `platforms`, `formats_hired_for`, `content_niches`, `turnaround_*` and a full
 * compensation model; portfolio items carry `platforms`, `formats`,
 * `content_niches`, `duration`, `thumbnail_url` and `source_type`. What it did
 * not have was a way for the *inbox* to see any of it: `InteractionJobSnapshot`
 * flattened a structured commercial model down to `budget: string` and dropped
 * the rest, so the workspace could only ever render a generic job.
 *
 * So this is a projection, not a second source of truth. Compensation and
 * turnaround are formatted by `lib/jobPresentation.ts` — the same functions the
 * public job pages use — and this module adds only what the workspace needs on
 * top: normalisation into buckets that can be sorted and filtered, without
 * discarding the wording the formatter produced.
 *
 * Provider-neutral by construction: every input is a plain shape, nothing here
 * reaches for a backend response or a network call, so Phase 4's manifests can
 * feed it the same way the live mapper does.
 */

import { formatCompactNumber } from "./format.ts";
import { formatJobCompensation, formatTurnaround } from "./jobPresentation.ts";

/* --- portfolio ------------------------------------------------------------ */

export type CreatorMediaKind = "video" | "image" | "audio" | "link";

/**
 * One piece of evidence, normalised.
 *
 * Deliberately tolerant about its input: an application's `relevant_portfolio`
 * answer carries only `{ id, title, url }`, while the applicant's profile
 * carries the full item. Both must render, because the thin one is what a
 * recruiter actually receives at the moment of application.
 */
export type CreatorPortfolioItem = {
  id: string;
  title: string;
  media: CreatorMediaKind;
  thumbnailUrl: string | null;
  url: string | null;
  /** Formatted for display, e.g. "12:04". Null when unknown — never guessed. */
  duration: string | null;
  platform: string | null;
  format: string | null;
  niche: string | null;
  /** What this person actually did on it, which is the part a recruiter reads. */
  role: string | null;
};

/** Loose input covering both the thin answer shape and the full profile item. */
export type PortfolioInput = {
  id?: string | null;
  title?: string | null;
  url?: string | null;
  source_url?: string | null;
  youtube_url?: string | null;
  media_url?: string | null;
  links?: string[] | null;
  thumbnail_url?: string | null;
  thumbnailUrl?: string | null;
  source_type?: string | null;
  duration?: string | number | null;
  platforms?: string[] | null;
  platform?: string | null;
  formats?: string[] | null;
  format?: string | null;
  /** What the first-message answer calls a format, e.g. "Retention edit". */
  type?: string | null;
  content_niches?: string[] | null;
  contentNiches?: string[] | null;
  niche?: string | null;
  role?: string | null;
  role_name?: string | null;
  user_role_in_project?: string | null;
  subtitle?: string | null;
};

const AUDIO_SOURCES = new Set(["spotify", "soundcloud", "podcast", "anchor"]);
const IMAGE_SOURCES = new Set(["behance", "dribbble", "image"]);
const VIDEO_SOURCES = new Set(["youtube", "vimeo", "tiktok", "video"]);

/**
 * What kind of thing this is, from whatever evidence exists.
 *
 * Order matters: an explicit `source_type` beats a URL guess, and a URL guess
 * beats the default. The default is `link` rather than `video` — claiming a
 * still image is a video would put a duration slot and a video cue on something
 * that has neither.
 */
function mediaKindOf(input: PortfolioInput, url: string | null): CreatorMediaKind {
  const source = (input.source_type || "").toLowerCase().trim();
  if (VIDEO_SOURCES.has(source)) return "video";
  if (IMAGE_SOURCES.has(source)) return "image";
  if (AUDIO_SOURCES.has(source)) return "audio";
  const href = (url || "").toLowerCase();
  if (/youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|\.mp4($|\?)/.test(href)) return "video";
  if (/\.(png|jpe?g|gif|webp|avif)($|\?)/.test(href)) return "image";
  if (/spotify\.com|soundcloud\.com|\.mp3($|\?)/.test(href)) return "audio";
  if (input.duration) return "video";
  return "link";
}

export const MEDIA_KIND_LABELS: Record<CreatorMediaKind, string> = {
  video: "Video",
  image: "Image",
  audio: "Audio",
  link: "Link",
};

/**
 * A duration as a person reads it.
 *
 * Accepts seconds, "12:04", or ISO-8601 "PT12M4S" — all three appear across
 * YouTube metadata, manual entry and imports. Anything unrecognisable returns
 * null rather than a mangled string: no duration is better than a wrong one.
 */
export function formatPortfolioDuration(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  let seconds: number | null = null;

  if (typeof value === "number") {
    seconds = value;
  } else {
    const raw = value.trim();
    const iso = raw.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
    if (iso && (iso[1] || iso[2] || iso[3])) {
      seconds = Number(iso[1] || 0) * 3600 + Number(iso[2] || 0) * 60 + Number(iso[3] || 0);
    } else if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) {
      const parts = raw.split(":").map(Number);
      seconds =
        parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
    } else if (/^\d+$/.test(raw)) {
      seconds = Number(raw);
    } else {
      return null;
    }
  }

  if (!Number.isFinite(seconds) || seconds === null || seconds < 0) return null;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

const first = (...values: Array<string | null | undefined>): string | null => {
  for (const value of values) {
    const trimmed = (value || "").trim();
    if (trimmed) return trimmed;
  }
  return null;
};

const firstOf = (list: string[] | null | undefined): string | null =>
  Array.isArray(list) ? first(...list) : null;

/** Normalise one portfolio item from whichever shape the caller has. */
export function toCreatorPortfolioItem(input: PortfolioInput, index = 0): CreatorPortfolioItem {
  const url = first(input.url, input.source_url, input.youtube_url, input.media_url, firstOf(input.links));
  const media = mediaKindOf(input, url);
  return {
    // The id seeds the deterministic poster, so it must never be empty — a
    // blank id would give every unnamed item the same artwork.
    id: first(input.id) || `portfolio-${index}`,
    title: first(input.title) || "Untitled work",
    media,
    thumbnailUrl: first(input.thumbnail_url, input.thumbnailUrl),
    url,
    duration: media === "video" || media === "audio" ? formatPortfolioDuration(input.duration) : null,
    platform: normalizePlatform(first(input.platform, firstOf(input.platforms))),
    format: normalizeFormat(first(input.format, firstOf(input.formats), input.type)),
    niche: normalizeNiche(first(input.niche, firstOf(input.content_niches), firstOf(input.contentNiches))),
    role: first(input.role, input.role_name, input.user_role_in_project, input.subtitle),
  };
}

export function toCreatorPortfolio(items: readonly PortfolioInput[] | null | undefined): CreatorPortfolioItem[] {
  if (!Array.isArray(items)) return [];
  return items.filter(Boolean).map((item, index) => toCreatorPortfolioItem(item, index));
}

/* --- platform and format -------------------------------------------------- */

/**
 * Platform labels.
 *
 * The backend's canonical job vocabulary is only `youtube` and `instagram`, but
 * portfolio items and imports carry more, and a creator marketplace that
 * renders "tiktok" lowercase mid-sentence looks unfinished. Unknown values are
 * title-cased rather than dropped — the map is the plan, title-casing is the
 * floor.
 */
const PLATFORM_LABELS: Record<string, string> = {
  youtube: "YouTube",
  youtube_shorts: "YouTube Shorts",
  shorts: "YouTube Shorts",
  instagram: "Instagram",
  reels: "Instagram Reels",
  instagram_reels: "Instagram Reels",
  tiktok: "TikTok",
  twitch: "Twitch",
  podcast: "Podcast",
  spotify: "Spotify",
  linkedin: "LinkedIn",
  x: "X",
  twitter: "X",
  facebook: "Facebook",
  multi: "Multi-platform",
  multi_platform: "Multi-platform",
};

function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function normalizePlatform(value: string | null | undefined): string | null {
  const raw = (value || "").trim();
  if (!raw) return null;
  return PLATFORM_LABELS[raw.toLowerCase().replace(/[\s-]+/g, "_")] ?? titleCase(raw);
}

/**
 * Format labels. The canonical job vocabulary is already human-readable
 * ("Long-form video", "Shorts/Reels"), so this mostly passes values through and
 * exists to catch the snake_case variants that arrive from deliverable types.
 */
const FORMAT_LABELS: Record<string, string> = {
  long_form_video: "Long-form video",
  long_form: "Long-form video",
  longform: "Long-form video",
  short: "Shorts/Reels",
  shorts: "Shorts/Reels",
  reel: "Shorts/Reels",
  reels: "Shorts/Reels",
  thumbnail: "Thumbnails",
  script: "Scripts",
  podcast_episode: "Podcast editing",
  social_post: "Social posts",
  voice_over: "Voice-over",
  design_asset: "Design assets",
  research_brief: "Channel research",
};

export function normalizeFormat(value: string | null | undefined): string | null {
  const raw = (value || "").trim();
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[\s-]+/g, "_");
  if (FORMAT_LABELS[key]) return FORMAT_LABELS[key];
  // Canonical values already read as prose; leave their punctuation alone.
  return /[A-Z]/.test(raw) || raw.includes("/") ? raw : titleCase(raw);
}

export function normalizeNiche(value: string | null | undefined): string | null {
  const raw = (value || "").trim();
  if (!raw) return null;
  return /[A-Z]/.test(raw) ? raw : titleCase(raw);
}

export const normalizePlatforms = (values: readonly string[] | null | undefined): string[] =>
  dedupe((values ?? []).map(normalizePlatform));
export const normalizeFormats = (values: readonly string[] | null | undefined): string[] =>
  dedupe((values ?? []).map(normalizeFormat));
export const normalizeNiches = (values: readonly string[] | null | undefined): string[] =>
  dedupe((values ?? []).map(normalizeNiche));

function dedupe(values: Array<string | null>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value) continue;
    const folded = value.toLowerCase();
    if (seen.has(folded)) continue;
    seen.add(folded);
    out.push(value);
  }
  return out;
}

/* --- turnaround ----------------------------------------------------------- */

export type TurnaroundBucket =
  | "same_day"
  | "24_hours"
  | "2_3_days"
  | "within_a_week"
  | "1_2_weeks"
  | "longer"
  | "unspecified";

export const TURNAROUND_BUCKET_LABELS: Record<TurnaroundBucket, string> = {
  same_day: "Same day",
  "24_hours": "Within 24 hours",
  "2_3_days": "2–3 days",
  within_a_week: "Within a week",
  "1_2_weeks": "1–2 weeks",
  longer: "Longer than 2 weeks",
  unspecified: "Not specified",
};

/** Buckets in delivery order, for filter menus and sorting. */
export const TURNAROUND_BUCKET_ORDER: TurnaroundBucket[] = [
  "same_day",
  "24_hours",
  "2_3_days",
  "within_a_week",
  "1_2_weeks",
  "longer",
  "unspecified",
];

export type CreatorTurnaround = {
  /** The original wording, from the shared job formatter. Never reconstructed. */
  label: string;
  /** Comparable magnitude, for sorting. Null when nothing was specified. */
  hours: number | null;
  bucket: TurnaroundBucket;
};

const HOURS_PER_UNIT: Record<string, number> = {
  hours: 1,
  // Business days are not calendar days, but for *ordering* a 3-business-day
  // turnaround against a 5-calendar-day one, treating both as 24h is right far
  // more often than it is wrong. The displayed label keeps the real wording.
  business_days: 24,
  calendar_days: 24,
  days: 24,
  weeks: 168,
};

/**
 * Normalise turnaround enough to sort and filter, without losing the wording.
 *
 * The brief's requirement is exactly this pair: a recruiter wants to filter to
 * "within a week", and also wants to read "3 business days to first draft" —
 * a single normalised value cannot do both, so the model carries both.
 */
export function normalizeTurnaround(input: {
  value?: number | string | null;
  unit?: string | null;
  basis?: string | null;
}): CreatorTurnaround {
  const label = formatTurnaround(input.value, input.unit, input.basis);
  const amount = Number(input.value);
  const unit = (input.unit || "").trim().toLowerCase();
  const perHour = HOURS_PER_UNIT[unit];

  if (!Number.isFinite(amount) || amount <= 0 || !perHour) {
    return { label, hours: null, bucket: "unspecified" };
  }
  const hours = amount * perHour;
  return { label, hours, bucket: bucketForHours(hours) };
}

function bucketForHours(hours: number): TurnaroundBucket {
  if (hours <= 12) return "same_day";
  if (hours <= 24) return "24_hours";
  if (hours <= 72) return "2_3_days";
  if (hours <= 168) return "within_a_week";
  if (hours <= 336) return "1_2_weeks";
  return "longer";
}

/* --- commercial structure ------------------------------------------------- */

export type CommercialStructure =
  | "per_video"
  | "per_project"
  | "retainer"
  | "hourly"
  | "revenue_share"
  | "paid_trial"
  | "unpaid"
  | "negotiable"
  | "unspecified";

export const COMMERCIAL_STRUCTURE_LABELS: Record<CommercialStructure, string> = {
  per_video: "Per video",
  per_project: "Per project",
  retainer: "Monthly retainer",
  hourly: "Hourly",
  revenue_share: "Revenue share",
  paid_trial: "Paid trial",
  unpaid: "Unpaid",
  negotiable: "Negotiable",
  unspecified: "Not specified",
};

export const COMMERCIAL_STRUCTURE_ORDER: CommercialStructure[] = [
  "per_video",
  "per_project",
  "retainer",
  "hourly",
  "revenue_share",
  "paid_trial",
  "unpaid",
  "negotiable",
  "unspecified",
];

export type CreatorCommercialTerms = {
  /** The money, formatted by the shared job formatter. Currency never converted. */
  headline: string;
  structure: CommercialStructure;
  structureLabel: string;
  /** Any note the poster attached, e.g. "negotiable for the right fit". */
  note: string;
  /** False when nothing was disclosed — the UI must say so rather than imply free. */
  disclosed: boolean;
  /**
   * True only when the arrangement carries no money at all. Kept separate from
   * `disclosed` because "not specified" and "unpaid" are different claims, and
   * showing them the same way would misrepresent one of them.
   */
  unpaid: boolean;
  /** A trial is a bounded audition, not the ongoing rate; it is never merged in. */
  trial: { label: string; paid: boolean } | null;
};

const UNIT_TO_STRUCTURE: Record<string, CommercialStructure> = {
  "per video": "per_video",
  "per short": "per_video",
  "per episode": "per_video",
  "per deliverable": "per_project",
  "per thumbnail": "per_project",
  "per script": "per_project",
  "per post": "per_project",
  "per project": "per_project",
  "per month": "retainer",
  monthly: "retainer",
  "per hour": "hourly",
  hourly: "hourly",
  "per week": "retainer",
  "per year": "retainer",
  commission: "revenue_share",
  "revenue share": "revenue_share",
};

/**
 * Describe an arrangement so an amount never appears without its meaning.
 *
 * "₹3,000" is not a rate. Per video it is ordinary; as a monthly retainer it is
 * close to unpaid. The unit is what makes the number mean anything, so the
 * headline always carries it and the structure is exposed separately for
 * filtering.
 */
export function describeCommercialTerms(input: {
  mode?: string | null;
  minimum?: number | string | null;
  maximum?: number | string | null;
  currency?: string | null;
  unit?: string | null;
  customUnit?: string | null;
  note?: string | null;
  legacyDisplay?: string | null;
  trialStatus?: string | null;
  trialAmount?: number | string | null;
  trialCurrency?: string | null;
  trialBasis?: string | null;
}): CreatorCommercialTerms {
  const money = formatJobCompensation({
    mode: input.mode,
    minimum: input.minimum,
    maximum: input.maximum,
    currency: input.currency,
    unit: input.unit,
    customUnit: input.customUnit,
    note: input.note,
    legacyDisplay: input.legacyDisplay,
  });

  const unit = (input.unit || "").trim().toLowerCase();
  const mode = (input.mode || "").trim().toLowerCase();
  let structure: CommercialStructure = UNIT_TO_STRUCTURE[unit] ?? "unspecified";
  if (structure === "unspecified" && mode === "negotiable") structure = "negotiable";
  if (structure === "unspecified" && input.customUnit) structure = "per_project";

  const trialStatus = (input.trialStatus || "").trim().toLowerCase();
  const hasTrial = trialStatus === "paid" || trialStatus === "unpaid";
  const trialPaid = trialStatus === "paid";
  const trial = hasTrial
    ? {
        paid: trialPaid,
        label: trialPaid
          ? describeTrialPay(input.trialAmount, input.trialCurrency, input.trialBasis)
          : "Unpaid trial",
      }
    : null;

  // Unpaid is asserted only when the record actually says so. An undisclosed
  // rate is undisclosed — presenting it as unpaid would invent a claim about
  // someone's terms.
  const unpaid = unit === "unpaid" || mode === "unpaid" || trialStatus === "unpaid_only";

  return {
    headline: unpaid ? "Unpaid collaboration" : money.headline,
    structure: unpaid ? "unpaid" : structure,
    structureLabel: COMMERCIAL_STRUCTURE_LABELS[unpaid ? "unpaid" : structure],
    note: money.note,
    disclosed: unpaid ? true : money.disclosed,
    unpaid,
    trial,
  };
}

function describeTrialPay(
  amount: number | string | null | undefined,
  currency: string | null | undefined,
  basis: string | null | undefined
): string {
  const money = formatJobCompensation({
    mode: "fixed",
    minimum: amount,
    currency,
    unit: basis || undefined,
  });
  return money.headline === "Compensation not specified" ? "Paid trial" : `Paid trial · ${money.headline}`;
}

/* --- client context ------------------------------------------------------- */

export type CreatorClientContext = {
  /** "@handle" when known — the thing a creator actually recognises. */
  handle: string | null;
  /** "Creator", "Agency", "Studio", "Brand", "Production house". */
  kind: string | null;
  /** A band, never an exact count: "250K–500K subscribers". */
  audience: string | null;
  /** Free-form, e.g. "2 videos/week". Only shown when the record carries it. */
  cadence: string | null;
  platforms: string[];
  formats: string[];
  niches: string[];
};

const EMPLOYER_KIND_LABELS: Record<string, string> = {
  creator: "Creator",
  solo_creator: "Creator",
  agency: "Agency",
  studio: "Studio",
  brand: "Brand",
  production_house: "Production house",
  company: "Company",
  media_company: "Media company",
};

/**
 * Subscriber counts as a band.
 *
 * A precise figure invites comparison the number cannot support — it moves
 * daily, and a creator reading "487,213 subscribers" learns nothing they would
 * not learn from "250K–500K". Bands also avoid implying the platform verified
 * the figure.
 */
export function audienceTier(subscribers: number | null | undefined): string | null {
  if (subscribers === null || subscribers === undefined || !Number.isFinite(subscribers)) return null;
  const count = Math.max(0, Math.floor(subscribers));
  if (count < 1_000) return "Under 1K subscribers";
  const bands: Array<[number, number]> = [
    [1_000, 10_000],
    [10_000, 50_000],
    [50_000, 100_000],
    [100_000, 250_000],
    [250_000, 500_000],
    [500_000, 1_000_000],
  ];
  for (const [low, high] of bands) {
    if (count < high) return `${formatCompactNumber(low)}–${formatCompactNumber(high)} subscribers`;
  }
  return "1M+ subscribers";
}

export function describeClientContext(input: {
  handle?: string | null;
  channelName?: string | null;
  employerKind?: string | null;
  subscribers?: number | null;
  cadence?: string | null;
  platforms?: readonly string[] | null;
  formats?: readonly string[] | null;
  niches?: readonly string[] | null;
}): CreatorClientContext {
  const rawHandle = (input.handle || "").trim();
  return {
    handle: rawHandle ? (rawHandle.startsWith("@") ? rawHandle : `@${rawHandle}`) : null,
    kind: input.employerKind
      ? EMPLOYER_KIND_LABELS[input.employerKind.toLowerCase()] ?? titleCase(input.employerKind)
      : null,
    audience: audienceTier(input.subscribers),
    cadence: (input.cadence || "").trim() || null,
    platforms: normalizePlatforms(input.platforms),
    formats: normalizeFormats(input.formats),
    niches: normalizeNiches(input.niches),
  };
}

/**
 * The two-line summary the brief asks for, built only from what exists.
 *
 * Returns lines rather than one string so the caller controls wrapping, and
 * skips anything absent rather than emitting a placeholder — an empty slot is
 * honest, "Unknown subscribers" is noise.
 */
export function clientContextLines(context: CreatorClientContext, turnaround?: CreatorTurnaround | null): string[] {
  const first = [
    context.platforms.slice(0, 2).join(" · "),
    context.formats.slice(0, 1).join(""),
    context.niches.slice(0, 2).join(" · "),
    context.cadence,
  ]
    .filter(Boolean)
    .join(" · ");
  const second = [context.audience, turnaround && turnaround.hours !== null ? turnaround.label : null]
    .filter(Boolean)
    .join(" · ");
  return [first, second].filter((line) => line.length > 0);
}

/* --- one view for a whole interaction ------------------------------------- */

export type CreatorView = {
  portfolio: CreatorPortfolioItem[];
  platforms: string[];
  formats: string[];
  niches: string[];
  turnaround: CreatorTurnaround;
  terms: CreatorCommercialTerms;
  context: CreatorClientContext;
  /** True when there is anything creator-specific worth rendering at all. */
  hasEvidence: boolean;
};

/**
 * Everything a creator-hiring surface needs, from one interaction.
 *
 * Takes a structural argument rather than `OwnerInteraction` so this module
 * stays free of the workspace's types — Phase 4's manifests will call it with
 * the same shape, and a component that renders a `CreatorView` never has to
 * know which side produced it.
 */
export function creatorViewOf(input: {
  portfolio?: readonly PortfolioInput[] | null;
  job?: {
    budget?: string | null;
    channelName?: string | null;
    creator?: {
      platforms?: string[] | null;
      formats?: string[] | null;
      niches?: string[] | null;
      turnaround?: { value?: number | null; unit?: string | null; basis?: string | null } | null;
      compensation?: {
        mode?: string | null;
        minimum?: number | string | null;
        maximum?: number | string | null;
        currency?: string | null;
        unit?: string | null;
        customUnit?: string | null;
        note?: string | null;
        trialStatus?: string | null;
        trialAmount?: number | string | null;
        trialCurrency?: string | null;
        trialBasis?: string | null;
      } | null;
      channelHandle?: string | null;
      employerKind?: string | null;
      subscribers?: number | null;
      cadence?: string | null;
    } | null;
  } | null;
}): CreatorView {
  const facts = input.job?.creator ?? null;
  const portfolio = toCreatorPortfolio(input.portfolio ?? null);
  const platforms = normalizePlatforms(facts?.platforms);
  const formats = normalizeFormats(facts?.formats);
  const niches = normalizeNiches(facts?.niches);
  const turnaround = normalizeTurnaround(facts?.turnaround ?? {});
  const terms = describeCommercialTerms({
    ...(facts?.compensation ?? {}),
    // The pre-structured display string remains the fallback, so a job posted
    // before the structured model still shows its rate rather than nothing.
    legacyDisplay: input.job?.budget ?? null,
  });
  const context = describeClientContext({
    handle: facts?.channelHandle ?? null,
    channelName: input.job?.channelName ?? null,
    employerKind: facts?.employerKind ?? null,
    subscribers: facts?.subscribers ?? null,
    cadence: facts?.cadence ?? null,
    platforms,
    formats,
    niches,
  });

  return {
    portfolio,
    platforms,
    formats,
    niches,
    turnaround,
    terms,
    context,
    hasEvidence:
      portfolio.length > 0 ||
      platforms.length > 0 ||
      formats.length > 0 ||
      niches.length > 0 ||
      turnaround.hours !== null,
  };
}

/**
 * Portfolio evidence for an interaction, from wherever it actually lives.
 *
 * A received application carries its portfolio inside the applicant's answers
 * (`relevant_portfolio`) rather than on the record — that is the shape both the
 * live backend and the fixture produce, because it is what the applicant
 * literally submitted. An explicit `portfolio` field wins when present so a
 * future richer source can supersede it without changing any call site.
 */
export function portfolioForInteraction(input: {
  portfolio?: readonly PortfolioInput[] | null;
  firstMessageAnswers?: Record<string, unknown> | null;
}): CreatorPortfolioItem[] {
  if (Array.isArray(input.portfolio) && input.portfolio.length > 0) {
    return toCreatorPortfolio(input.portfolio);
  }
  const answered = input.firstMessageAnswers?.["relevant_portfolio"];
  if (Array.isArray(answered)) return toCreatorPortfolio(answered as PortfolioInput[]);
  return [];
}

/**
 * What a body of work actually covers.
 *
 * Derived from the items themselves rather than from a profile claim: a
 * recruiter looking at three finance explainers has evidence of a finance
 * editor, which is a stronger statement than a self-declared niche list.
 */
export function portfolioFacets(items: readonly CreatorPortfolioItem[]): {
  platforms: string[];
  formats: string[];
  niches: string[];
} {
  return {
    platforms: dedupe(items.map((item) => item.platform)),
    formats: dedupe(items.map((item) => item.format)),
    niches: dedupe(items.map((item) => item.niche)),
  };
}
