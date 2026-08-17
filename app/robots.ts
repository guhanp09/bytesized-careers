import type { MetadataRoute } from "next";

import { CRAWLABLE_ROUTES } from "../lib/seo/routeIndexing";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000";

/**
 * Only what genuinely cannot say "noindex" for itself.
 *
 * This used to disallow `/auth/`, `/you/`, `/admin/`, `/dev/` and
 * `/smart-typing-test` as well, which reads as the careful choice and is the
 * wrong one. Disallow and noindex do not stack: disallow says do not fetch,
 * noindex says do not index, and the crawler has to fetch a page to read its
 * noindex. Disallowing those paths therefore guaranteed their noindex would never
 * be seen — and a disallowed URL that is linked from anywhere can still be
 * listed, as a bare URL with no title or description, with no way to remove it.
 *
 * So the authenticated surfaces are now crawlable and carry `noindex` in their
 * own metadata, which is the instruction that actually gets honoured. Letting a
 * crawler fetch them costs nothing: they require a session and redirect.
 *
 * What remains here is the set that cannot carry metadata at all. `/api/` serves
 * JSON — there is no meta tag to put a directive in — so robots.txt is the only
 * tool available, and its weakness is accepted knowingly rather than by default.
 */
const DISALLOWED_PATHS = ["/api/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: DISALLOWED_PATHS,
    },
    sitemap: `${siteUrl.replace(/\/+$/, "")}/sitemap.xml`,
  };
}

/**
 * Exported for the contract test: no route that relies on `noindex` may also be
 * disallowed here, because the disallow would stop the noindex being read.
 */
export function disallowedPaths(): string[] {
  return [...DISALLOWED_PATHS];
}

export function crawlableRouteCount(): number {
  return CRAWLABLE_ROUTES.length;
}
