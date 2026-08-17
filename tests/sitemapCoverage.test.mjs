/**
 * A sitemap that is wrong is worse than one that is missing.
 *
 * Every failure guarded here produced a valid, well-formed file, which is why
 * none of them was noticed:
 *
 * The whole listing was one request for a hundred records. With four hundred open
 * jobs, three hundred were absent, and the file was still valid XML describing a
 * smaller site than the one being served.
 *
 * Every job carried `lastModified: new Date()`. Not a rounding error — a claim
 * that every job on the platform changed at the moment the crawler asked.
 * `lastmod` exists so a crawler can skip what has not changed, so a file where
 * everything changed one second ago teaches it to disregard the field for this
 * site. Omitting it says "I do not know", which is true.
 *
 * And a backend failure was caught and turned into an empty list, so an outage
 * produced a sitemap listing six static pages, served with a 200. A crawler reads
 * that as authoritative: the site has six pages now. That is how an afternoon of
 * downtime empties an index.
 *
 * These read the source rather than executing the route, because reaching the
 * behaviour needs a running backend and a populated database — and the properties
 * that matter here are structural anyway. What that cannot prove is stated in the
 * handoff rather than implied by a green run.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const sitemap = readFileSync(join(root, "app", "sitemap.ts"), "utf8");
const registry = readFileSync(join(root, "lib", "seo", "routeIndexing.ts"), "utf8");

/**
 * The file with its comments removed.
 *
 * Necessary, and the reason is worth stating: the comments in app/sitemap.ts
 * quote the very patterns these tests forbid, in order to explain why they were
 * removed. Matching the raw text finds `.catch(() => [])` inside the sentence
 * describing its deletion and reports the bug as present.
 *
 * The mirror image of this bit tests/routeIndexing.test.mjs the other way round:
 * there, a comment naming disallowed paths made a test pass while the defect was
 * live. Prose that documents a rule reads exactly like code that breaks it, so
 * any assertion about code has to look at code.
 */
function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SITEMAP_CODE = code(sitemap);

