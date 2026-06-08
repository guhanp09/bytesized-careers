import type { BackendProfileExperienceItem } from "./backendClient";
import type { BackendProfileExperienceLink } from "./backendClient";

const MONTH_ORDER: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const RESERVED_SOCIAL_PATHS = new Set([
  "channel",
  "c",
  "user",
  "watch",
  "shorts",
  "reels",
  "videos",
  "video",
  "company",
  "in",
  "feed",
  "home",
  "about",
  "posts",
]);

export const cleanExperienceText = (value?: string | null) => value?.trim() || null;

export const initialsForExperience = (value?: string | null) => {
  const text = cleanExperienceText(value);
  if (!text) return null;
  return (
    text
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || null
  );
};

export const monthLabelForExperience = (value?: string | null) => {
  const text = cleanExperienceText(value);
  if (!text) return null;
  const month = MONTH_ORDER[text.toLowerCase()];
  if (!month) return text;
  return new Date(2026, month - 1, 1).toLocaleString(undefined, { month: "short" });
};

const monthScore = (value?: string | null) => MONTH_ORDER[(cleanExperienceText(value) || "").toLowerCase()] || 0;

const dateScore = (item: BackendProfileExperienceItem) => {
  if (item.is_current) return Number.MAX_SAFE_INTEGER;
  const year = Number(cleanExperienceText(item.end_year) || cleanExperienceText(item.start_year) || "0");
  const month = monthScore(item.end_month) || monthScore(item.start_month);
  return year * 100 + month;
};

const hasAnyDate = (item: BackendProfileExperienceItem) =>
  Boolean(
    cleanExperienceText(item.start_month) ||
      cleanExperienceText(item.start_year) ||
      cleanExperienceText(item.end_month) ||
      cleanExperienceText(item.end_year)
  );

export const sortExperienceItems = (items?: BackendProfileExperienceItem[] | null) =>
  [...(items || [])]
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const currentDiff = Number(Boolean(right.item.is_current)) - Number(Boolean(left.item.is_current));
      if (currentDiff !== 0) return currentDiff;

      const dateDiff = dateScore(right.item) - dateScore(left.item);
      if (dateDiff !== 0) return dateDiff;

      const datedDiff = Number(hasAnyDate(right.item)) - Number(hasAnyDate(left.item));
      if (datedDiff !== 0) return datedDiff;

      return left.index - right.index;
    })
    .map(({ item }) => item);

const formatDatePart = (month?: string | null, year?: string | null) =>
  [monthLabelForExperience(month), cleanExperienceText(year)].filter(Boolean).join(" ");

export const formatExperienceDateRange = (item: BackendProfileExperienceItem) => {
  const start = formatDatePart(item.start_month, item.start_year);
  const end = item.is_current ? "Present" : formatDatePart(item.end_month, item.end_year);
  if (start && end) return `${start} - ${end}`;
  if (start) return `${start} - Present`;
  if (end) return end;
  return null;
};

const titleCaseWords = (value: string) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const humanizeSlug = (value?: string | null) => {
  const text = cleanExperienceText(value);
  if (!text) return null;
  return titleCaseWords(text.replace(/^@/, "").replace(/[-_]+/g, " "));
};

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

export const decodeExperienceHtmlEntities = (value?: string | null) => {
  const text = cleanExperienceText(value);
  if (!text) return null;
  return text
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => NAMED_HTML_ENTITIES[name.toLowerCase()] || match);
};

const instagramHandleFromPath = (value?: string | null) => {
  const text = cleanExperienceText(value);
  if (!text) return null;
  const cleanHandle = text.replace(/^@/, "").trim();
  return cleanHandle ? `@${cleanHandle}` : null;
};

