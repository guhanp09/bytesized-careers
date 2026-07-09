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
  // Added for the hierarchical subfilter system: platform/format/genre/language
  // are now hard gate groups too (previously display-only in selectedFilters),
  // so a curated combo like "youtube shorts editors" or "hindi scriptwriters"
  // gates strictly on platform+format / language.
  platform?: string[];
  format?: string[];
  genre?: string[];
  language?: string[];
};

export type SeoFilterRoute = {
  type: SeoFilterType;
  slug: string;
  path: string;
  h1: string;
  chipLabel: string;
  chipGroup: "Role" | "Format" | "Work mode" | "Niche" | "Platform" | "Genre" | "Language";
  selectedFilters: SeoSelectedFilters;
  /** Hard eligibility gate applied before ranking on curated route pages. */
  requiredIntent: SeoRequiredIntent;
  searchQuery: string;
  searchAliases: string[];
  metaTitle: string;
  metaDescription: string;
  related: string[];
  /** A curated route that may be indexed (all registry routes are curated). */
  indexable: boolean;
  /**
   * "Vouched for indexing." Only routes with enough genuinely-relevant supply
   * (docs threshold: jobs ≥5 listings, talent ≥8–10 profiles) are set true —
   * they become self-canonical + indexable + in the sitemap. Un-vouched curated
   * routes still render as chips and work for users, but the slug page is
   * noindex,follow and excluded from the sitemap until promoted. This is a
   * static registry flag so the sitemap stays a cheap read (no per-request
   * dataset scan); a later Search-Console/offline supply job flips it.
   */
  sitemapEligible: boolean;
};

