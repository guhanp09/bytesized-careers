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

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

type ResolveYouTubeOptions = {
  apiKey?: string | null;
  fetcher?: Fetcher;
  timeoutMs?: number;
  warn?: (message: string) => void;
};

type YouTubeThumbnail = {
  url?: string;
};

type YouTubeApiItem = {
  id?: string;
  snippet?: {
    title?: string;
    localized?: {
      title?: string;
    };
    customUrl?: string;
    channelId?: string;
    thumbnails?: {
      default?: YouTubeThumbnail;
      medium?: YouTubeThumbnail;
      high?: YouTubeThumbnail;
    };
  };
};

type YouTubeApiResponse = {
  items?: YouTubeApiItem[];
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
const DEFAULT_TIMEOUT_MS = 4500;
const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
const FALLBACK_TTL_MS = 5 * 60 * 1000;
const CHANNEL_ID_PATTERN = /UC[\w-]{20,}/;

const identityCache = new Map<string, { expiresAt: number; value: YouTubeIdentity }>();

const cleanExperienceText = (value?: string | null) => value?.trim() || null;

const normalizeExperienceUrl = (value?: string | null) => {
  const raw = cleanExperienceText(value);
  if (!raw) return null;

  const candidate = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
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

const bestThumbnailUrl = (item: YouTubeApiItem) =>
  item.snippet?.thumbnails?.high?.url ||
  item.snippet?.thumbnails?.medium?.url ||
  item.snippet?.thumbnails?.default?.url ||
  null;

const cleanHandle = (value?: string | null) => {
  const text = cleanExperienceText(value);
  if (!text) return null;
  return text.replace(/^\/+/, "").replace(/^@?/, "@");
};

const normalizeYouTubeApiItem = (item: YouTubeApiItem): YouTubeIdentity | null => {
  const channelId = cleanExperienceText(item.id);
  const title = cleanExperienceText(item.snippet?.localized?.title) || cleanExperienceText(item.snippet?.title);
  if (!channelId || !title) return null;

  return {
    platform: "YouTube",
    name: title,
    logoUrl: bestThumbnailUrl(item),
    canonicalUrl: `https://www.youtube.com/channel/${channelId}`,
    externalId: channelId,
    handle: cleanHandle(item.snippet?.customUrl),
    confidence: "high",
    source: "youtube_data_api",
  };
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

const fetchWithTimeout = async (fetcher: Fetcher, input: string | URL, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const fetchYouTubeJson = async (url: URL, fetcher: Fetcher, timeoutMs: number) => {
  const response = await fetchWithTimeout(fetcher, url, { redirect: "follow" }, timeoutMs);
  if (!response.ok) return null;
  return (await response.json().catch(() => null)) as YouTubeApiResponse | null;
};

const channelsListUrl = (apiKey: string, filterKey: "id" | "forHandle" | "forUsername", filterValue: string) => {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "snippet");
  url.searchParams.set(filterKey, filterValue);
  url.searchParams.set("key", apiKey);
  return url;
};

const videosListUrl = (apiKey: string, videoId: string) => {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("id", videoId);
  url.searchParams.set("key", apiKey);
  return url;
};

const resolveChannelByFilter = async (
  apiKey: string,
  fetcher: Fetcher,
  timeoutMs: number,
  filterKey: "id" | "forHandle" | "forUsername",
  filterValue: string
) => {
  const data = await fetchYouTubeJson(channelsListUrl(apiKey, filterKey, filterValue), fetcher, timeoutMs);
  const item = data?.items?.[0];
  return item ? normalizeYouTubeApiItem(item) : null;
};

const resolveVideoChannel = async (apiKey: string, fetcher: Fetcher, timeoutMs: number, videoId: string) => {
  const data = await fetchYouTubeJson(videosListUrl(apiKey, videoId), fetcher, timeoutMs);
  const channelId = cleanExperienceText(data?.items?.[0]?.snippet?.channelId);
  return channelId ? resolveChannelByFilter(apiKey, fetcher, timeoutMs, "id", channelId) : null;
};

const extractChannelIdFromYouTubeHtml = (html: string) => {
  const compact = html.slice(0, 300_000);
  return (
    compact.match(/youtube\.com\/channel\/(UC[\w-]{20,})/i)?.[1] ||
    compact.match(/"channelId"\s*:\s*"(UC[\w-]{20,})"/i)?.[1] ||
    compact.match(/"browseId"\s*:\s*"(UC[\w-]{20,})"/i)?.[1] ||
    compact.match(CHANNEL_ID_PATTERN)?.[0] ||
    null
  );
};

const resolveCustomPathByHtml = async (normalizedUrl: string, apiKey: string, fetcher: Fetcher, timeoutMs: number) => {
  const url = new URL(normalizedUrl);
  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) return null;

  const response = await fetchWithTimeout(
    fetcher,
    normalizedUrl,
    {
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "CreatorJobs YouTube identity resolver",
      },
      redirect: "follow",
    },
    timeoutMs
  );
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("text/html")) return null;

  const channelId = extractChannelIdFromYouTubeHtml(await response.text());
  return channelId ? resolveChannelByFilter(apiKey, fetcher, timeoutMs, "id", channelId) : null;
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
      const videoId = cleanExperienceText(pathParts[0]);
      return videoId ? { type: "video", videoId, normalizedUrl } : { type: "invalid", normalizedUrl };
    }

    const firstPart = pathParts[0] || "";
    const secondPart = pathParts[1] || "";
    if (firstPart.startsWith("@")) {
      const handle = cleanExperienceText(firstPart.slice(1));
      return handle ? { type: "handle", handle, normalizedUrl } : { type: "invalid", normalizedUrl };
    }

    if (firstPart === "channel") {
      const channelId = cleanExperienceText(secondPart);
      return channelId && CHANNEL_ID_PATTERN.test(channelId)
        ? { type: "channelId", channelId, normalizedUrl }
        : { type: "invalid", normalizedUrl };
    }

    if (firstPart === "user") {
      const username = cleanExperienceText(secondPart);
      return username ? { type: "username", username, normalizedUrl } : { type: "invalid", normalizedUrl };
    }

    if (firstPart === "c") {
      const path = cleanExperienceText(secondPart);
      return path ? { type: "customPath", path, normalizedUrl } : { type: "invalid", normalizedUrl };
    }

    if (firstPart === "watch") {
      const videoId = cleanExperienceText(url.searchParams.get("v"));
      return videoId ? { type: "video", videoId, normalizedUrl } : { type: "invalid", normalizedUrl };
    }

    if (firstPart === "shorts") {
      const videoId = cleanExperienceText(secondPart);
      return videoId ? { type: "video", videoId, normalizedUrl } : { type: "invalid", normalizedUrl };
    }

    if (firstPart && !CUSTOM_PATH_RESERVED.has(firstPart.toLowerCase())) {
      return { type: "customPath", path: firstPart, normalizedUrl };
    }

    return { type: "invalid", normalizedUrl };
  } catch {
    return { type: "invalid", normalizedUrl };
  }
};

