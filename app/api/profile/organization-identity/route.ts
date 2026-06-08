import { NextResponse } from "next/server";

import {
  decodeExperienceHtmlEntities,
  inferExperienceFromUrl,
  normalizeExperienceUrl,
  resolveExperienceOrganizationName,
} from "../../../../lib/profileExperience";
import { resolveYouTubeChannelIdentity } from "../../../../lib/youtubeIdentity";

export const runtime = "nodejs";

const MAX_HTML_BYTES = 200_000;
const FETCH_TIMEOUT_MS = 2500;

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^0\./,
  /^169\.254\./,
  /^\[?::1\]?$/i,
];

const isBlockedHost = (host: string) => PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host));

const attrValue = (tag: string, attr: string) => {
  const match = tag.match(new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, "i"));
  return decodeExperienceHtmlEntities(match?.[1]) || null;
};

const metaContent = (html: string, key: string) => {
  const propertyPattern = new RegExp(`<meta\\b[^>]*(?:property|name)\\s*=\\s*["']${key}["'][^>]*>`, "i");
  const tag = html.match(propertyPattern)?.[0];
  return tag ? attrValue(tag, "content") : null;
};

const linkHref = (html: string, relName: string) => {
  const linkPattern = new RegExp(`<link\\b[^>]*rel\\s*=\\s*["'][^"']*${relName}[^"']*["'][^>]*>`, "i");
  const tag = html.match(linkPattern)?.[0];
  return tag ? attrValue(tag, "href") : null;
};

const titleText = (html: string) => {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return decodeExperienceHtmlEntities(match?.[1]?.replace(/\s+/g, " ").trim()) || null;
};

const absolutize = (value: string | null, baseUrl: string) => {
  if (!value) return null;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const rawUrl = typeof body?.url === "string" ? body.url : "";
  const normalizedUrl = normalizeExperienceUrl(rawUrl);

  if (!normalizedUrl) {
    return NextResponse.json(
      {
        error: "Enter a valid URL, like youtube.com/@channel or company.com.",
        normalizedUrl: null,
        platform: null,
        inferredName: null,
        logoUrl: null,
        faviconUrl: null,
        confidence: "none",
      },
      { status: 400 }
    );
  }

  const parsedUrl = new URL(normalizedUrl);
  if (isBlockedHost(parsedUrl.hostname)) {
    return NextResponse.json(
      {
        error: "Enter a valid URL, like youtube.com/@channel or company.com.",
        normalizedUrl,
        platform: null,
        inferredName: null,
        logoUrl: null,
        faviconUrl: null,
        confidence: "none",
      },
      { status: 400 }
    );
  }

  const inferred = inferExperienceFromUrl(normalizedUrl);
  const youtubeIdentity = await resolveYouTubeChannelIdentity(normalizedUrl, {
    apiKey: process.env.YOUTUBE_DATA_API_KEY || process.env.YOUTUBE_API_KEY,
    warn:
      process.env.NODE_ENV === "development"
        ? (message) => {
            console.warn(message);
          }
        : undefined,
  });

  if (youtubeIdentity) {
    return NextResponse.json({
      normalizedUrl: youtubeIdentity.canonicalUrl || normalizedUrl,
      platform: youtubeIdentity.platform,
      inferredName: youtubeIdentity.name,
      logoUrl: youtubeIdentity.logoUrl,
      faviconUrl: null,
      canonicalUrl: youtubeIdentity.canonicalUrl,
      externalId: youtubeIdentity.externalId,
      handle: youtubeIdentity.handle,
      error: null,
      confidence: youtubeIdentity.confidence,
      source: youtubeIdentity.source,
    });
  }

  const fallback = {
    normalizedUrl,
    platform: inferred.platform,
    inferredName: inferred.suggestedOrganizationName,
    logoUrl: inferred.suggestedLogoUrl,
    faviconUrl: inferred.faviconUrl,
    confidence: inferred.confidence,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(normalizedUrl, {
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": "CreatorJobs local profile resolver",
      },
      redirect: "follow",
    });
    clearTimeout(timeout);

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.toLowerCase().includes("text/html")) {
      return NextResponse.json({
        ...fallback,
        error: "We could not read this page. Check the URL or enter the name manually.",
      });
    }

    const html = (await response.text()).slice(0, MAX_HTML_BYTES);
    const rawMetadataName =
      metaContent(html, "og:site_name") ||
      metaContent(html, "og:title") ||
      metaContent(html, "twitter:title") ||
      titleText(html);
    const metadataName = resolveExperienceOrganizationName({
      rawName: rawMetadataName,
      platform: inferred.platform,
      normalizedUrl,
    });
    const metadataLogo =
      metaContent(html, "og:image") ||
      metaContent(html, "twitter:image") ||
      linkHref(html, "apple-touch-icon") ||
      linkHref(html, "icon");
    const faviconUrl = absolutize(linkHref(html, "icon"), normalizedUrl) || inferred.faviconUrl;

    return NextResponse.json({
      normalizedUrl,
      platform: inferred.platform,
      inferredName: metadataName || inferred.suggestedOrganizationName,
      logoUrl: absolutize(metadataLogo, normalizedUrl) || inferred.suggestedLogoUrl,
      faviconUrl,
      error: null,
      confidence: metadataName || metadataLogo ? "high" : inferred.confidence,
    });
  } catch {
    return NextResponse.json({
      ...fallback,
      error: "We could not read this page. Check the URL or enter the name manually.",
    });
  }
}