const cleanInstagramMetadataName = (value?: string | null, fallbackHandle?: string | null) => {
  const decoded = decodeExperienceHtmlEntities(value);
  if (!decoded) return fallbackHandle || null;

  let next = decoded.replace(/\s+/g, " ").trim();

  next = next
    .replace(/\s*[•-]\s*Instagram photos and videos$/i, "")
    .replace(/\s*[•-]\s*Instagram$/i, "")
    .replace(/\s*\|\s*Instagram$/i, "")
    .replace(/\s+on Instagram$/i, "")
    .trim();

  if (!next) return fallbackHandle || null;

  const normalized = next.toLowerCase();
  if (
    normalized === "instagram" ||
    normalized === "instagram photos and videos" ||
    normalized === "login" ||
    normalized === "sign up"
  ) {
    return fallbackHandle || null;
  }

  next = next.replace(/\(\s*@[\w.]+\s*\)$/i, "").trim();

  if (!next) return fallbackHandle || null;
  if (/&#\d+;|&#x[0-9a-f]+;|&[a-z]+;/i.test(next)) {
    return fallbackHandle || null;
  }

  return next;
};

export const resolveExperienceOrganizationName = ({
  rawName,
  platform,
  normalizedUrl,
}: {
  rawName?: string | null;
  platform?: string | null;
  normalizedUrl?: string | null;
}) => {
  const decoded = decodeExperienceHtmlEntities(rawName);
  const cleanPlatform = platform?.toLowerCase() || "";
  const normalized = normalizeExperienceUrl(normalizedUrl) || cleanExperienceText(normalizedUrl);
  let fallbackHandle: string | null = null;

  if (normalized) {
    try {
      const parsed = new URL(normalized);
      const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
      const pathParts = parsed.pathname.split("/").filter(Boolean);
      const firstPart = pathParts[0] || "";
      const secondPart = pathParts[1] || "";
      const handleCandidate = firstPart.startsWith("@")
        ? firstPart
        : RESERVED_SOCIAL_PATHS.has(firstPart.toLowerCase())
          ? secondPart
          : firstPart;

      if (host.includes("instagram.com") || cleanPlatform.includes("instagram")) {
        fallbackHandle = instagramHandleFromPath(handleCandidate);
        return cleanInstagramMetadataName(decoded, fallbackHandle);
      }
    } catch {
      // Fall through to generic cleanup below.
    }
  }

  return decoded;
};

export const normalizeExperienceUrl = (value?: string | null) => {
  const raw = cleanExperienceText(value);
  if (!raw) return null;

  const candidate = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

export const experienceUrlError = (value?: string | null) => {
  const raw = cleanExperienceText(value);
  if (!raw) return null;
  const candidate = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (!["http:", "https:"].includes(url.protocol)) {
      return "Only http and https links are supported.";
    }
    if (!url.hostname.includes(".") && url.hostname !== "localhost") {
      return "This link looks incomplete. Paste the full channel, page, or company URL.";
    }
    return null;
  } catch {
    return "Enter a valid URL, like youtube.com/@channel or company.com.";
  }
};

export type ExperienceUrlInference = {
  normalizedUrl: string | null;
  platform: string | null;
  suggestedOrganizationName: string | null;
  suggestedLogoUrl: string | null;
  faviconUrl: string | null;
  error: string | null;
  confidence: "none" | "low" | "medium" | "high";
};

const SOCIAL_PLATFORM_HOST_PATTERNS = [
  "youtube.com",
  "youtu.be",
  "instagram.com",
  "tiktok.com",
  "linkedin.com",
  "x.com",
  "twitter.com",
] as const;

const isSocialPlatformHost = (host: string) =>
  SOCIAL_PLATFORM_HOST_PATTERNS.some((pattern) => host === pattern || host.endsWith(`.${pattern}`));

