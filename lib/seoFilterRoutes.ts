export type SeoFilterType = "jobs" | "talent";

export type SeoSelectedFilters = {
  roles?: string[];
  platforms?: string[];
  niches?: string[];
  genres?: string[];
  formats?: string[];
  workModes?: string[];
};

/**
 * The strict eligibility a listing must satisfy to appear on a curated SEO route.
 *
 * A curated route is a *filter*, not a ranking hint: unlike free-text search
 * (where a shared "YouTube" token is enough to surface a card), each present
 * group here is a hard gate. A listing is eligible only if EVERY present group
 * is satisfied, and a group is satisfied if ANY of its keywords hit the matching
 * intent field (role keywords → role-bearing fields, niche → niche fields,
 * workMode → work-mode/location). Keywords match by stem: a single word matches
 * any token that starts with it ("edit" → editor/editing/edits), a multi-word
 * phrase matches as a substring ("channel manager"). See lib/seoFilterMatch.ts.
 */
export type SeoRequiredIntent = {
  role?: string[];
  niche?: string[];
  workMode?: string[];
};

export type SeoFilterRoute = {
  type: SeoFilterType;
  slug: string;
  path: string;
  h1: string;
  chipLabel: string;
  chipGroup: "Role" | "Format" | "Work mode" | "Niche";
  selectedFilters: SeoSelectedFilters;
  /** Hard eligibility gate applied before ranking on curated route pages. */
  requiredIntent: SeoRequiredIntent;
  searchQuery: string;
  searchAliases: string[];
  metaTitle: string;
  metaDescription: string;
  related: string[];
  indexable: boolean;
};

