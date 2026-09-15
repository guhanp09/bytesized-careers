export type YouTubeUrlParseResult =
  | { type: "handle"; handle: string; normalizedUrl: string }
  | { type: "channelId"; channelId: string; normalizedUrl: string }
  | { type: "username"; username: string; normalizedUrl: string }
  | { type: "customPath"; path: string; normalizedUrl: string }
  | { type: "video"; videoId: string; normalizedUrl: string }
  | { type: "invalid"; normalizedUrl: string | null };

export type YouTubeIdentity = {
  platform: "YouTube";
  name: string;
  logoUrl: string | null;
  canonicalUrl: string;
  externalId: string | null;
  handle: string | null;
  confidence: "high" | "medium" | "low";
  source: "youtube_data_api" | "youtube_html_fallback" | "url_fallback";
};

export type YouTubeProviderSelector = {
  selector: "channel_id" | "handle" | "username" | "video_id";
  value: string;
};

type ResolveYouTubeOptions = {
  warn?: (message: string) => void;
  /**
   * The authenticated backend owns the provider credential, fixed endpoints,
   * response bounds and quota. This utility only parses the URL and selects
   * the provider lookup the backend may perform.
   */
  resolveProviderIdentity?: (selector: YouTubeProviderSelector) => Promise<YouTubeIdentity | null>;
  /**
   * How to turn a YouTube custom-path URL into its channel id.
   *
   * A custom path — `youtube.com/somebrand` — is the one shape the Data API
   * cannot look up directly; the channel id has to be read out of the page. That
   * read is a fetch of a URL a user chose, so it does not happen here: the
   * caller supplies a resolver backed by the server-owned bounded endpoint,
   * which fetches through the shared pinned boundary and returns the id alone.
   *
   * Without one, a custom path falls back to the URL-derived identity rather
   * than fetching from this runtime. That is deliberate — losing an enrichment
   * is cheaper than keeping an unpinned fetch alive for it.
   */
  resolveChannelIdFromPage?: (normalizedUrl: string) => Promise<string | null>;
};

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const CUSTOM_PATH_RESERVED = new Set([
  "about",
  "account",
  "channel",
  "clip",
  "embed",
  "feed",
  "playlist",
  "shorts",
  "user",
  "watch",
]);
const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
const FALLBACK_TTL_MS = 5 * 60 * 1000;
const MAX_URL_CHARS = 2048;
const MAX_SELECTOR_CHARS = 128;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{20,126}$/;

const identityCache = new Map<string, { expiresAt: number; value: YouTubeIdentity }>();

const cleanExperienceText = (value?: string | null) => value?.trim() || null;

const normalizeExperienceUrl = (value?: string | null) => {
  const raw = cleanExperienceText(value);
  if (!raw || raw.length > MAX_URL_CHARS) return null;

  const candidate = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    url.hash = "";
    const normalized = url.toString().replace(/\/$/, "");
    return normalized.length <= MAX_URL_CHARS ? normalized : null;
  } catch {
    return null;
  }
};