/** Authoring shape: `type`/`path`/`indexable` are derived; `sitemapEligible` optional. */
type AuthoredRoute = Omit<SeoFilterRoute, "type" | "path" | "indexable" | "sitemapEligible"> & {
  sitemapEligible?: boolean;
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
  // ---- New curated combos (unvouched: sitemapEligible false → work for users,
  //      noindex, not sitemapped until supply clears the threshold, §6.2). ----
  {
    slug: "remote-video-editor-jobs",
    h1: "Remote Video Editor Jobs",
    chipLabel: "Video editor",
    chipGroup: "Work mode",
    selectedFilters: { roles: ["video editor"], workModes: ["remote"] },
    requiredIntent: { role: ["video editor", "edit"], workMode: ["remote"] },
    searchQuery: "remote video editor",
    searchAliases: ["remote video editor jobs", "remote youtube editor jobs", "wfh video editor"],
    metaTitle: "Remote Video Editor Jobs",
    metaDescription: "Browse remote video editor jobs from YouTube creators, agencies, and creator-led teams.",
    related: ["/jobs/video-editor-jobs", "/jobs/remote-creator-jobs", "/talent/remote-video-editors"],
    sitemapEligible: false,
  },
  {
    slug: "gaming-video-editor-jobs",
    h1: "Gaming Video Editor Jobs",
    chipLabel: "Video editor",
    chipGroup: "Niche",
    selectedFilters: { roles: ["video editor"], niches: ["gaming"] },
    requiredIntent: { role: ["video editor", "edit"], niche: ["gaming"] },
    searchQuery: "gaming video editor",
    searchAliases: ["gaming video editor jobs", "gaming youtube editor", "game editor jobs"],
    metaTitle: "Gaming Video Editor Jobs",
    metaDescription: "Find video editor jobs for gaming creators, gaming channels, and creator agencies.",
    related: ["/jobs/video-editor-jobs", "/jobs/shorts-editor-jobs", "/talent/gaming-video-editors"],
    sitemapEligible: false,
  },
  {
    slug: "finance-thumbnail-designer-jobs",
    h1: "Finance Thumbnail Designer Jobs",
    chipLabel: "Thumbnail designer",
    chipGroup: "Niche",
    selectedFilters: { roles: ["thumbnail designer"], niches: ["finance"], formats: ["thumbnails"] },
    requiredIntent: { role: ["thumbnail"], niche: ["finance"] },
    searchQuery: "finance thumbnail designer",
    searchAliases: ["finance thumbnail designer jobs", "finance youtube thumbnail"],
    metaTitle: "Finance Thumbnail Designer Jobs",
    metaDescription: "Find thumbnail design jobs for finance creators, explainer channels, and agencies.",
    related: ["/jobs/thumbnail-designer-jobs", "/jobs/finance-youtube-editor-jobs", "/talent/finance-thumbnail-designers"],
    sitemapEligible: false,
  },
  {
    slug: "instagram-reels-editor-jobs",
    h1: "Instagram Reels Editor Jobs",
    chipLabel: "Shorts editor",
    chipGroup: "Platform",
    selectedFilters: { roles: ["shorts editor"], platforms: ["Instagram"], formats: ["shorts"] },
    requiredIntent: { role: ["shorts", "short-form", "reels"], platform: ["instagram", "reels"] },
    searchQuery: "instagram reels editor",
    searchAliases: ["instagram reels editor jobs", "reels editor jobs", "instagram video editor"],
    metaTitle: "Instagram Reels Editor Jobs",
    metaDescription: "Browse Instagram Reels editor jobs for creators and short-form teams.",
    related: ["/jobs/shorts-editor-jobs", "/jobs/video-editor-jobs", "/talent/shorts-editors"],
    sitemapEligible: false,
  },
  {
    slug: "hindi-scriptwriter-jobs",
    h1: "Hindi Scriptwriter Jobs",
    chipLabel: "Scriptwriter",
    chipGroup: "Role",
    selectedFilters: { roles: ["scriptwriter"], platforms: ["YouTube"] },
    requiredIntent: { role: ["scriptwriter", "script writer", "script", "writer", "writ"], language: ["hindi"] },
    searchQuery: "hindi scriptwriter",
    searchAliases: ["hindi scriptwriter jobs", "hindi script writer", "hindi youtube writer"],
    metaTitle: "Hindi Scriptwriter Jobs",
    metaDescription: "Find Hindi scriptwriter jobs for YouTube explainers, documentaries, and creator channels.",
    related: ["/jobs/youtube-scriptwriter-jobs", "/jobs/content-strategist-jobs", "/talent/hindi-scriptwriters"],
    sitemapEligible: false,
  },
] satisfies AuthoredRoute[];

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
  // ---- New curated combos (unvouched: sitemapEligible false). ----
  {
    slug: "gaming-video-editors",
    h1: "Gaming Video Editors",
    chipLabel: "Video editor",
    chipGroup: "Niche",
    selectedFilters: { roles: ["video editor"], niches: ["gaming"] },
    requiredIntent: { role: ["video editor", "edit"], niche: ["gaming"] },
    searchQuery: "gaming video editor",
    searchAliases: ["hire gaming video editor", "gaming video editor", "gaming youtube editor"],
    metaTitle: "Gaming Video Editors",
    metaDescription: "Browse video editors with gaming creator experience for YouTube and short-form work.",
    related: ["/talent/video-editors", "/talent/shorts-editors", "/jobs/gaming-video-editor-jobs"],
    sitemapEligible: false,
  },
  {
    slug: "youtube-shorts-editors",
    h1: "YouTube Shorts Editors",
    chipLabel: "Shorts editor",
    chipGroup: "Platform",
    selectedFilters: { roles: ["shorts editor"], platforms: ["YouTube"], formats: ["shorts"] },
    requiredIntent: { role: ["shorts", "short-form", "reels"], platform: ["youtube"] },
    searchQuery: "youtube shorts editor",
    searchAliases: ["hire youtube shorts editor", "youtube shorts editor", "youtube short form editor"],
    metaTitle: "YouTube Shorts Editors",
    metaDescription: "Find Shorts editors for creator-led YouTube short-form content.",
    related: ["/talent/shorts-editors", "/talent/video-editors", "/jobs/shorts-editor-jobs"],
    sitemapEligible: false,
  },
  {
    slug: "finance-thumbnail-designers",
    h1: "Finance Thumbnail Designers",
    chipLabel: "Thumbnail designer",
    chipGroup: "Niche",
    selectedFilters: { roles: ["thumbnail designer"], niches: ["finance"], formats: ["thumbnails"] },
    requiredIntent: { role: ["thumbnail"], niche: ["finance"] },
    searchQuery: "finance thumbnail designer",
    searchAliases: ["hire finance thumbnail designer", "finance thumbnail designer", "finance youtube thumbnail"],
    metaTitle: "Finance Thumbnail Designers",
    metaDescription: "Browse thumbnail designers with finance creator experience for YouTube packaging.",
    related: ["/talent/thumbnail-designers", "/talent/video-editors", "/jobs/finance-thumbnail-designer-jobs"],
    sitemapEligible: false,
  },
  {
    slug: "hindi-scriptwriters",
    h1: "Hindi Scriptwriters",
    chipLabel: "Scriptwriter",
    chipGroup: "Role",
    selectedFilters: { roles: ["scriptwriter"], platforms: ["YouTube"] },
    requiredIntent: { role: ["scriptwriter", "script writer", "script", "writer", "writ"], language: ["hindi"] },
    searchQuery: "hindi scriptwriter",
    searchAliases: ["hire hindi scriptwriter", "hindi scriptwriter", "hindi youtube writer"],
    metaTitle: "Hindi Scriptwriters",
    metaDescription: "Browse Hindi scriptwriters for YouTube explainers, documentaries, and creator channels.",
    related: ["/talent/youtube-scriptwriters", "/talent/content-strategists", "/jobs/hindi-scriptwriter-jobs"],
    sitemapEligible: false,
  },
  {
    slug: "tamil-scriptwriters",
    h1: "Tamil Scriptwriters",
    chipLabel: "Scriptwriter",
    chipGroup: "Role",
    selectedFilters: { roles: ["scriptwriter"] },
    requiredIntent: { role: ["scriptwriter", "script writer", "script", "writer", "writ"], language: ["tamil"] },
    searchQuery: "tamil scriptwriter",
    searchAliases: ["hire tamil scriptwriter", "tamil scriptwriter", "tamil youtube writer"],
    metaTitle: "Tamil Scriptwriters",
    metaDescription: "Browse Tamil scriptwriters for YouTube explainers, documentaries, and creator channels.",
    related: ["/talent/youtube-scriptwriters", "/talent/hindi-scriptwriters", "/jobs/youtube-scriptwriter-jobs"],
    sitemapEligible: false,
  },
] satisfies AuthoredRoute[];

