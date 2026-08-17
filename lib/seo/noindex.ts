import type { Metadata } from "next";

/**
 * The directive an authenticated or duplicate page carries for itself.
 *
 * One shared constant rather than an object written out per route, because the
 * value has to be identical everywhere — and because `index: false` without
 * `follow: false` reads as deliberate when it is usually a typo.
 *
 * This is the instruction that actually works. A `Disallow` line in robots.txt
 * looks stronger and is weaker: it stops the fetch, so the crawler never reads
 * the noindex, and a URL linked from anywhere can still be listed with no title
 * and no way to remove it. See app/robots.ts and lib/seo/routeIndexing.ts.
 */
export const NOINDEX: Metadata = {
  robots: { index: false, follow: false },
};

/** Noindex plus a title, for the pages that also deserve a sensible tab label. */
export function noindexPage(title: string, description?: string): Metadata {
  return { title, ...(description ? { description } : {}), ...NOINDEX };
}
