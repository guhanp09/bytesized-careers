/**
 * Every route says something to a search engine, whether or not anyone chose it.
 *
 * The default is indexable. So an authenticated workspace page added on a Tuesday
 * is publicly indexable on Tuesday, and nothing in the pull request mentions it.
 * The registry in lib/seo/routeIndexing.ts makes that a decision, and this file
 * makes the decision enforceable: a `page.tsx` with no entry fails here.
 *
 * The contract it encodes is the one that is easy to get backwards, and was
 * backwards in this repository until now. `Disallow` in robots.txt and `noindex`
 * in page metadata do not stack — disallow stops the fetch, and the crawler has
 * to fetch a page to read its noindex. So `/you/`, `/admin/`, `/auth/` and
 * `/dev/` were disallowed AND carried no noindex, which is the worst of both:
 * their directives could never be read, and a URL linked from anywhere could
 * still be listed as a bare link with no way to remove it.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const registry = readFileSync(join(root, "lib", "seo", "routeIndexing.ts"), "utf8");
const robots = readFileSync(join(root, "app", "robots.ts"), "utf8");

/** Every `app/**\/page.tsx`, as repo-relative paths with forward slashes. */
function pageFiles(directory = join(root, "app"), found = []) {
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) {
      pageFiles(full, found);
    } else if (entry === "page.tsx") {
      found.push(relative(root, full).split("\\").join("/"));
    }
  }
  return found;
}

/** The URL a page file serves. Route groups — `(marketing)` — are not in the URL. */
function routeFor(pageFile) {
  const segments = pageFile
    .replace(/^app\//, "")
    // Anchored on the whole remainder, not on "/page.tsx": app/page.tsx has no
    // slash before it, and matching only the slashed form silently produced the
    // route "/page.tsx" for the home page.
    .replace(/(^|\/)page\.tsx$/, "")
    .split("/")
    .filter((segment) => segment !== "" && !segment.startsWith("("));
  return `/${segments.join("/")}`;
}

/** Registry entries, parsed from the source so the test needs no TS runtime. */
function registryEntries() {
  const entries = new Map();
  const pattern = /"(\/[^"]*)":\s*\{\s*indexing:\s*"([A-Z_]+)"/g;
  let match;
  while ((match = pattern.exec(registry)) !== null) {
    entries.set(match[1], match[2]);
  }
  return entries;
}

const ROUTES = pageFiles().map((file) => ({ file, route: routeFor(file) }));
const ENTRIES = registryEntries();

test("the route list and the registry were both read", () => {
  // Guards every assertion below: an empty scan or an unparsed registry would
  // make all of them pass while checking nothing.
  assert.ok(ROUTES.length > 30, `found only ${ROUTES.length} routes`);
  assert.ok(ENTRIES.size > 30, `parsed only ${ENTRIES.size} registry entries`);
});

test("every route declares what it says to a search engine", () => {
  const unclassified = ROUTES.filter(({ route }) => !ENTRIES.has(route)).map(
    ({ route, file }) => `${route}  (${file})`,
  );

  assert.deepEqual(
    unclassified,
    [],
    "these routes have no entry in lib/seo/routeIndexing.ts. The default is " +
      "indexable, so an authenticated page left out of it is publicly indexable:\n" +
      unclassified.join("\n"),
  );
});

test("the registry names no route that does not exist", () => {
  const live = new Set(ROUTES.map(({ route }) => route));
  const stale = [...ENTRIES.keys()].filter((route) => !live.has(route));

  assert.deepEqual(stale, [], `these entries describe no real route: ${stale}`);
});

/**
 * The paths robots.txt refuses to let a crawler fetch.
 *
 * Parsed from the array literal specifically, not by scanning the file for
 * quoted paths: the surrounding comment names `/you/` and `/admin/` while
 * explaining why they are NOT disallowed any more, and a looser match read those
 * as live entries — which made the conflict test below pass while the conflict
 * was present. Found by reintroducing the defect on purpose.
 */
