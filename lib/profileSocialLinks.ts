import type { BackendSocialConnections } from "./backendClient";

export type SocialIconName = "youtube" | "instagram" | "tiktok" | "facebook" | "linkedin" | "x" | "globe";
export type SocialPlatformKey =
  | "instagram"
  | "youtube"
  | "x"
  | "linkedin"
  | "tiktok"
  | "facebook"
  | "threads"
  | "twitch"
  | "discord"
  | "behance"
  | "dribbble"
  | "github"
  | "medium"
  | "substack"
  | "pinterest"
  | "snapchat"
  | "website";

export type SocialIconLink = {
  key: string;
  label: string;
  href: string;
  icon: SocialIconName;
};

export type SocialPlatformDetection = {
  platform: SocialPlatformKey;
  name: string;
  handle: string;
  icon: SocialIconName;
};

export type NormalizedSocialUrl =
  | { ok: true; url: string; detection: SocialPlatformDetection }
  | { ok: false; error: string };

const PLATFORM_META: Record<SocialPlatformKey, { name: string; icon: SocialIconName }> = {
  instagram: { name: "Instagram", icon: "instagram" },
  youtube: { name: "YouTube", icon: "youtube" },
  x: { name: "X", icon: "x" },
  linkedin: { name: "LinkedIn", icon: "linkedin" },
  tiktok: { name: "TikTok", icon: "tiktok" },
  facebook: { name: "Facebook", icon: "facebook" },
  threads: { name: "Threads", icon: "globe" },
  twitch: { name: "Twitch", icon: "globe" },
  discord: { name: "Discord", icon: "globe" },
  behance: { name: "Behance", icon: "globe" },
  dribbble: { name: "Dribbble", icon: "globe" },
  github: { name: "GitHub", icon: "globe" },
  medium: { name: "Medium", icon: "globe" },
  substack: { name: "Substack", icon: "globe" },
  pinterest: { name: "Pinterest", icon: "globe" },
  snapchat: { name: "Snapchat", icon: "globe" },
  website: { name: "Website", icon: "globe" },
};

const unsafeSchemePattern = /^(javascript|data|file|vbscript|blob):/i;

const cleanPathPart = (value?: string | null) => {
  const decoded = decodeURIComponent(value || "").trim();
  return decoded.replace(/^@+/, "").replace(/\/+$/, "");
};

const firstUsefulPathPart = (url: URL, ignored = new Set<string>()) => {
  const part = url.pathname
    .split("/")
    .map(cleanPathPart)
    .find((item) => item && !ignored.has(item.toLowerCase()));
  return part || "";
};

export const platformDisplayName = (platform: SocialPlatformKey) => PLATFORM_META[platform].name;

export const normalizeSocialProfileUrl = (value?: string | null): NormalizedSocialUrl => {
  const trimmed = value?.trim();
  if (!trimmed) return { ok: false, error: "Enter a social profile URL." };
  if (unsafeSchemePattern.test(trimmed)) {
    return { ok: false, error: "Use a safe public URL." };
  }

  try {
    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    if (!["http:", "https:"].includes(url.protocol)) {
      return { ok: false, error: "Use an http or https URL." };
    }
    if (!url.hostname.includes(".")) {
      return { ok: false, error: "Enter a valid public URL." };
    }
    url.hash = "";
    return { ok: true, url: url.toString(), detection: detectSocialPlatform(url.toString()) };
  } catch {
    return { ok: false, error: "Enter a valid public URL." };
  }
};