/** Static routes the sitemap declares, as paths. */
function declaredStaticPaths() {
  const block = sitemap.match(/const STATIC_ROUTES[^=]*=\s*\[([\s\S]*?)\n\];/);
  assert.ok(block, "could not find STATIC_ROUTES in app/sitemap.ts");

  return [...block[1].matchAll(/url:\s*(?:siteUrl|`\$\{siteUrl\}([^`]*)`)/g)].map(
    (match) => match[1] ?? "/",
  );
}

/** Routes the registry marks PUBLIC_INDEXABLE, excluding dynamic segments. */
function staticIndexableRoutes() {
  const entries = [...registry.matchAll(/"(\/[^"]*)":\s*\{\s*indexing:\s*"([A-Z_]+)"/g)];
  return entries
    .filter(([, route, indexing]) => indexing === "PUBLIC_INDEXABLE" && !route.includes("["))
    .map(([, route]) => route);
}

test("the source and registry were both parsed", () => {
  // Guards everything below. An unparsed file makes each assertion vacuous.
  assert.ok(declaredStaticPaths().length >= 6, "parsed too few static sitemap routes");
  assert.ok(staticIndexableRoutes().length >= 6, "parsed too few indexable routes");
});

test("every static indexable route is in the sitemap", () => {
  // /faq was indexable and absent, which is what a hand-maintained list does:
  // a page ships, and its omission is invisible because the file stays valid.
  const declared = new Set(declaredStaticPaths());
  const missing = staticIndexableRoutes().filter((route) => !declared.has(route));

  assert.deepEqual(
    missing,
    [],
    `these are PUBLIC_INDEXABLE but absent from the sitemap: ${missing}`,
  );
});

test("the sitemap lists nothing it has told crawlers not to index", () => {
  // The contradiction that wastes crawl budget and reads as a mistake to a
  // search engine, because it is one: submitting a URL while asking for it not
  // to be indexed.
  const noindexRoutes = [...registry.matchAll(/"(\/[^"]*)":\s*\{\s*indexing:\s*"([A-Z_]+)"/g)]
    .filter(([, , indexing]) => indexing === "PRIVATE_NOINDEX" || indexing === "PUBLIC_NOINDEX")
    .map(([, route]) => route)
    .filter((route) => !route.includes("["));

  const declared = declaredStaticPaths();
  const contradictions = noindexRoutes.filter((route) => declared.includes(route));

  assert.deepEqual(contradictions, [], `submitted while noindexed: ${contradictions}`);
});

test("timestamps come from the record, never from the clock", () => {
  // `new Date()` as a lastModified fallback is the specific thing being
  // forbidden. It is not a harmless default: it trains crawlers to ignore
  // lastmod for the whole site.
  assert.ok(
    !/lastModified:\s*new Date\(\)/.test(SITEMAP_CODE),
    "lastModified is being set to the current time, which claims every record " +
      "changed when the sitemap was fetched",
  );
  assert.match(SITEMAP_CODE, /function realTimestamp/);
  // And an unparseable stored value yields nothing rather than today.
  assert.match(SITEMAP_CODE, /Number\.isNaN\(parsed\.getTime\(\)\)\s*\?\s*undefined/);
});

test("the listing is paged to the end rather than truncated at one request", () => {
  assert.match(SITEMAP_CODE, /function collectAllPages/);
  assert.match(SITEMAP_CODE, /offset/);

  // A server that ignores `offset` would return the same first page forever, so
  // the loop needs a bound as well as a completion condition.
  assert.match(SITEMAP_CODE, /MAX_PAGES/);
  assert.match(SITEMAP_CODE, /MAX_URLS_PER_SITEMAP = 50_000/);
});

test("the page walk ends on a short page, an empty page, and a reached total", () => {
  const walk = SITEMAP_CODE.slice(SITEMAP_CODE.indexOf("async function collectAllPages"));
  const body = walk.slice(0, walk.indexOf("\n}"));

  // A short page covers the empty case too — zero is less than PAGE_SIZE.
  assert.match(body, /items\.length < PAGE_SIZE/);
  assert.match(body, /collected\.length >= total/);
  assert.match(body, /collected\.length >= MAX_URLS_PER_SITEMAP/);
});

test("a backend failure is not turned into an empty sitemap", () => {
  // The one with teeth. Swallowing the error serves a valid file that says the
  // site has six pages, with a 200, and a crawler is entitled to believe it.
  assert.ok(
    !/\.catch\(\(\)\s*=>\s*\[\]\)/.test(SITEMAP_CODE),
    "a fetch failure is being converted into an empty list, which publishes an " +
      "outage as a statement that the content no longer exists",
  );
  assert.ok(
    !/catch\s*\(/.test(SITEMAP_CODE.slice(SITEMAP_CODE.indexOf("export default async function sitemap"))),
    "the sitemap handler swallows an error; it must propagate so Next answers 500 " +
      "and the crawler keeps what it already has",
  );
});

test("the sitemap is rendered per request, not baked into the build", () => {
  // Found by removing the swallowed error: the build then failed, because the
  // fetch failure had been happening at BUILD time all along and being absorbed.
  // Prerendering is wrong twice — a sitemap of live jobs frozen at deploy misses
  // everything posted after it, and a build without a backend shipped a
  // permanently-empty file as an artifact.
  assert.match(SITEMAP_CODE, /export const dynamic = "force-dynamic"/);
  assert.match(SITEMAP_CODE, /export const revalidate = 0/);
});

test("collectAllPages does not catch either", () => {
  // Otherwise the propagation above is defeated one level down, which is exactly
  // where the original bug lived.
  const walk = SITEMAP_CODE.slice(SITEMAP_CODE.indexOf("async function collectAllPages"));
  const body = walk.slice(0, walk.indexOf("\n}"));

  assert.ok(!body.includes("catch"), "collectAllPages swallows failures");
});

test("mock mode is a separate branch and does not page a backend", () => {
  // Local mocks have a fixed set and no API to walk. Running the pagination
  // against them would loop on the same array.
  assert.match(SITEMAP_CODE, /if \(isLocalMocksEnabled\(\)\)/);

  const mockBranch = SITEMAP_CODE.slice(SITEMAP_CODE.indexOf("if (isLocalMocksEnabled())"));
  const branchBody = mockBranch.slice(0, mockBranch.indexOf("\n  }"));

  assert.ok(!branchBody.includes("collectAllPages"));
  assert.ok(branchBody.includes("JOBS"));
});

test("closed and archived jobs are not submitted", () => {
  // A sitemap entry is an invitation to index. Sending a crawler to a job nobody
  // can apply to is the thing that gets a JobPosting flagged as stale.
  assert.match(SITEMAP_CODE, /status !== "archived"/);
  assert.match(SITEMAP_CODE, /status !== "closed"/);
});

test("the sitemap URL that robots.txt advertises is the one Next serves", () => {
  const robots = readFileSync(join(root, "app", "robots.ts"), "utf8");

  assert.match(robots, /sitemap\.xml/);
  // Both derive the origin the same way, so a deployment cannot advertise one
  // host and serve another.
  for (const source of [robots, sitemap]) {
    assert.match(source, /NEXT_PUBLIC_SITE_URL \|\| process\.env\.NEXTAUTH_URL/);
  }
});