function disallowedPaths() {
  const literal = robots.match(/const DISALLOWED_PATHS = \[([^\]]*)\]/);
  assert.ok(literal, "could not find the DISALLOWED_PATHS array in app/robots.ts");
  return [...literal[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

test("the disallow list is parsed from the array, not from the prose around it", () => {
  // Guards the test below, which is the one that matters and the one that was
  // silently vacuous.
  const disallowed = disallowedPaths();

  assert.ok(disallowed.length > 0, "parsed no disallowed paths at all");
  assert.ok(
    disallowed.every((path) => path.startsWith("/")),
    `parsed something that is not a path: ${disallowed}`,
  );
});

test("a route that relies on noindex is not also disallowed from being fetched", () => {
  // The whole point. A disallowed URL is never fetched, so its noindex is never
  // read — and it can still be listed if anything links to it.
  const disallowed = disallowedPaths();

  const noindexRoutes = [...ENTRIES.entries()]
    .filter(([, indexing]) => indexing === "PRIVATE_NOINDEX" || indexing === "PUBLIC_NOINDEX")
    .map(([route]) => route);

  for (const route of noindexRoutes) {
    for (const blocked of disallowed) {
      assert.ok(
        !route.startsWith(blocked),
        `${route} carries noindex but robots.txt disallows ${blocked}, so the ` +
          "noindex can never be read",
      );
    }
  }
});

test("robots.txt only blocks what cannot carry a directive of its own", () => {
  // /api/ serves JSON: there is no meta tag to put a directive in, so a
  // Disallow is the only tool and its weakness is accepted knowingly.
  assert.match(robots, /const DISALLOWED_PATHS = \["\/api\/"\]/);

  for (const path of ["/you/", "/admin/", "/auth/", "/dev/", "/smart-typing-test"]) {
    assert.ok(
      !new RegExp(`DISALLOWED_PATHS = \\[[^\\]]*${path.replace(/\//g, "\\/")}`).test(robots),
      `${path} is disallowed again; it carries noindex instead, and doing both ` +
        "means neither works",
    );
  }
});

test("every noindex route actually emits the directive", () => {
  // Read from the files rather than trusted. Next merges metadata from layouts,
  // so a directive on `app/auth/layout.tsx` covers `app/auth/reset/page.tsx` —
  // which is how the client-component pages are handled, since a client
  // component cannot export `metadata` at all.
  const missing = [];

  for (const { route, file } of ROUTES) {
    const indexing = ENTRIES.get(route);
    if (indexing !== "PRIVATE_NOINDEX" && indexing !== "PUBLIC_NOINDEX") continue;

    const candidates = [file];
    let directory = dirname(file);
    while (directory !== "app" && directory !== "." && directory.startsWith("app")) {
      candidates.push(join(directory, "layout.tsx").split("\\").join("/"));
      directory = dirname(directory);
    }

    const declared = candidates.some((candidate) => {
      let source;
      try {
        source = readFileSync(join(root, candidate), "utf8");
      } catch {
        return false;
      }
      return (
        source.includes("noindexPage(") ||
        source.includes("NOINDEX") ||
        /robots:\s*\{\s*index:\s*false/.test(source)
      );
    });

    if (!declared) missing.push(`${route}  (${file})`);
  }

  assert.deepEqual(missing, [], `these must noindex and do not:\n${missing.join("\n")}`);
});

test("every indexable public route is self-canonical", () => {
  // Without one, the same page reached with a tracking parameter or a
  // trailing-slash variant competes with itself and the engine picks a winner.
  const missing = [];

  for (const { route, file } of ROUTES) {
    if (ENTRIES.get(route) !== "PUBLIC_INDEXABLE") continue;
    if (route === "/") continue; // the origin is its own canonical

    const source = readFileSync(join(root, file), "utf8");
    if (!source.includes("canonical")) missing.push(`${route}  (${file})`);
  }

  assert.deepEqual(missing, [], `these are indexable with no canonical:\n${missing.join("\n")}`);
});

test("an archived legal version points at the current wording, not at itself", () => {
  // A searcher must never land on superseded terms. These pages exist so an
  // acceptance record stays resolvable, which is a different job from ranking.
  for (const document of ["terms", "privacy"]) {
    const source = readFileSync(join(root, "app", document, "[version]", "page.tsx"), "utf8");

    assert.match(source, /index:\s*false/);
    assert.ok(
      new RegExp(`canonical:\\s*"/${document}"`).test(source),
      `/${document}/[version] should canonicalise to /${document}`,
    );
  }
});

test("every entry says why, not just what", () => {
  const reasons = [...registry.matchAll(/why:\s*\n?\s*"([^"]+)"/g)].map((match) => match[1]);

  assert.ok(reasons.length >= ENTRIES.size - 2, "expected a reason per entry");
  const thin = reasons.filter((reason) => reason.split(/\s+/).length < 5);
  assert.deepEqual(thin, [], `these say what but not why: ${thin}`);
});