const titleCaseWords = (value: string) =>
  value
    .replace(/^@/, "")
    .replace(/[-_]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const fallbackNameForParsedYouTubeUrl = (parsed: YouTubeUrlParseResult) => {
  if (parsed.type === "handle") return `@${parsed.handle}`;
  if (parsed.type === "username") return titleCaseWords(parsed.username);
  if (parsed.type === "customPath") return titleCaseWords(parsed.path);
  if (parsed.type === "channelId") return parsed.channelId;
  if (parsed.type === "video") return "YouTube Channel";
  return "YouTube Channel";
};

const fallbackIdentity = (
  parsed: YouTubeUrlParseResult,
  normalizedUrl: string,
  source: YouTubeIdentity["source"] = "url_fallback",
  confidence: YouTubeIdentity["confidence"] = "low"
): YouTubeIdentity => ({
  platform: "YouTube",
  name: fallbackNameForParsedYouTubeUrl(parsed),
  logoUrl: null,
  canonicalUrl: normalizedUrl,
  externalId: parsed.type === "channelId" ? parsed.channelId : null,
  handle: parsed.type === "handle" ? `@${parsed.handle}` : null,
  confidence,
  source,
});

const boundedSelector = (value?: string | null) => {
  const cleaned = cleanExperienceText(value);
  return cleaned && cleaned.length <= MAX_SELECTOR_CHARS ? cleaned : null;
};

export const parseYouTubeUrl = (input?: string | null): YouTubeUrlParseResult => {
  const normalizedUrl = normalizeExperienceUrl(input);
  if (!normalizedUrl) return { type: "invalid", normalizedUrl: null };

  try {
    const url = new URL(normalizedUrl);
    const host = url.hostname.toLowerCase();
    if (!YOUTUBE_HOSTS.has(host)) return { type: "invalid", normalizedUrl };

    const pathParts = url.pathname.split("/").filter(Boolean);
    if (host === "youtu.be") {
      const videoId = boundedSelector(pathParts[0]);
      return videoId && VIDEO_ID_PATTERN.test(videoId)
        ? { type: "video", videoId, normalizedUrl }
        : { type: "invalid", normalizedUrl };
    }

    const firstPart = pathParts[0] || "";
    const secondPart = pathParts[1] || "";
    if (firstPart.startsWith("@")) {
      const handle = boundedSelector(firstPart.slice(1));
      return handle ? { type: "handle", handle, normalizedUrl } : { type: "invalid", normalizedUrl };
    }

    if (firstPart === "channel") {
      const channelId = boundedSelector(secondPart);
      return channelId && CHANNEL_ID_PATTERN.test(channelId)
        ? { type: "channelId", channelId, normalizedUrl }
        : { type: "invalid", normalizedUrl };
    }

    if (firstPart === "user") {
      const username = boundedSelector(secondPart);
      return username ? { type: "username", username, normalizedUrl } : { type: "invalid", normalizedUrl };
    }

    if (firstPart === "c") {
      const path = boundedSelector(secondPart);
      return path ? { type: "customPath", path, normalizedUrl } : { type: "invalid", normalizedUrl };
    }

    if (firstPart === "watch") {
      const videoId = boundedSelector(url.searchParams.get("v"));
      return videoId && VIDEO_ID_PATTERN.test(videoId)
        ? { type: "video", videoId, normalizedUrl }
        : { type: "invalid", normalizedUrl };
    }

    if (firstPart === "shorts") {
      const videoId = boundedSelector(secondPart);
      return videoId && VIDEO_ID_PATTERN.test(videoId)
        ? { type: "video", videoId, normalizedUrl }
        : { type: "invalid", normalizedUrl };
    }

    if (firstPart && !CUSTOM_PATH_RESERVED.has(firstPart.toLowerCase())) {
      const path = boundedSelector(firstPart);
      return path
        ? { type: "customPath", path, normalizedUrl }
        : { type: "invalid", normalizedUrl };
    }

    return { type: "invalid", normalizedUrl };
  } catch {
    return { type: "invalid", normalizedUrl };
  }
};

export async function resolveYouTubeChannelIdentity(input: string, options: ResolveYouTubeOptions = {}) {
  const parsed = parseYouTubeUrl(input);
  if (parsed.type === "invalid") return null;

  const cacheKey = `${options.resolveProviderIdentity ? "provider" : "local"}:${parsed.normalizedUrl}`;
  const cached = identityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const store = (value: YouTubeIdentity) => {
    identityCache.set(cacheKey, {
      expiresAt: Date.now() + (value.source === "youtube_data_api" ? SUCCESS_TTL_MS : FALLBACK_TTL_MS),
      value,
    });
    return value;
  };

  if (!options.resolveProviderIdentity) {
    options.warn?.("YouTube provider resolution is unavailable; using URL fallback identity.");
    return store(fallbackIdentity(parsed, parsed.normalizedUrl));
  }

  try {
    let selector: YouTubeProviderSelector | null = null;
    if (parsed.type === "handle") {
      selector = { selector: "handle", value: parsed.handle };
    } else if (parsed.type === "channelId") {
      selector = { selector: "channel_id", value: parsed.channelId };
    } else if (parsed.type === "username") {
      selector = { selector: "username", value: parsed.username };
    } else if (parsed.type === "video") {
      selector = { selector: "video_id", value: parsed.videoId };
    } else if (parsed.type === "customPath") {
      const channelId = await options.resolveChannelIdFromPage?.(parsed.normalizedUrl);
      if (channelId && CHANNEL_ID_PATTERN.test(channelId)) {
        selector = { selector: "channel_id", value: channelId };
      }
    }

    const resolved = selector ? await options.resolveProviderIdentity(selector) : null;
    return store(resolved || fallbackIdentity(parsed, parsed.normalizedUrl));
  } catch {
    return store(fallbackIdentity(parsed, parsed.normalizedUrl));
  }
}

export const clearYouTubeIdentityCacheForTests = () => {
  identityCache.clear();
};