const normalizeSearch = (value: string) =>
  value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(hire|hiring|jobs?|talents?|freelancers?|creators?)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const jobs = [
  {
    slug: "video-editor-jobs",
    h1: "Video Editor Jobs",
    chipLabel: "Video editor",
    chipGroup: "Role",
    selectedFilters: { roles: ["video editor"] },
    searchQuery: "video editor",
    searchAliases: ["video editor jobs", "youtube video editor", "video editor", "editor for youtube", "youtube editor"],
    requiredIntent: { role: ["video editor", "edit"] },
    metaTitle: "Video Editor Jobs",
    metaDescription: "Browse video editor jobs from YouTube creators, creator agencies, and creator-led teams on CreatorJobs.",
    related: ["/jobs/thumbnail-designer-jobs", "/jobs/shorts-editor-jobs", "/jobs/remote-creator-jobs", "/talent/video-editors"],
  },
  {
    slug: "thumbnail-designer-jobs",
    h1: "Thumbnail Designer Jobs",
    chipLabel: "Thumbnail designer",
    chipGroup: "Role",
    selectedFilters: { roles: ["thumbnail designer"], formats: ["thumbnails"] },
    searchQuery: "thumbnail designer thumbnails",
    searchAliases: ["thumbnail designer jobs", "youtube thumbnail designer", "thumbnail designer", "thumbnail design jobs"],
    requiredIntent: { role: ["thumbnail"] },
    metaTitle: "Thumbnail Designer Jobs",
    metaDescription: "Find thumbnail design jobs for YouTube channels, creators, and creator agencies.",
    related: ["/jobs/video-editor-jobs", "/jobs/shorts-editor-jobs", "/talent/thumbnail-designers", "/jobs/finance-youtube-editor-jobs"],
  },
  {
    slug: "shorts-editor-jobs",
    h1: "Shorts Editor Jobs",
    chipLabel: "Shorts editor",
    chipGroup: "Format",
    selectedFilters: { roles: ["shorts editor"], formats: ["shorts"] },
    searchQuery: "shorts editor",
    searchAliases: ["shorts editor jobs", "short form editor", "reels editor jobs", "shorts editor"],
    requiredIntent: { role: ["shorts", "short-form", "reels"] },
    metaTitle: "Shorts Editor Jobs",
    metaDescription: "Browse Shorts editor jobs for creator-led YouTube, Instagram, and short-form teams.",
    related: ["/jobs/video-editor-jobs", "/jobs/motion-graphics-jobs", "/talent/shorts-editors", "/jobs/remote-creator-jobs"],
  },
  {
    slug: "youtube-scriptwriter-jobs",
    h1: "YouTube Scriptwriter Jobs",
    chipLabel: "Scriptwriter",
    chipGroup: "Role",
    selectedFilters: { roles: ["scriptwriter"], platforms: ["YouTube"] },
    searchQuery: "youtube scriptwriter",
    searchAliases: ["youtube scriptwriter jobs", "youtube script writer", "scriptwriter jobs", "youtube writer"],
    requiredIntent: { role: ["scriptwriter", "script writer", "script", "writer", "writ"] },
    metaTitle: "YouTube Scriptwriter Jobs",
    metaDescription: "Find YouTube scriptwriter jobs for explainers, documentaries, creator channels, and agencies.",
    related: ["/jobs/content-strategist-jobs", "/jobs/video-editor-jobs", "/talent/youtube-scriptwriters"],
  },
  {
    slug: "channel-manager-jobs",
    h1: "Channel Manager Jobs",
    chipLabel: "Channel manager",
    chipGroup: "Role",
    selectedFilters: { roles: ["channel manager"] },
    searchQuery: "channel manager",
    searchAliases: ["channel manager jobs", "youtube channel manager", "channel operations jobs"],
    requiredIntent: { role: ["channel manager", "channel management"] },
    metaTitle: "Channel Manager Jobs",
    metaDescription: "Browse channel manager jobs for YouTube creators, creator agencies, and content teams.",
    related: ["/jobs/content-strategist-jobs", "/jobs/video-editor-jobs", "/talent/channel-managers"],
  },
  {
    slug: "content-strategist-jobs",
    h1: "Content Strategist Jobs",
    chipLabel: "Content strategist",
    chipGroup: "Role",
    selectedFilters: { roles: ["content strategist"] },
    searchQuery: "content strategist",
    searchAliases: ["content strategist jobs", "creator strategist", "youtube content strategist"],
    requiredIntent: { role: ["content strategist", "strategist"] },
    metaTitle: "Content Strategist Jobs",
    metaDescription: "Find content strategist jobs with creators, YouTube teams, and creator-led brands.",
    related: ["/jobs/channel-manager-jobs", "/jobs/youtube-scriptwriter-jobs", "/talent/content-strategists"],
  },
  {
    slug: "motion-graphics-jobs",
    h1: "Motion Graphics Jobs",
    chipLabel: "Motion graphics",
    chipGroup: "Role",
    selectedFilters: { roles: ["motion designer"] },
    searchQuery: "motion graphics motion designer",
    searchAliases: ["motion graphics jobs", "motion designer jobs", "after effects jobs"],
    requiredIntent: { role: ["motion", "kinetic", "after effects"] },
    metaTitle: "Motion Graphics Jobs",
    metaDescription: "Browse motion graphics jobs for creator videos, explainers, launch content, and YouTube channels.",
    related: ["/jobs/video-editor-jobs", "/jobs/shorts-editor-jobs", "/talent/motion-designers"],
  },
  {
    slug: "podcast-editor-jobs",
    h1: "Podcast Editor Jobs",
    chipLabel: "Podcast editor",
    chipGroup: "Role",
    selectedFilters: { roles: ["podcast producer"], formats: ["podcast"] },
    searchQuery: "podcast editor podcast producer",
    searchAliases: ["podcast editor jobs", "podcast producer jobs", "podcast clips editor"],
    requiredIntent: { role: ["podcast"] },
    metaTitle: "Podcast Editor Jobs",
    metaDescription: "Find podcast editing and production jobs for creators, interview shows, and content teams.",
    related: ["/jobs/video-editor-jobs", "/jobs/shorts-editor-jobs", "/talent/podcast-editors"],
  },
  {
    slug: "remote-creator-jobs",
    h1: "Remote Creator Jobs",
    chipLabel: "Remote",
    chipGroup: "Work mode",
    selectedFilters: { workModes: ["remote"] },
    searchQuery: "remote creator jobs",
    searchAliases: ["remote creator jobs", "remote video jobs", "remote youtube jobs", "remote creator work"],
    requiredIntent: { workMode: ["remote"] },
    metaTitle: "Remote Creator Jobs",
    metaDescription: "Browse remote jobs from creators, YouTube channels, creator agencies, and creator-led teams.",
    related: ["/jobs/video-editor-jobs", "/jobs/shorts-editor-jobs", "/talent/remote-video-editors"],
  },
  {
    slug: "finance-youtube-editor-jobs",
    h1: "Finance YouTube Editor Jobs",
    chipLabel: "Finance YouTube",
    chipGroup: "Niche",
    selectedFilters: { roles: ["video editor"], platforms: ["YouTube"], niches: ["finance"] },
    searchQuery: "finance youtube editor",
    searchAliases: ["finance youtube editor jobs", "finance video editor youtube", "finance youtube editor", "finance thumbnail youtube"],
    requiredIntent: { role: ["editor", "edit"], niche: ["finance"] },
    metaTitle: "Finance YouTube Editor Jobs",
    metaDescription: "Find YouTube editing jobs for finance creators, explainer channels, and creator agencies.",
    related: ["/jobs/video-editor-jobs", "/jobs/thumbnail-designer-jobs", "/talent/finance-video-editors"],
  },
] satisfies Array<Omit<SeoFilterRoute, "type" | "path" | "indexable">>;