const withRouteFields = (type: SeoFilterType, route: AuthoredRoute): SeoFilterRoute => ({
  ...route,
  type,
  path: `/${type}/${route.slug}`,
  indexable: true,
  // Existing curated routes are vouched by default (unchanged live behavior);
  // new routes must opt in explicitly (default false = works for users, noindex,
  // not sitemapped) until they clear the supply threshold.
  sitemapEligible: route.sitemapEligible ?? true,
});

export const SEO_FILTER_ROUTES: SeoFilterRoute[] = [
  ...jobs.map((route) => withRouteFields("jobs", route)),
  ...talent.map((route) => withRouteFields("talent", route)),
];

export const seoFilterRoutesForType = (type: SeoFilterType) =>
  SEO_FILTER_ROUTES.filter((route) => route.type === type);

/**
 * Row-1 chips: one chip per distinct chipLabel (originals are defined first, so
 * they win). New curated *combos* reuse an existing role's label (e.g.
 * gaming-video-editors → "Video editor") and are therefore Row-2-only — reached
 * via a subfilter chip, search, or a direct URL, never a duplicate Row-1 chip.
 */
export const primaryRoleChipsForType = (type: SeoFilterType): SeoFilterRoute[] => {
  const seen = new Set<string>();
  const out: SeoFilterRoute[] = [];
  for (const route of seoFilterRoutesForType(type)) {
    const key = route.chipLabel.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(route);
  }
  return out;
};

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

/**
 * Routes eligible for the sitemap: curated AND vouched. A cheap registry read —
 * deliberately NOT a supply scan over the jobs/talent dataset (see SeoFilterRoute
 * .sitemapEligible). Un-vouched routes still render as chips and work for users.
 */
export const seoFilterSitemapRoutes = () =>
  SEO_FILTER_ROUTES.filter((route) => route.indexable && route.sitemapEligible);

/** A curated route is index-approved (indexable metadata) only when vouched. */
export const isSeoRouteIndexApproved = (route: SeoFilterRoute): boolean =>
  route.indexable && route.sitemapEligible;

