import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "../../../../lib/auth";
import { readOrganizationPage } from "../../../../lib/backendClient";
import {
  decodeExperienceHtmlEntities,
  inferExperienceFromUrl,
  normalizeExperienceUrl,
  resolveExperienceOrganizationName,
} from "../../../../lib/profileExperience";
import { resolveYouTubeChannelIdentity } from "../../../../lib/youtubeIdentity";

export const runtime = "nodejs";

/**
 * Organization/channel identity resolution for the signed-in product surfaces.
 *
 * This route once fetched whatever URL a caller typed, for anyone on the
 * internet, from the Next runtime: its own DNS resolution, its own redirect
 * following, environment proxies honoured, and a private-host pattern list a
 * decimal-encoded address walks straight through.
 *
 * It is now an orchestration boundary and nothing more. It requires a
 * same-origin signed-in caller, decides which identity strategy applies, and
 * asks the backend to read the page — where the shared `SafeOutboundFetcher`
 * pins each connection to the address that passed validation, re-validates
 * every redirect, refuses non-public destinations, and returns only the handful
 * of fields this resolver uses. No remote HTML reaches this runtime or the
 * browser.
 */
const sameOrigin = (request: NextRequest): boolean => {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) return false;
  return request.headers.get("sec-fetch-site") !== "cross-site";
};

const noStoreJson = <T,>(payload: T, status = 200) => {
  const response = NextResponse.json(payload, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
};

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

// A fast, obviously-wrong-input check so a private URL is answered without a
// round trip. It is not the security boundary and never was: the backend
// resolves, pins and re-validates every hop, and refuses anything non-public
// whatever this pattern list thinks.
const isBlockedHost = (host: string) => PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host));

const absolutize = (value: string | null, baseUrl: string) => {
  if (!value) return null;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
};

const INSTAGRAM_HOSTS = new Set(["instagram.com", "www.instagram.com", "m.instagram.com"]);
// Non-profile first path segments. /p/, /reel/, /stories/ get a specific message;
// the rest are reserved app routes that aren't profiles.
const INSTAGRAM_MEDIA_SEGMENTS = new Set(["p", "reel", "reels", "stories", "tv"]);
const INSTAGRAM_RESERVED_SEGMENTS = new Set([
  "accounts",
  "explore",
  "directory",
  "about",
  "web",
  "invites",
  "challenge",
  "developer",
  "legal",
  "privacy",
  "terms",
  "emails",
]);

const titleizeUsername = (username: string) =>
  username ? username.charAt(0).toUpperCase() + username.slice(1) : username;

const cleanInstagramName = (raw: string | null, username: string) => {
  const decoded = decodeExperienceHtmlEntities(raw);
  if (!decoded) return titleizeUsername(username);
  const cleaned = decoded
    .replace(/\s+/g, " ")
    .replace(/\s*\(@[^)]*\).*$/i, "")
    .replace(/\s*[•|\-]\s*Instagram.*$/i, "")
    .replace(/\s+on Instagram.*$/i, "")
    .trim();
  return cleaned || titleizeUsername(username);
};

type InstagramResolution =
  | { kind: "identity"; username: string; canonicalUrl: string }
  | { kind: "error"; status: number; error: string };

