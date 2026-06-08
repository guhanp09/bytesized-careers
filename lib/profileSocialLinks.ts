import type { BackendSocialConnections } from "./backendClient";

export type SocialIconName = "youtube" | "instagram" | "tiktok" | "linkedin" | "x" | "globe";

export type SocialIconLink = {
  key: string;
  label: string;
  href: string;
  icon: SocialIconName;
};

const normalizeUrl = (value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const url = new URL(withProtocol);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
};

const inferPlatform = (href: string): Pick<SocialIconLink, "label" | "icon"> => {
  try {
    const host = new URL(href).hostname.replace(/^www\./, "").toLowerCase();
    if (host.includes("youtube.com") || host.includes("youtu.be")) {
      return { label: "Open YouTube", icon: "youtube" };
    }
    if (host.includes("instagram.com")) return { label: "Open Instagram", icon: "instagram" };
    if (host.includes("tiktok.com")) return { label: "Open TikTok", icon: "tiktok" };
    if (host.includes("linkedin.com")) return { label: "Open LinkedIn", icon: "linkedin" };
    if (host === "x.com" || host.includes("twitter.com")) return { label: "Open X", icon: "x" };
  } catch {
    return { label: "Open website", icon: "globe" };
  }
  return { label: "Open website", icon: "globe" };
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
    const normalized = normalizeUrl(href);
    if (!normalized) return;
    const key = normalized.toLowerCase().replace(/\/$/, "");
    if (seen.has(key)) return;
    seen.add(key);
    const inferred = inferPlatform(normalized);
    links.push({
      key,
      href: normalized,
      label: inferred.icon === "globe" ? fallback.label : inferred.label,
      icon: inferred.icon === "globe" ? fallback.icon : inferred.icon,
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