const talent = [
  {
    slug: "video-editors",
    h1: "Video Editors",
    chipLabel: "Video editor",
    chipGroup: "Role",
    selectedFilters: { roles: ["video editor"] },
    searchQuery: "video editor",
    searchAliases: ["hire video editor", "video editor", "youtube editor", "youtube video editor"],
    requiredIntent: { role: ["video editor", "edit"] },
    metaTitle: "Video Editors",
    metaDescription: "Browse video editors for YouTube creators, creator agencies, and creator-led teams.",
    related: ["/talent/thumbnail-designers", "/talent/shorts-editors", "/jobs/video-editor-jobs", "/talent/remote-video-editors"],
  },
  {
    slug: "thumbnail-designers",
    h1: "Thumbnail Designers",
    chipLabel: "Thumbnail designer",
    chipGroup: "Role",
    selectedFilters: { roles: ["thumbnail designer"], formats: ["thumbnails"] },
    searchQuery: "thumbnail designer thumbnails",
    searchAliases: ["hire thumbnail designer", "thumbnail designer", "youtube thumbnail designer"],
    requiredIntent: { role: ["thumbnail"] },
    metaTitle: "Thumbnail Designers",
    metaDescription: "Browse thumbnail designers for YouTube channels, creators, and creator agencies.",
    related: ["/talent/video-editors", "/talent/shorts-editors", "/jobs/thumbnail-designer-jobs"],
  },
  {
    slug: "shorts-editors",
    h1: "Shorts Editors",
    chipLabel: "Shorts editor",
    chipGroup: "Format",
    selectedFilters: { roles: ["shorts editor"], formats: ["shorts"] },
    searchQuery: "shorts editor",
    searchAliases: ["hire shorts editor", "shorts editor", "reels editor", "short form editor"],
    requiredIntent: { role: ["shorts", "short-form", "reels"] },
    metaTitle: "Shorts Editors",
    metaDescription: "Find Shorts and Reels editors for creator-led short-form content.",
    related: ["/talent/video-editors", "/talent/motion-designers", "/jobs/shorts-editor-jobs"],
  },
  {
    slug: "youtube-scriptwriters",
    h1: "YouTube Scriptwriters",
    chipLabel: "Scriptwriter",
    chipGroup: "Role",
    selectedFilters: { roles: ["scriptwriter"], platforms: ["YouTube"] },
    searchQuery: "youtube scriptwriter",
    searchAliases: ["hire youtube scriptwriter", "youtube scriptwriter", "youtube writer", "scriptwriter"],
    requiredIntent: { role: ["scriptwriter", "script writer", "script", "writer", "writ"] },
    metaTitle: "YouTube Scriptwriters",
    metaDescription: "Browse YouTube scriptwriters for explainers, documentaries, and creator-led channels.",
    related: ["/talent/content-strategists", "/talent/video-editors", "/jobs/youtube-scriptwriter-jobs"],
  },
  {
    slug: "channel-managers",
    h1: "Channel Managers",
    chipLabel: "Channel manager",
    chipGroup: "Role",
    selectedFilters: { roles: ["channel manager"] },
    searchQuery: "channel manager",
    searchAliases: ["hire channel manager", "channel manager", "youtube channel manager"],
    requiredIntent: { role: ["channel manager", "channel management"] },
    metaTitle: "Channel Managers",
    metaDescription: "Browse channel managers for upload operations, analytics, calendars, and YouTube workflows.",
    related: ["/talent/content-strategists", "/talent/video-editors", "/jobs/channel-manager-jobs"],
  },
  {
    slug: "content-strategists",
    h1: "Content Strategists",
    chipLabel: "Content strategist",
    chipGroup: "Role",
    selectedFilters: { roles: ["content strategist"] },
    searchQuery: "content strategist",
    searchAliases: ["hire content strategist", "content strategist", "creator strategist"],
    requiredIntent: { role: ["content strategist", "strategist"] },
    metaTitle: "Content Strategists",
    metaDescription: "Find content strategists for creator positioning, packaging, and growth workflows.",
    related: ["/talent/channel-managers", "/talent/youtube-scriptwriters", "/jobs/content-strategist-jobs"],
  },
  {
    slug: "motion-designers",
    h1: "Motion Designers",
    chipLabel: "Motion designer",
    chipGroup: "Role",
    selectedFilters: { roles: ["motion designer"] },
    searchQuery: "motion designer motion graphics",
    searchAliases: ["hire motion designer", "motion designer", "motion graphics designer", "after effects designer"],
    requiredIntent: { role: ["motion", "kinetic", "after effects"] },
    metaTitle: "Motion Designers",
    metaDescription: "Browse motion designers for creator videos, explainers, launch videos, and YouTube content.",
    related: ["/talent/video-editors", "/talent/shorts-editors", "/jobs/motion-graphics-jobs"],
  },
  {
    slug: "podcast-editors",
    h1: "Podcast Editors",
    chipLabel: "Podcast editor",
    chipGroup: "Role",
    selectedFilters: { roles: ["podcast producer"], formats: ["podcast"] },
    searchQuery: "podcast editor podcast producer",
    searchAliases: ["hire podcast editor", "podcast editor", "podcast producer", "podcast clips editor"],
    requiredIntent: { role: ["podcast"] },
    metaTitle: "Podcast Editors",
    metaDescription: "Find podcast editors and producers for creator-led shows, clips, and upload workflows.",
    related: ["/talent/video-editors", "/talent/shorts-editors", "/jobs/podcast-editor-jobs"],
  },
  {
    slug: "finance-video-editors",
    h1: "Finance Video Editors",
    chipLabel: "Finance editor",
    chipGroup: "Niche",
    selectedFilters: { roles: ["video editor"], niches: ["finance"] },
    searchQuery: "finance video editor",
    searchAliases: ["hire finance video editor", "finance video editor", "finance youtube editor"],
    requiredIntent: { role: ["editor", "edit"], niche: ["finance"] },
    metaTitle: "Finance Video Editors",
    metaDescription: "Browse video editors with finance creator experience for YouTube and explainer work.",
    related: ["/talent/video-editors", "/talent/thumbnail-designers", "/jobs/finance-youtube-editor-jobs"],
  },
  {
    slug: "remote-video-editors",
    h1: "Remote Video Editors",
    chipLabel: "Remote editor",
    chipGroup: "Work mode",
    selectedFilters: { roles: ["video editor"], workModes: ["remote"] },
    searchQuery: "remote video editor",
    searchAliases: ["hire remote video editor", "remote video editor", "remote youtube editor"],
    requiredIntent: { role: ["editor", "edit"], workMode: ["remote"] },
    metaTitle: "Remote Video Editors",
    metaDescription: "Browse remote video editors for YouTube creators, agencies, and creator-led teams.",
    related: ["/talent/video-editors", "/talent/shorts-editors", "/jobs/remote-creator-jobs"],
  },
] satisfies Array<Omit<SeoFilterRoute, "type" | "path" | "indexable">>;