export async function resolveYouTubeChannelIdentity(input: string, options: ResolveYouTubeOptions = {}) {
  const parsed = parseYouTubeUrl(input);
  if (parsed.type === "invalid") return null;

  const apiKey = cleanExperienceText(options.apiKey);
  const fetcher = options.fetcher || fetch;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const cacheKey = `${apiKey ? "keyed" : "nokey"}:${parsed.normalizedUrl}`;
  const cached = identityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const store = (value: YouTubeIdentity) => {
    identityCache.set(cacheKey, {
      expiresAt: Date.now() + (value.source === "youtube_data_api" ? SUCCESS_TTL_MS : FALLBACK_TTL_MS),
      value,
    });
    return value;
  };

  if (!apiKey) {
    options.warn?.("YOUTUBE_DATA_API_KEY is not configured; using YouTube URL fallback identity.");
    return store(fallbackIdentity(parsed, parsed.normalizedUrl));
  }

  try {
    let resolved: YouTubeIdentity | null = null;
    if (parsed.type === "handle") {
      resolved = await resolveChannelByFilter(apiKey, fetcher, timeoutMs, "forHandle", `@${parsed.handle}`);
      if (!resolved) {
        resolved = await resolveChannelByFilter(apiKey, fetcher, timeoutMs, "forHandle", parsed.handle);
      }
    } else if (parsed.type === "channelId") {
      resolved = await resolveChannelByFilter(apiKey, fetcher, timeoutMs, "id", parsed.channelId);
    } else if (parsed.type === "username") {
      resolved = await resolveChannelByFilter(apiKey, fetcher, timeoutMs, "forUsername", parsed.username);
    } else if (parsed.type === "video") {
      resolved = await resolveVideoChannel(apiKey, fetcher, timeoutMs, parsed.videoId);
    } else if (parsed.type === "customPath") {
      resolved = await resolveCustomPathByHtml(parsed.normalizedUrl, apiKey, fetcher, timeoutMs);
    }

    return store(resolved || fallbackIdentity(parsed, parsed.normalizedUrl));
  } catch {
    return store(fallbackIdentity(parsed, parsed.normalizedUrl));
  }
}

export const clearYouTubeIdentityCacheForTests = () => {
  identityCache.clear();
};
