/**
 * What every route says to a search engine, decided once and checked.
 *
 * Routes arrive one at a time, and nobody adding a page thinks about indexing.
 * The default is "indexable", so a new authenticated workspace page is publicly
 * indexable the day it ships, and nothing about the pull request says so. The
 * registry below turns that into a test failure: a `page.tsx` with no entry here
 * fails `tests/routeIndexing.test.mjs`.
 *
 * The rule that is easy to get wrong, and is wrong here today: `Disallow` in
 * robots.txt and `noindex` in a page's metadata do NOT stack. Disallow says do
 * not fetch; noindex says do not index — and the crawler has to fetch the page to
 * read the noindex. Disallowing a URL therefore *prevents* its noindex from ever
 * being seen, and a disallowed URL that is linked from anywhere can still be
 * listed, as a bare URL with no description.
 *
 * So each classification names ONE mechanism, and a route may not use both:
 *
 *   PUBLIC_INDEXABLE  crawlable, self-canonical, indexed. The product surface.
 *   PUBLIC_NOINDEX    crawlable so the noindex is read, deliberately not indexed.
 *                     Archived legal versions and filtered listings live here:
 *                     real pages that must not compete with their canonical.
 *   PRIVATE_NOINDEX   crawlable, noindex. Authenticated surfaces. Crawling costs
 *                     nothing (they redirect), and being fetched is the only way
 *                     the noindex is honoured.
 *   ROBOTS_DISALLOW   not fetchable, and cannot carry metadata at all — API
 *                     routes and non-HTML endpoints. Disallow is the only tool
 *                     available, and its weakness is accepted knowingly.
 *   DEVELOPMENT_ONLY  must not be reachable in production. Not an indexing
 *                     decision; an existence decision.
 */

export type RouteIndexing =
  | "PUBLIC_INDEXABLE"
  | "PUBLIC_NOINDEX"
  | "PRIVATE_NOINDEX"
  | "ROBOTS_DISALLOW"
  | "DEVELOPMENT_ONLY";

export type RouteContract = {
  indexing: RouteIndexing;
  /** Why this route is classified this way, in terms of what goes wrong otherwise. */
  why: string;
};

/**
 * Keyed by the route path as a user sees it, with Next's dynamic segments left
 * in place. Ordered public-first, because that is the part someone is usually
 * looking for.
 */