// ---------------------------------------------------------------------------
// Row-1 quick filters (NOT roles) + Row-2 contextual subfilters
// ---------------------------------------------------------------------------

export type SubfilterDimension =
  | "platform"
  | "format"
  | "niche"
  | "genre"
  | "workMode"
  | "tool"
  | "language"
  | "experience"
  | "availability";

export type SubfilterGroup =
  | "Platform"
  | "Format"
  | "Niche"
  | "Genre"
  | "Work mode"
  | "Tools"
  | "Language"
  | "Experience"
  | "Availability";

/**
 * A Row-1 quick filter. Deliberately modelled apart from role chips: Remote is a
 * work mode and YouTube is a platform — never roles. Applied as a query param on
 * the base list (noindex), never a role slug.
 */
export type QuickFilter = { label: string; dimension: "workMode" | "platform"; value: string };

export const QUICK_FILTERS: Record<SeoFilterType, QuickFilter[]> = {
  jobs: [
    { label: "Remote", dimension: "workMode", value: "remote" },
    { label: "YouTube", dimension: "platform", value: "youtube" },
  ],
  talent: [
    { label: "Remote", dimension: "workMode", value: "remote" },
    { label: "YouTube", dimension: "platform", value: "youtube" },
  ],
};

/**
 * A Row-2 contextual refinement chip. `value` is the canonical value used for
 * both filtering and the `?<dimension>=` param. If `curatedPath` is set, the
 * chip navigates to that curated combo route (self-canonical) instead of
 * toggling a param — so users land on the indexable page when one exists.
 */
export type SubfilterChip = {
  label: string;
  group: SubfilterGroup;
  dimension: SubfilterDimension;
  value: string;
  curatedPath?: string;
};

/** The canonical role a route is anchored to (role/niche/workmode routes all anchor a role). */
export const roleForRoute = (route?: SeoFilterRoute | null): string | null =>
  route?.selectedFilters.roles?.[0] ?? null;

/**
 * The plain Row-1 route for a role (e.g. "thumbnail designer" → /jobs/thumbnail-designer-jobs).
 * Used to "deselect" a curated-combo Row-2 chip: navigating back to the role's
 * own base route, not just re-linking to the combo you're already on.
 */
export const baseRouteForRole = (type: SeoFilterType, roleCanonical: string | null): SeoFilterRoute | null => {
  if (!roleCanonical) return null;
  const target = roleCanonical.toLowerCase();
  return (
    primaryRoleChipsForType(type).find((route) =>
      (route.selectedFilters.roles ?? []).some((role) => role.toLowerCase() === target)
    ) ?? null
  );
};

/** Query-param key for a subfilter dimension. */
export const subfilterParam = (dimension: SubfilterDimension): string =>
  dimension === "workMode" ? "workMode" : dimension;

/** Contextual Row-2 chips for the active role (empty when no role is active). */
export const subfiltersForRole = (type: SeoFilterType, roleCanonical: string | null): SubfilterChip[] =>
  roleCanonical ? TIER2_SUBFILTERS[type][roleCanonical] ?? [] : [];

/** Contextual Row-2 chips for the role a route anchors. */
export const subfiltersForRoute = (route?: SeoFilterRoute | null): SubfilterChip[] =>
  route ? subfiltersForRole(route.type, roleForRoute(route)) : [];

/** Values a curated route already implies for a dimension (from selectedFilters). */
const selectedValuesForDimension = (route: SeoFilterRoute | null | undefined, dimension: SubfilterDimension): string[] => {
  if (!route) return [];
  const f = route.selectedFilters;
  switch (dimension) {
    case "platform":
      return f.platforms ?? [];
    case "niche":
      return f.niches ?? [];
    case "genre":
      return f.genres ?? [];
    case "format":
      return f.formats ?? [];
    case "workMode":
      return f.workModes ?? [];
    default:
      return []; // language/tool/experience/availability are param- or curatedPath-only
  }
};