const withRouteFields = (type: SeoFilterType, route: Omit<SeoFilterRoute, "type" | "path" | "indexable">): SeoFilterRoute => ({
  ...route,
  type,
  path: `/${type}/${route.slug}`,
  indexable: true,
});

export const SEO_FILTER_ROUTES: SeoFilterRoute[] = [
  ...jobs.map((route) => withRouteFields("jobs", route)),
  ...talent.map((route) => withRouteFields("talent", route)),
];

export const seoFilterRoutesForType = (type: SeoFilterType) =>
  SEO_FILTER_ROUTES.filter((route) => route.type === type);

export const getSeoFilterRoute = (type: SeoFilterType, slug: string) =>
  SEO_FILTER_ROUTES.find((route) => route.type === type && route.slug === slug) || null;

export const getSeoFilterRouteByPath = (path: string) =>
  SEO_FILTER_ROUTES.find((route) => route.path === path) || null;

export const getRelatedSeoRoutes = (route: SeoFilterRoute) =>
  route.related.map(getSeoFilterRouteByPath).filter((item): item is SeoFilterRoute => Boolean(item));

export const seoSelectedChipLabels = (route?: SeoFilterRoute | null): string[] =>
  route ? [route.chipLabel] : [];

export const findSeoRouteForSearchQuery = (type: SeoFilterType, query: string): SeoFilterRoute | null => {
  const normalized = normalizeSearch(query);
  if (!normalized) return null;

  const candidates = seoFilterRoutesForType(type)
    .map((route) => ({
      route,
      aliases: [route.searchQuery, route.h1, route.chipLabel, ...route.searchAliases].map(normalizeSearch),
    }))
    .filter(({ aliases }) => aliases.some((alias) => alias && alias === normalized));

  if (candidates.length > 0) return candidates[0].route;

  return null;
};

export const seoFilterSitemapRoutes = () => SEO_FILTER_ROUTES.filter((route) => route.indexable);

