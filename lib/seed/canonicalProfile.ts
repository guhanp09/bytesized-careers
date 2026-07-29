/**
 * The canonical corpus, seen as a public profile.
 *
 * Mock mode's workspace has always read the generated manifests, but `/u/{slug}`
 * did not: it resolved backend → a hand-written mock dataset → talent listings,
 * none of which contain a scenario applicant. So every route *out* of a review
 * — the applicant's name, their attached work — landed on "Profile not found",
 * on the one page the review actually turns on.
 *
 * **Server-only, by construction rather than by convention.** Manifests are read
 * from disk with `node:fs` — the same boundary `app/api/dev/scenario/[scenario]`
 * relies on — so no manifest can be bundled into a client chunk no matter what
 * imports this, and importing it from a client component fails the build. That
 * is the protection; a `server-only` marker would only restate it.
 *
 * **Scenario isolation is structural, not a check.** A canonical username is
 * scenario-prefixed by the generator (`def_t09101`, `bus_dailyfit`), so the
 * prefix *is* the lookup key: only that scenario's manifest is ever opened.
 * Switching scenarios therefore cannot surface a profile from another one —
 * not because something compares them, but because the other file is never read.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  BackendPortfolioItem,
  BackendPublicProfileResponse,
} from "../backendClient";
import { anchorFor, checkManifestVersion, type AnchorMode } from "./scenarioManifest.ts";
import { SCENARIO_NAMES, type ScenarioName } from "./scenarioNames.ts";
import type { ManifestActor, ManifestPortfolioItem, ScenarioManifest } from "./manifestTypes.ts";

const MANIFEST_DIR = path.join(process.cwd(), "fixtures", "creator_scenarios", "generated");

/**
 * `def` → `default`. The generator scopes usernames with the first three
 * letters, joined with `_` because the product's username rule permits no
 * hyphen — `^[a-z0-9][a-z0-9_]{2,19}$`.
 */
const SCENARIO_BY_PREFIX = new Map<string, ScenarioName>(
  SCENARIO_NAMES.map((name) => [name.slice(0, 3), name])
);

const manifestCache = new Map<ScenarioName, ScenarioManifest | null>();

async function loadManifest(scenario: ScenarioName): Promise<ScenarioManifest | null> {
  const cached = manifestCache.get(scenario);
  if (cached !== undefined) return cached;
  try {
    // `scenario` comes from the known list, so it cannot traverse.
    const raw = await readFile(path.join(MANIFEST_DIR, `${scenario}.json`), "utf8");
    const manifest = JSON.parse(raw) as ScenarioManifest;
    // The same version gate every other consumer uses: a manifest this build
    // does not understand is refused, never half-read.
    checkManifestVersion(manifest.version);
    manifestCache.set(scenario, manifest);
    return manifest;
  } catch {
    manifestCache.set(scenario, null);
    return null;
  }
}