const paramValues = (params: URLSearchParams, key: string): string[] =>
  (params.get(key) ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

/**
 * A Row-2 chip is active when: it's the curated combo you're currently on; OR its
 * value is implied by the route's selectedFilters (combo routes); OR it's present
 * in the corresponding query param.
 */
export function isSubfilterActive(
  route: SeoFilterRoute | null | undefined,
  chip: SubfilterChip,
  params: URLSearchParams
): boolean {
  if (chip.curatedPath) return route?.path === chip.curatedPath;
  const target = chip.value.toLowerCase();
  if (selectedValuesForDimension(route, chip.dimension).some((v) => v.toLowerCase() === target)) return true;
  return paramValues(params, subfilterParam(chip.dimension)).includes(target);
}

/**
 * Toggle a Row-2 refinement param on the current path, returning the next href.
 * Multi-select for keyword dims; single-select (replace/clear) for the structured
 * experience/availability dims.
 */
export function subfilterToggleHref(
  basePath: string,
  params: URLSearchParams,
  chip: SubfilterChip
): string {
  const key = subfilterParam(chip.dimension);
  const next = new URLSearchParams(params.toString());
  const current = (next.get(key) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const has = current.some((v) => v.toLowerCase() === chip.value.toLowerCase());
  const single = chip.dimension === "experience" || chip.dimension === "availability";
  const updated = has
    ? current.filter((v) => v.toLowerCase() !== chip.value.toLowerCase())
    : single
      ? [chip.value]
      : [...current, chip.value];
  if (updated.length) next.set(key, updated.join(","));
  else next.delete(key);
  const qs = next.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/**
 * The href for a Row-2 chip, covering both chip kinds correctly:
 *  - Param chips (no curatedPath) always toggle via `subfilterToggleHref` —
 *    clicking an active one already removes it.
 *  - Curated-combo chips (curatedPath set) are a one-way `<Link>` to that route
 *    when inactive; but that same href would just re-link to the page you're
 *    already on when active, with no way back. When active, this instead routes
 *    to the role's plain base route (preserving any other refinement params),
 *    so the combo can be deselected like every other chip.
 */
export function subfilterHref(
  route: SeoFilterRoute,
  chip: SubfilterChip,
  active: boolean,
  pathname: string,
  params: URLSearchParams
): string {
  if (!chip.curatedPath) return subfilterToggleHref(pathname, params, chip);
  if (!active) return chip.curatedPath;
  const basePath = baseRouteForRole(route.type, roleForRoute(route))?.path ?? route.path;
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

// ---------------------------------------------------------------------------
// Per-role Row-2 subfilter definitions. Keyed by the role value used in each
// route's selectedFilters.roles (e.g. "scriptwriter", "motion designer"). Only
// contextually-useful refinements per role — never a dimension dump. `curatedPath`
// points a single-refinement chip at an existing curated combo route (so users
// land on the indexable page); everything else toggles a `?<dimension>=` param.
// Tool/language/experience/availability appear only for talent (real fields).
// ---------------------------------------------------------------------------

const sf = (
  label: string,
  group: SubfilterGroup,
  dimension: SubfilterDimension,
  value: string,
  curatedPath?: string
): SubfilterChip => ({ label, group, dimension, value, curatedPath });

// Shared refinement building blocks.
const EXPERIENCE_CHIPS: SubfilterChip[] = [
  sf("0–1 yrs", "Experience", "experience", "0-1"),
  sf("2–4 yrs", "Experience", "experience", "2-4"),
  sf("5+ yrs", "Experience", "experience", "5+"),
];
const AVAILABLE_CHIP = sf("Available now", "Availability", "availability", "available");

const TIER2_SUBFILTERS: Record<SeoFilterType, Record<string, SubfilterChip[]>> = {
  jobs: {
    "video editor": [
      sf("YouTube", "Platform", "platform", "youtube"),
      sf("Instagram", "Platform", "platform", "instagram"),
      sf("TikTok", "Platform", "platform", "tiktok"),
      sf("Long-form", "Format", "format", "long-form"),
      sf("Shorts/Reels", "Format", "format", "shorts"),
      sf("Captions", "Format", "format", "captions"),
      sf("Finance", "Niche", "niche", "finance", "/jobs/finance-youtube-editor-jobs"),
      sf("Gaming", "Niche", "niche", "gaming", "/jobs/gaming-video-editor-jobs"),
      sf("Tech", "Niche", "niche", "tech"),
      sf("Education", "Niche", "niche", "education"),
      sf("Remote", "Work mode", "workMode", "remote", "/jobs/remote-video-editor-jobs"),
      sf("Full-time", "Work mode", "workMode", "full-time"),
    ],
    "thumbnail designer": [
      sf("YouTube", "Platform", "platform", "youtube"),
      sf("Thumbnails", "Format", "format", "thumbnail"),
      sf("YouTube packaging", "Format", "format", "packaging"),
      sf("Finance", "Niche", "niche", "finance", "/jobs/finance-thumbnail-designer-jobs"),
      sf("Gaming", "Niche", "niche", "gaming"),
      sf("Tech", "Niche", "niche", "tech"),
      sf("Remote", "Work mode", "workMode", "remote"),
    ],
    scriptwriter: [
      sf("YouTube", "Platform", "platform", "youtube"),
      sf("Explainers", "Genre", "genre", "explainer"),
      sf("Documentary", "Genre", "genre", "documentar"),
      sf("Hooks", "Format", "format", "hook"),
      sf("Scripts", "Format", "format", "script"),
      sf("Hindi", "Language", "language", "hindi", "/jobs/hindi-scriptwriter-jobs"),
      sf("English", "Language", "language", "english"),
      sf("Finance", "Niche", "niche", "finance"),
      sf("Education", "Niche", "niche", "education"),
      sf("Remote", "Work mode", "workMode", "remote"),
    ],
    "shorts editor": [
      sf("YouTube", "Platform", "platform", "youtube"),
      sf("Instagram", "Platform", "platform", "instagram", "/jobs/instagram-reels-editor-jobs"),
      sf("TikTok", "Platform", "platform", "tiktok"),
      sf("Shorts/Reels", "Format", "format", "shorts"),
      sf("Captions", "Format", "format", "captions"),
      sf("Gaming", "Niche", "niche", "gaming"),
      sf("Fitness", "Niche", "niche", "fitness"),
      sf("Remote", "Work mode", "workMode", "remote"),
    ],
    "motion designer": [
      sf("Motion graphics", "Format", "format", "motion"),
      sf("Tech", "Niche", "niche", "tech"),
      sf("Finance", "Niche", "niche", "finance"),
      sf("Explainers", "Genre", "genre", "explainer"),
      sf("Remote", "Work mode", "workMode", "remote"),
    ],
    "channel manager": [
      sf("YouTube", "Platform", "platform", "youtube"),
      sf("Finance", "Niche", "niche", "finance"),
      sf("Tech", "Niche", "niche", "tech"),
      sf("Gaming", "Niche", "niche", "gaming"),
      sf("Remote", "Work mode", "workMode", "remote"),
      sf("Full-time", "Work mode", "workMode", "full-time"),
    ],
    "content strategist": [
      sf("YouTube", "Platform", "platform", "youtube"),
      sf("Finance", "Niche", "niche", "finance"),
      sf("Tech", "Niche", "niche", "tech"),
      sf("Education", "Niche", "niche", "education"),
      sf("Remote", "Work mode", "workMode", "remote"),
    ],
    "podcast producer": [
      sf("Podcast editing", "Format", "format", "podcast"),
      sf("Captions", "Format", "format", "captions"),
      sf("YouTube", "Platform", "platform", "youtube"),
      sf("Remote", "Work mode", "workMode", "remote"),
    ],
  },
  talent: {
    "video editor": [
      sf("YouTube", "Platform", "platform", "youtube"),
      sf("Instagram", "Platform", "platform", "instagram"),
      sf("Long-form", "Format", "format", "long-form"),
      sf("Shorts/Reels", "Format", "format", "shorts"),
      sf("Finance", "Niche", "niche", "finance", "/talent/finance-video-editors"),
      sf("Gaming", "Niche", "niche", "gaming", "/talent/gaming-video-editors"),
      sf("Tech", "Niche", "niche", "tech"),
      sf("Premiere Pro", "Tools", "tool", "premiere"),
      sf("After Effects", "Tools", "tool", "after effects"),
      sf("DaVinci Resolve", "Tools", "tool", "davinci"),
      sf("CapCut", "Tools", "tool", "capcut"),
      sf("Hindi", "Language", "language", "hindi"),
      sf("English", "Language", "language", "english"),
      sf("Tamil", "Language", "language", "tamil"),
      ...EXPERIENCE_CHIPS,
      AVAILABLE_CHIP,
      sf("Remote", "Work mode", "workMode", "remote", "/talent/remote-video-editors"),
    ],
    "thumbnail designer": [
      sf("Thumbnails", "Format", "format", "thumbnail"),
      sf("YouTube packaging", "Format", "format", "packaging"),
      sf("Finance", "Niche", "niche", "finance", "/talent/finance-thumbnail-designers"),
      sf("Gaming", "Niche", "niche", "gaming"),
      sf("Tech", "Niche", "niche", "tech"),
      sf("Photoshop", "Tools", "tool", "photoshop"),
      sf("Canva", "Tools", "tool", "canva"),
      sf("Figma", "Tools", "tool", "figma"),
      sf("Illustrator", "Tools", "tool", "illustrator"),
      sf("Hindi", "Language", "language", "hindi"),
      sf("English", "Language", "language", "english"),
      ...EXPERIENCE_CHIPS,
      AVAILABLE_CHIP,
    ],
    scriptwriter: [
      sf("Explainers", "Genre", "genre", "explainer"),
      sf("Documentary", "Genre", "genre", "documentar"),
      sf("Hooks", "Format", "format", "hook"),
      sf("Scripts", "Format", "format", "script"),
      sf("Hindi", "Language", "language", "hindi", "/talent/hindi-scriptwriters"),
      sf("English", "Language", "language", "english"),
      sf("Tamil", "Language", "language", "tamil", "/talent/tamil-scriptwriters"),
      sf("Finance", "Niche", "niche", "finance"),
      sf("Education", "Niche", "niche", "education"),
      sf("Notion", "Tools", "tool", "notion"),
      ...EXPERIENCE_CHIPS,
      AVAILABLE_CHIP,
    ],
    "shorts editor": [
      sf("YouTube", "Platform", "platform", "youtube", "/talent/youtube-shorts-editors"),
      sf("Instagram", "Platform", "platform", "instagram"),
      sf("TikTok", "Platform", "platform", "tiktok"),
      sf("Shorts/Reels", "Format", "format", "shorts"),
      sf("Captions", "Format", "format", "captions"),
      sf("Gaming", "Niche", "niche", "gaming"),
      sf("Premiere Pro", "Tools", "tool", "premiere"),
      sf("CapCut", "Tools", "tool", "capcut"),
      sf("After Effects", "Tools", "tool", "after effects"),
      ...EXPERIENCE_CHIPS,
      AVAILABLE_CHIP,
    ],
    "motion designer": [
      sf("Motion graphics", "Format", "format", "motion"),
      sf("Tech", "Niche", "niche", "tech"),
      sf("Finance", "Niche", "niche", "finance"),
      sf("After Effects", "Tools", "tool", "after effects"),
      sf("Blender", "Tools", "tool", "blender"),
      sf("Cinema 4D", "Tools", "tool", "cinema 4d"),
      ...EXPERIENCE_CHIPS,
      AVAILABLE_CHIP,
    ],
    "channel manager": [
      sf("YouTube", "Platform", "platform", "youtube"),
      sf("Finance", "Niche", "niche", "finance"),
      sf("Tech", "Niche", "niche", "tech"),
      ...EXPERIENCE_CHIPS,
      AVAILABLE_CHIP,
    ],
    "content strategist": [
      sf("YouTube", "Platform", "platform", "youtube"),
      sf("Finance", "Niche", "niche", "finance"),
      sf("Education", "Niche", "niche", "education"),
      ...EXPERIENCE_CHIPS,
      AVAILABLE_CHIP,
    ],
    "podcast producer": [
      sf("Podcast editing", "Format", "format", "podcast"),
      sf("Captions", "Format", "format", "captions"),
      sf("Descript", "Tools", "tool", "descript"),
      sf("Audition", "Tools", "tool", "audition"),
      AVAILABLE_CHIP,
    ],
  },
};

