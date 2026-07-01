import type { Job } from "./types";

export const CREATOR_CONTEXT_MAX_ITEMS = 12;
export const CREATOR_CONTEXT_MAX_LENGTH = 40;

export const CONTENT_NICHE_SUGGESTIONS = [
  "Tech",
  "Finance",
  "Gaming",
  "Education",
  "Food",
  "Fitness",
  "Beauty",
  "Fashion",
  "Travel",
  "Business",
  "Comedy",
  "News",
  "Entertainment",
  "Sports",
  "Parenting",
  "Real estate",
  "Spirituality",
] as const;

export const CONTENT_GENRE_SUGGESTIONS = [
  "Explainers",
  "Tutorials",
  "Reviews",
  "Commentary",
  "Interviews",
  "Vlogs",
  "Podcasts",
  "Documentaries",
  "Shorts/Reels",
  "Skits",
  "Live streams",
  "Case studies",
  "Product demos",
  "Behind-the-scenes",
] as const;

export const FORMATS_HIRED_FOR_SUGGESTIONS = [
  "Long-form video",
  "Shorts/Reels",
  "Thumbnails",
  "Scripts",
  "Hooks",
  "Voice-over",
  "Motion graphics",
  "Captions",
  "Repurposed clips",
  "Channel research",
  "Content strategy",
  "Podcast editing",
  "Social posts",
  "YouTube packaging",
  "Ad creatives",
] as const;

const existsIn = (list: string[], value: string) =>
  list.some((item) => item.toLowerCase() === value.toLowerCase());

export const normalizeCreatorContextValue = (value: string) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1, CREATOR_CONTEXT_MAX_LENGTH);
};

export const normalizeCreatorContextList = (values: string[]) => {
  const out: string[] = [];
  for (const raw of values) {
    const value = normalizeCreatorContextValue(raw);
    if (!value || existsIn(out, value)) continue;
    out.push(value);
    if (out.length >= CREATOR_CONTEXT_MAX_ITEMS) break;
  }
  return out;
};

export const creatorContextFieldCount = ({
  contentNiches,
  contentGenres,
  formatsHiredFor,
}: {
  contentNiches?: string[] | null;
  contentGenres?: string[] | null;
  formatsHiredFor?: string[] | null;
}) =>
  [contentNiches, contentGenres, formatsHiredFor].filter((values) =>
    Array.isArray(values) && values.some((value) => value.trim())
  ).length;

export const isCreatorContextComplete = (context: {
  contentNiches?: string[] | null;
  contentGenres?: string[] | null;
  formatsHiredFor?: string[] | null;
}) => creatorContextFieldCount(context) >= 2;

export const jobDisplayChips = (job: Pick<Job, "formatsHiredFor" | "contentNiches" | "contentGenres" | "tags">) =>
  normalizeCreatorContextList([
    ...(job.formatsHiredFor || []),
    ...(job.contentNiches || []),
    ...(job.contentGenres || []),
    ...(job.tags || []),
  ]);