const resolveInstagramFromUrl = (parsedUrl: URL): InstagramResolution | null => {
  const host = parsedUrl.hostname.toLowerCase();
  if (!INSTAGRAM_HOSTS.has(host)) return null;

  const segments = parsedUrl.pathname
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  const firstSegment = (segments[0] || "").replace(/^@/, "").toLowerCase();

  if (INSTAGRAM_MEDIA_SEGMENTS.has(firstSegment)) {
    return {
      kind: "error",
      status: 400,
      error: "Use the Instagram profile URL, not a post, reel, or story link.",
    };
  }
  if (!firstSegment || INSTAGRAM_RESERVED_SEGMENTS.has(firstSegment) || !/^[a-z0-9._]{1,30}$/.test(firstSegment)) {
    return { kind: "error", status: 400, error: "Enter a valid Instagram profile URL." };
  }

  return {
    kind: "identity",
    username: firstSegment,
    canonicalUrl: `https://www.instagram.com/${firstSegment}/`,
  };
};

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) {
    return noStoreJson({ error: "origin_rejected" }, 403);
  }
  // A QA persona is a real signed-in account in the environments that have
  // them, and this endpoint reveals nothing about the caller, so it is not
  // excluded the way the provider-credential routes exclude it.
  const session = await getServerSession(authOptions);
  if (!session?.backendAccessToken || session.backendAuthError) {
    return noStoreJson({ error: "authentication_required" }, 401);
  }
  // Captured once so the closures below keep the narrowed type and, more
  // importantly, so the caller's token is what reaches the backend.
  const accessToken = session.backendAccessToken;

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
    // A custom path is the one YouTube shape whose channel id lives only in the
    // page. The backend reads it through the pinned boundary and returns the id
    // alone; nothing here fetches youtube.com.
    resolveChannelIdFromPage: async (pageUrl) => {
      try {
        const page = await readOrganizationPage(accessToken, pageUrl);
        return page.youtube_channel_id || null;
      } catch {
        return null;
      }
    },
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

  // Instagram: resolve identity from the URL itself and never dead-end on an
  // unreadable public page (Instagram serves login walls to server fetches).
  // The username/canonical URL is enough to proceed to public-code verification.
  const instagram = resolveInstagramFromUrl(parsedUrl);
  if (instagram) {
    if (instagram.kind === "error") {
      return NextResponse.json(
        {
          error: instagram.error,
          normalizedUrl,
          platform: "Instagram",
          inferredName: null,
          logoUrl: null,
          faviconUrl: null,
          confidence: "none",
        },
        { status: instagram.status }
      );
    }

    const { username, canonicalUrl } = instagram;
    // Best-effort: try to enrich name/avatar from public metadata, but treat any
    // failure as a graceful fallback to the URL-derived identity (no blocking error).
    let metadataName: string | null = null;
    let metadataLogo: string | null = null;
    try {
      // The server-owned read. Instagram commonly serves a login wall to server
      // fetches, so this stays strictly best-effort: empty fields fall through
      // to the identity the URL already gave us.
      const page = await readOrganizationPage(accessToken, canonicalUrl);
      metadataName = page.title || null;
      metadataLogo = page.image_url || null;
    } catch {
      // Unreadable public page is expected for Instagram; fall back to URL identity.
    }

    const resolvedLogo = absolutize(metadataLogo, canonicalUrl);
    return NextResponse.json({
      normalizedUrl: canonicalUrl,
      platform: "Instagram",
      inferredName: cleanInstagramName(metadataName, username),
      logoUrl: resolvedLogo,
      faviconUrl: null,
      canonicalUrl,
      handle: `@${username}`,
      externalId: null,
      error: null,
      confidence: metadataName || resolvedLogo ? "high" : "medium",
      source: "instagram_url",
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
    // The page is read by the backend through the shared pinned boundary, and
    // only these fields come back. Nothing in this runtime touches a URL the
    // user chose, so there is no DNS to re-resolve and no redirect to follow.
    const page = await readOrganizationPage(accessToken, normalizedUrl);
    const rawMetadataName = page.site_name || page.title;
    if (!rawMetadataName && !page.image_url && !page.icon_url) {
      return NextResponse.json({
        ...fallback,
        error: "We could not read this page. Check the URL or enter the name manually.",
      });
    }

    const metadataName = resolveExperienceOrganizationName({
      rawName: rawMetadataName,
      platform: inferred.platform,
      normalizedUrl,
    });
    const metadataLogo = page.image_url || page.icon_url;
    const faviconUrl = page.icon_url || inferred.faviconUrl;

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