export const ROUTE_INDEXING: Record<string, RouteContract> = {
  "/": {
    indexing: "PUBLIC_INDEXABLE",
    why: "The home page. The one route whose absence from an index would be noticed immediately.",
  },
  "/jobs": {
    indexing: "PUBLIC_INDEXABLE",
    why: "The job listing surface, and the primary reason anyone arrives from a search engine. Self-canonical; a filtered variant of it noindexes itself.",
  },
  "/jobs/[id]": {
    indexing: "PUBLIC_INDEXABLE",
    why: "One job. Carries JobPosting structured data, so it is also what a job aggregator reads.",
  },
  "/talent": {
    indexing: "PUBLIC_INDEXABLE",
    why: "The talent listing surface, mirroring /jobs including the filtered-variant rule.",
  },
  "/talent/[id]": {
    indexing: "PUBLIC_INDEXABLE",
    why: "One creator's public listing, which is the thing a recruiter is searching for.",
  },
  "/u/[slug]": {
    indexing: "PUBLIC_INDEXABLE",
    why: "A public profile. Deliberately indexable: it is the page a creator shares as their own.",
  },
  "/u/[slug]/projects/[projectId]": {
    indexing: "PUBLIC_INDEXABLE",
    why: "One portfolio project on a public profile. Reachable from the profile and shared directly, so it needs its own title, description and self-canonical rather than inheriting the site defaults.",
  },
  "/faq": {
    indexing: "PUBLIC_INDEXABLE",
    why: "Answers questions people search for in words rather than by filter.",
  },
  "/support": {
    indexing: "PUBLIC_INDEXABLE",
    why: "How to reach a human. Withholding it from search helps nobody.",
  },
  "/terms": {
    indexing: "PUBLIC_INDEXABLE",
    why: "The canonical current wording. Has to be findable to be agreed to.",
  },
  "/privacy": {
    indexing: "PUBLIC_INDEXABLE",
    why: "The current privacy wording, which has to be findable by anyone deciding whether to sign up.",
  },

  "/terms/[version]": {
    indexing: "PUBLIC_NOINDEX",
    why: "An immutable archived version, retrievable so an acceptance record stays readable. It must not compete in search with the current wording — someone arriving from a search engine should never land on superseded terms — so it noindexes and canonicalises to /terms.",
  },
  "/privacy/[version]": {
    indexing: "PUBLIC_NOINDEX",
    why: "An archived privacy version, kept retrievable for the same reason and canonicalised to /privacy so it cannot outrank the current wording.",
  },
  "/search": {
    indexing: "PUBLIC_NOINDEX",
    why: "A query result page. Every query is a distinct URL with content drawn from pages that are indexed themselves, which is the definition of thin duplication.",
  },

  "/auth": {
    indexing: "PRIVATE_NOINDEX",
    why: "A sign-in form. Indexing it sends people looking for the product to a login screen.",
  },
  "/auth/verify": {
    indexing: "PRIVATE_NOINDEX",
    why: "Reached from a link in an email, and meaningless without its token.",
  },
  "/auth/reset": {
    indexing: "PRIVATE_NOINDEX",
    why: "Reached from a reset email and useless without its token, so indexing it offers a dead end.",
  },
  "/auth/account-type": {
    indexing: "PRIVATE_NOINDEX",
    why: "A step inside onboarding, which has no meaning entered from outside it.",
  },
  "/auth/onboarding-intent": {
    indexing: "PRIVATE_NOINDEX",
    why: "Another onboarding step, which has no meaning entered from outside the flow.",
  },
  "/you": {
    indexing: "PRIVATE_NOINDEX",
    why: "Somebody's own workspace. Whatever a crawler sees here it should not be repeating.",
  },
  "/you/edit": {
    indexing: "PRIVATE_NOINDEX",
    why: "Profile editing. Private by definition.",
  },
  "/you/saved": {
    indexing: "PRIVATE_NOINDEX",
    why: "What one person has saved, which is nobody else's business.",
  },
  "/you/applications": {
    indexing: "PRIVATE_NOINDEX",
    why: "Applications are between two parties.",
  },
  "/you/applications/sent": {
    indexing: "PRIVATE_NOINDEX",
    why: "What one person applied to, which is theirs and the recruiter's alone.",
  },
  "/you/applications/received": {
    indexing: "PRIVATE_NOINDEX",
    why: "Who applied to somebody's listing, which is the applicants' information rather than the platform's.",
  },
  "/you/projects/[projectId]": {
    indexing: "PRIVATE_NOINDEX",
    why: "The owner's editing view of a project. The public one lives under /u/[slug].",
  },
  "/applications": {
    indexing: "PRIVATE_NOINDEX",
    why: "The inbox and pipeline. Conversations, and therefore private.",
  },
  "/drafts": {
    indexing: "PRIVATE_NOINDEX",
    why: "Unpublished work. Indexing a draft would publish it in the only way that matters.",
  },
  "/saved": {
    indexing: "PRIVATE_NOINDEX",
    why: "One person's saved items, which reveal what they are looking for.",
  },
  "/activity": {
    indexing: "PRIVATE_NOINDEX",
    why: "A personal activity feed, which is a record of one account's behaviour.",
  },
  "/notifications": {
    indexing: "PRIVATE_NOINDEX",
    why: "Personal notifications, addressed to one account and nobody else.",
  },
  "/settings": {
    indexing: "PRIVATE_NOINDEX",
    why: "Account settings, including contact details and notification choices.",
  },
  "/post": {
    indexing: "PRIVATE_NOINDEX",
    why: "The chooser in front of the posting flows. Requires an account, and says nothing to a searcher.",
  },
  "/post-job": {
    indexing: "PRIVATE_NOINDEX",
    why: "The job composer. A multi-step authenticated form.",
  },
  "/post-job/import": {
    indexing: "PRIVATE_NOINDEX",
    why: "The AI import entry point, which is a step inside the composer.",
  },
  "/post-talent": {
    indexing: "PRIVATE_NOINDEX",
    why: "The talent-listing composer, mirroring /post-job.",
  },
  "/admin": {
    indexing: "PRIVATE_NOINDEX",
    why: "Administration. Gated server-side; a listing of its URLs is still an inventory of the surface worth attacking.",
  },
  "/admin/audit": {
    indexing: "PRIVATE_NOINDEX",
    why: "The audit log, which is a record of what administrators did and to whom.",
  },
  "/admin/compliance": {
    indexing: "PRIVATE_NOINDEX",
    why: "The compliance queue, which lists people who asked for their data or its deletion.",
  },
  "/admin/conversations": {
    indexing: "PRIVATE_NOINDEX",
    why: "Administrative access to conversations between two other people.",
  },
  "/admin/listings": {
    indexing: "PRIVATE_NOINDEX",
    why: "Listing moderation, which shows unpublished and removed listings.",
  },
  "/admin/moderation": {
    indexing: "PRIVATE_NOINDEX",
    why: "The moderation queue, which is a list of accusations before any are decided.",
  },
  "/admin/platform": {
    indexing: "PRIVATE_NOINDEX",
    why: "Platform configuration and operational state.",
  },
  "/admin/reports": {
    indexing: "PRIVATE_NOINDEX",
    why: "Reports made about accounts and listings, including who made them.",
  },
  "/admin/users": {
    indexing: "PRIVATE_NOINDEX",
    why: "Account administration, including suspension, so its URLs are an inventory of what is worth attacking.",
  },
  "/admin/verification": {
    indexing: "PRIVATE_NOINDEX",
    why: "Hiring-identity verification decisions and the evidence behind them.",
  },

  "/dev/emails": {
    indexing: "DEVELOPMENT_ONLY",
    why: "The local email viewer. Must not exist in production at all, which is a stronger statement than not being indexed.",
  },
  "/dev/logo-debug": {
    indexing: "DEVELOPMENT_ONLY",
    why: "A visual debugging page for logo rendering.",
  },
  "/smart-typing-test": {
    indexing: "DEVELOPMENT_ONLY",
    why: "A typing-behaviour harness. Never part of the product.",
  },
};

/** Routes whose pages must carry `robots: { index: false }`. */
export const NOINDEX_ROUTES = Object.entries(ROUTE_INDEXING)
  .filter(([, contract]) =>
    contract.indexing === "PRIVATE_NOINDEX" || contract.indexing === "PUBLIC_NOINDEX",
  )
  .map(([route]) => route);

/** Routes that must be crawlable, whether or not they are indexable. */
export const CRAWLABLE_ROUTES = Object.entries(ROUTE_INDEXING)
  .filter(([, contract]) => contract.indexing !== "ROBOTS_DISALLOW")
  .map(([route]) => route);

export function routeIndexing(route: string): RouteIndexing | undefined {
  return ROUTE_INDEXING[route]?.indexing;
}

/**
 * A route's path from its `app/**\/page.tsx` file, as a user would type it.
 * Route groups — `(marketing)` — are not part of the URL and are dropped.
 */
export function routeFromPageFile(pageFile: string): string {
  const segments = pageFile
    .replace(/^app\//, "")
    .replace(/\/page\.tsx$/, "")
    .split("/")
    .filter((segment) => segment !== "" && !segment.startsWith("("));

  return `/${segments.join("/")}`;
}