/** Seconds as the product writes durations — the same label the backend restores. */
function durationLabel(seconds?: number | null): string | null {
  if (typeof seconds !== "number" || seconds <= 0) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

/** `_normalize_unique_list` — first spelling wins, compared case-insensitively. */
function uniqueList(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const text = (value ?? "").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

const sourceTypeFor = (media: ManifestPortfolioItem["media"]) =>
  media === "video" ? "youtube" : media === "image" ? "behance" : "other";

function toPortfolioItem(
  item: ManifestPortfolioItem,
  ownerId: string,
  at: string
): BackendPortfolioItem {
  return {
    id: item.id,
    user_id: ownerId,
    title: item.title,
    source_type: sourceTypeFor(item.media),
    source_url: item.url ?? null,
    role: item.role ?? null,
    role_name: item.role ?? null,
    description: item.description ?? null,
    contribution_summary: item.contribution ?? null,
    media_url: item.url ?? null,
    thumbnail_url: item.thumbnail_url ?? null,
    duration: durationLabel(item.duration_seconds),
    links: [],
    tags: [],
    tools: item.tools ?? [],
    content_niches: item.niche ? [item.niche] : [],
    platforms: item.platform ? [item.platform] : [],
    formats: item.format ? [item.format] : [],
    visibility: "public",
    publish_status: "published",
    portfolio_status: "now",
    timeframe: "now",
    status: "now",
    is_public: true,
    // The manifest stores no timestamps at all — every instant is an offset a
    // consumer materialises — and a portfolio item carries no offset of its
    // own, so both are the anchor rather than an invented publication date.
    created_at: at,
    updated_at: at,
  };
}

function toPublicProfile(
  actor: ManifestActor,
  portfolio: ManifestPortfolioItem[],
  anchorMode: AnchorMode
): BackendPublicProfileResponse {
  const hires = (actor.sides || []).includes("recruiter");
  const at = new Date(anchorFor(anchorMode)).toISOString();
  const own = portfolio.filter((item) => item.owner_id === actor.id);
  const items = own.map((item) => toPortfolioItem(item, actor.id, at));

  // The real profile service widens a talent's platforms, formats and niche
  // with what their portfolio actually demonstrates, rather than trusting the
  // stated list alone. Mirrored here so the same person does not appear to
  // work on fewer surfaces in Mock mode than in production.
  const evidence = {
    tools: uniqueList(own.flatMap((item) => item.tools ?? [])),
    platforms: uniqueList(own.map((item) => item.platform)),
    formats: uniqueList(own.map((item) => item.format)),
    niches: uniqueList(own.map((item) => item.niche)),
  };

  return {
    username: actor.username,
    display_name: actor.display_name,
    headline: actor.headline ?? null,
    bio: actor.bio ?? null,
    avatar_url: actor.avatar_url ?? null,
    avatar_mode: "generic",
    banner_url: null,
    // Widened with the tools the attached work was actually made in — the
    // profile service does the same, and a shorter list here would read as a
    // less capable person in Mock mode than in production.
    skills: uniqueList([...(actor.skills ?? []), ...evidence.tools]),
    public_links: actor.public_links ?? [],
    experience: [],
    availability_status:
      (actor.availability_status as BackendPublicProfileResponse["availability_status"]) ??
      "selective",
    location: actor.location ?? null,
    timezone: actor.timezone ?? null,
    social_connections: {
      youtube: { connected: false },
      instagram: { connected: false },
    },
    stats: {
      jobs_posted_count: 0,
      jobs_completed_count: 0,
      projects_count: items.length,
      reviews_count: 0,
    },
    reviews: { avg_rating: 0, review_count: 0 },
    review_items: [],
    collaboration_preferences: {
      // One free-text line in the product, so the list is joined rather than
      // silently truncated to its head — same choice the backend restore makes.
      tools: (actor.tools ?? []).join(", ") || null,
      turnaround: actor.turnaround ?? null,
      working_hours: actor.working_hours ?? null,
      work_mode: actor.work_mode ?? null,
    },
    // The backend splits these two ways and the manifest keeps one vocabulary,
    // so which side an actor's lists land on is decided here, from `sides`.
    hiring_info: hires
      ? {
          platforms: actor.platforms ?? [],
          niches: actor.niches ?? [],
          formats: actor.formats ?? [],
          channels_or_pages_managed: actor.description ?? null,
          verification_status:
            (actor.verification_status as "unverified" | "verified" | "rejected") ?? "unverified",
        }
      : null,
    creator_platforms: hires
      ? []
      : uniqueList([...(actor.platforms ?? []), ...evidence.platforms]),
    roles: (actor.roles ?? []).map((name) => ({
      id: `${actor.id}:${name}`,
      name,
      category: "creator",
    })),
    role_answers_summary: [],
    content_style: hires
      ? { format: [], tone: [] }
      : {
          primary_niche: actor.niches?.[0] ?? evidence.niches[0] ?? null,
          format: uniqueList([...(actor.formats ?? []), ...evidence.formats]).slice(0, 12),
          tone: [],
        },
    jobs_active: [],
    jobs_past: [],
    portfolio_now: items,
    portfolio_past: [],
    jobs_preview: [],
    portfolio_preview: items.slice(0, 2),
    talent_listings_active: [],
    talent_listings_preview: [],
    moved_to_username: null,
  };
}

/**
 * The canonical profile for a slug, or null if the slug is not a canonical one.
 *
 * Returning null rather than a placeholder matters: a slug that belongs to no
 * scenario has to fall through to the other resolvers, not shadow them.
 */
export async function getCanonicalPublicProfile(
  slug: string,
  { anchorMode = "now" }: { anchorMode?: AnchorMode } = {}
): Promise<BackendPublicProfileResponse | null> {
  const normalized = slug.trim().toLowerCase();
  const prefix = normalized.split("_")[0];
  const scenario = SCENARIO_BY_PREFIX.get(prefix);
  if (!scenario) return null;

  const manifest = await loadManifest(scenario);
  if (!manifest) return null;

  const actor = manifest.actors.find((entry) => entry.username.toLowerCase() === normalized);
  if (!actor) return null;

  return toPublicProfile(actor, manifest.portfolio || [], anchorMode);
}

/** Test seam: the cache would otherwise outlive a regenerated manifest. */
export function resetCanonicalProfileCache(): void {
  manifestCache.clear();
}