export const detectSocialPlatform = (href: string): SocialPlatformDetection => {
  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    let platform: SocialPlatformKey = "website";
    let handle = "";

    if (host.includes("youtube.com") || host.includes("youtu.be")) {
      platform = "youtube";
      const parts = url.pathname.split("/").map(cleanPathPart).filter(Boolean);
      handle = parts.find((part) => part.startsWith("@")) || parts.find((part) => !["channel", "c", "user"].includes(part.toLowerCase())) || host;
      if (handle && !handle.startsWith("@") && !["channel", "c", "user"].includes(handle.toLowerCase())) {
        handle = handle.startsWith("@") ? handle : `@${handle}`;
      }
    } else if (host.includes("instagram.com")) {
      platform = "instagram";
      handle = firstUsefulPathPart(url, new Set(["p", "reel", "stories", "explore"]));
      handle = handle ? `@${handle}` : host;
    } else if (host === "x.com" || host.includes("twitter.com")) {
      platform = "x";
      handle = firstUsefulPathPart(url, new Set(["home", "search", "explore", "i"]));
      handle = handle ? `@${handle}` : host;
    } else if (host.includes("linkedin.com")) {
      platform = "linkedin";
      const parts = url.pathname.split("/").map(cleanPathPart).filter(Boolean);
      const typeIndex = parts.findIndex((part) => ["in", "company"].includes(part.toLowerCase()));
      handle = typeIndex >= 0 && parts[typeIndex + 1] ? parts[typeIndex + 1] : host;
    } else if (host.includes("tiktok.com")) {
      platform = "tiktok";
      handle = firstUsefulPathPart(url);
      handle = handle ? `@${handle}` : host;
    } else if (host.includes("facebook.com")) {
      platform = "facebook";
      handle = firstUsefulPathPart(url);
    } else if (host.includes("threads.net")) {
      platform = "threads";
      handle = firstUsefulPathPart(url);
      handle = handle ? `@${handle}` : host;
    } else if (host.includes("twitch.tv")) {
      platform = "twitch";
      handle = firstUsefulPathPart(url);
    } else if (host.includes("discord.gg") || host.includes("discord.com")) {
      platform = "discord";
      handle = firstUsefulPathPart(url) || host;
    } else if (host.includes("behance.net")) {
      platform = "behance";
      handle = firstUsefulPathPart(url);
    } else if (host.includes("dribbble.com")) {
      platform = "dribbble";
      handle = firstUsefulPathPart(url);
    } else if (host.includes("github.com")) {
      platform = "github";
      handle = firstUsefulPathPart(url);
    } else if (host.includes("medium.com")) {
      platform = "medium";
      handle = firstUsefulPathPart(url);
      handle = handle ? `@${handle}` : host;
    } else if (host.includes("substack.com")) {
      platform = "substack";
      handle = host.replace(/\.substack\.com$/, "") || host;
    } else if (host.includes("pinterest.com")) {
      platform = "pinterest";
      handle = firstUsefulPathPart(url);
    } else if (host.includes("snapchat.com")) {
      platform = "snapchat";
      handle = firstUsefulPathPart(url, new Set(["add"]));
    } else {
      handle = host;
    }

    const meta = PLATFORM_META[platform];
    return {
      platform,
      name: meta.name,
      handle: handle || host,
      icon: meta.icon,
    };
  } catch {
    return { platform: "website", name: "Website", handle: "website", icon: "globe" };
  }
};

export function buildSocialIconLinks({
  socialConnections,
  publicLinks = [],
  websiteOrSocialUrl,
}: {
  socialConnections?: BackendSocialConnections | null;
  publicLinks?: string[] | null;
  websiteOrSocialUrl?: string | null;
}) {
  const links: SocialIconLink[] = [];
  const seen = new Set<string>();

  const add = (href: string | null, fallback: Pick<SocialIconLink, "label" | "icon">) => {
    const normalized = normalizeSocialProfileUrl(href);
    if (!normalized.ok) return;
    const key = normalized.url.toLowerCase().replace(/\/$/, "");
    if (seen.has(key)) return;
    seen.add(key);
    const label = `${normalized.detection.name} · ${normalized.detection.handle}`;
    links.push({
      key,
      href: normalized.url,
      label: normalized.detection.platform === "website" ? fallback.label : label,
      icon: normalized.detection.platform === "website" ? fallback.icon : normalized.detection.icon,
    });
  };

  const youtube = socialConnections?.youtube;
  add(
    youtube?.channel_url ||
      (youtube?.channel_id ? `https://www.youtube.com/channel/${youtube.channel_id}` : null),
    { label: "Open YouTube", icon: "youtube" }
  );

  const instagram = socialConnections?.instagram;
  add(
    instagram?.url ||
      (instagram?.handle
        ? `https://www.instagram.com/${instagram.handle.replace(/^@+/, "")}`
        : null),
    { label: "Open Instagram", icon: "instagram" }
  );

  add(websiteOrSocialUrl ?? null, { label: "Open website", icon: "globe" });
  (publicLinks ?? []).forEach((href) => add(href, { label: "Open website", icon: "globe" }));

  return links.slice(0, 6);
}