export const inferExperienceFromUrl = (value?: string | null): ExperienceUrlInference => {
  const normalizedUrl = normalizeExperienceUrl(value);
  if (!normalizedUrl) {
    return {
      normalizedUrl: cleanExperienceText(value),
      platform: null,
      suggestedOrganizationName: null,
      suggestedLogoUrl: null,
      faviconUrl: null,
      error: experienceUrlError(value),
      confidence: "none",
    };
  }

  try {
    const url = new URL(normalizedUrl);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    const pathParts = url.pathname.split("/").filter(Boolean);
    const firstPart = pathParts[0] || "";
    const secondPart = pathParts[1] || "";
    const lastPart = pathParts[pathParts.length - 1] || "";
    const handleCandidate = firstPart.startsWith("@")
      ? firstPart
      : RESERVED_SOCIAL_PATHS.has(firstPart.toLowerCase())
        ? secondPart
        : firstPart;

    let platform: string | null = null;
    let suggestedOrganizationName: string | null = null;

    if (host.includes("youtube.com") || host === "youtu.be") {
      platform = "YouTube";
      suggestedOrganizationName =
        humanizeSlug(handleCandidate) ||
        humanizeSlug(lastPart) ||
        humanizeSlug(host.split(".")[0]);
    } else if (host.includes("instagram.com")) {
      platform = "Instagram";
      suggestedOrganizationName = instagramHandleFromPath(handleCandidate);
    } else if (host.includes("tiktok.com")) {
      platform = "TikTok";
      suggestedOrganizationName = humanizeSlug(handleCandidate);
    } else if (host.includes("linkedin.com")) {
      platform = "LinkedIn";
      suggestedOrganizationName = humanizeSlug(secondPart || firstPart);
    } else if (host === "x.com" || host.includes("twitter.com")) {
      platform = "X";
      suggestedOrganizationName = humanizeSlug(handleCandidate);
    } else if (host.includes("spotify.com") || host.includes("apple.com")) {
      platform = "Podcast";
      suggestedOrganizationName = humanizeSlug(lastPart || firstPart);
    } else if (host.includes("substack.com") || host.includes("beehiiv.com")) {
      platform = "Newsletter";
      suggestedOrganizationName = humanizeSlug(host.split(".")[0]);
    } else {
      platform = "Website";
      suggestedOrganizationName = humanizeSlug(host.split(".")[0]);
    }

    const faviconUrl = `${url.origin}/favicon.ico`;
    const suggestedLogoUrl = isSocialPlatformHost(host) ? null : faviconUrl;

    return {
      normalizedUrl,
      platform,
      suggestedOrganizationName: resolveExperienceOrganizationName({
        rawName: suggestedOrganizationName,
        platform,
        normalizedUrl,
      }),
      suggestedLogoUrl,
      faviconUrl,
      error: null,
      confidence: suggestedOrganizationName ? "medium" : "low",
    };
  } catch {
    return {
      normalizedUrl,
      platform: null,
      suggestedOrganizationName: null,
      suggestedLogoUrl: null,
      faviconUrl: null,
      error: "Enter a valid URL, like youtube.com/@channel or company.com.",
      confidence: "none",
    };
  }
};

export const linkKeyForExperience = (url?: string | null) =>
  (normalizeExperienceUrl(url) || cleanExperienceText(url) || "").toLowerCase();

export const linkLabelForExperience = (url?: string | null) => {
  const normalizedUrl = normalizeExperienceUrl(url);
  if (!normalizedUrl) return cleanExperienceText(url);
  try {
    const parsed = new URL(normalizedUrl);
    const host = parsed.hostname.replace(/^www\./, "");
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const handle = pathParts.find((part) => part.startsWith("@")) || pathParts[pathParts.length - 1];
    return handle || host;
  } catch {
    return cleanExperienceText(url);
  }
};

export const experienceLinksForItem = (item: BackendProfileExperienceItem) => {
  const primaryUrl = cleanExperienceText(item.organization_url);
  const primaryInference = inferExperienceFromUrl(primaryUrl);
  const links: BackendProfileExperienceLink[] = [];

  if (primaryUrl) {
    links.push({
      id: "primary",
      url: primaryInference.normalizedUrl || primaryUrl,
      platform: primaryInference.platform || item.platform || null,
      resolved_name: cleanExperienceText(item.organization_name),
      logo_url: cleanExperienceText(item.organization_logo_url) || primaryInference.suggestedLogoUrl,
    });
  }

  for (const link of item.organization_links || []) {
    const normalized = normalizeExperienceUrl(link.url) || cleanExperienceText(link.url);
    if (!normalized) continue;
    const inferred = inferExperienceFromUrl(normalized);
    links.push({
      id: link.id || `link-${links.length}`,
      url: inferred.normalizedUrl || normalized,
      platform: link.platform || inferred.platform,
      resolved_name: link.resolved_name || inferred.suggestedOrganizationName,
      logo_url: link.logo_url || inferred.suggestedLogoUrl,
    });
  }

  const seen = new Set<string>();
  return links.filter((link) => {
    const key = linkKeyForExperience(link.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
