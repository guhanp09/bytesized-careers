import type { NextConfig } from "next";

import {
  isStrictProductionEnvironment,
  trustedMediaConfiguration,
} from "./lib/trustedMedia.ts";

const unsafeSecretValues = new Set([
  "",
  "change-me",
  "change-me-please",
  "changeme",
  "secret",
  "dev-secret",
  "insecure",
  "replace-me",
]);

const isStrictProductionEnv = () => isStrictProductionEnvironment(process.env);

const requireProductionEnv = () => {
  if (!isStrictProductionEnv()) return;

  const failures: string[] = [];
  const requireSafeSecret = (name: string) => {
    const value = (process.env[name] || "").trim();
    if (unsafeSecretValues.has(value.toLowerCase())) {
      failures.push(`${name} must be set to a strong non-placeholder value.`);
    }
  };
  const requireValue = (name: string) => {
    if (!(process.env[name] || "").trim()) {
      failures.push(`${name} is required in production.`);
    }
  };

  requireSafeSecret("NEXTAUTH_SECRET");
  requireValue("NEXTAUTH_URL");
  requireValue("NEXT_PUBLIC_SITE_URL");
  requireValue("MEDIA_PUBLIC_BASE_URL");
  requireValue("GOOGLE_CLIENT_ID");
  requireSafeSecret("GOOGLE_CLIENT_SECRET");

  const nextAuthUrl = (process.env.NEXTAUTH_URL || "").trim();
  if (/localhost|127\.0\.0\.1/.test(nextAuthUrl)) {
    failures.push("NEXTAUTH_URL must not point to localhost in production.");
  }

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  if (/localhost|127\.0\.0\.1/.test(siteUrl)) {
    failures.push("NEXT_PUBLIC_SITE_URL must not point to localhost in production.");
  }

  const publicBackendUrl = (process.env.NEXT_PUBLIC_BACKEND_URL || "").trim();
  if (!publicBackendUrl) {
    failures.push("NEXT_PUBLIC_BACKEND_URL is required in production for browser API calls.");
  }
  if (/localhost|127\.0\.0\.1/.test(publicBackendUrl)) {
    failures.push("NEXT_PUBLIC_BACKEND_URL must not point to localhost in production.");
  }

  const serverBackendUrl = (process.env.BACKEND_URL || process.env.INTERNAL_BACKEND_URL || publicBackendUrl).trim();
  if (!serverBackendUrl) {
    failures.push("BACKEND_URL or INTERNAL_BACKEND_URL is required in production.");
  }
  if (/localhost|127\.0\.0\.1/.test(serverBackendUrl)) {
    failures.push("Production backend URL must not point to localhost.");
  }

  if (process.env.NEXT_PUBLIC_USE_LOCAL_MOCKS === "true") {
    failures.push("NEXT_PUBLIC_USE_LOCAL_MOCKS must not be true in production.");
  }

  if (failures.length) {
    throw new Error(`Unsafe production frontend configuration: ${failures.join(" ")}`);
  }
};

requireProductionEnv();

const trustedMedia = trustedMediaConfiguration(process.env);
const MAX_OPTIMIZED_MEDIA_RESPONSE_BYTES = 10 * 1024 * 1024;
const release = (
  process.env.NEXT_PUBLIC_RELEASE_SHA ||
  process.env.CREATORJOBS_RELEASE ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  ""
).trim();
const safeRelease = /^[A-Za-z0-9][A-Za-z0-9._-]{6,99}$/.test(release) ? release : undefined;

const nextConfig: NextConfig = {
  // Release builds generate browser maps only long enough for
  // collect-private-source-maps.mjs to archive them and strip every public
  // copy. `npm run build` never emits them; `npm run build:release` is the
  // fail-closed production path.
  productionBrowserSourceMaps: process.env.CREATORJOBS_PRIVATE_SOURCE_MAPS === "true",
  env: safeRelease ? { NEXT_PUBLIC_RELEASE_SHA: safeRelease } : undefined,
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  images: {
    // This is a server-side fetch boundary. Only the two object-key prefixes
    // CreatorJobs itself writes are eligible; creator-linked portfolio/channel
    // images remain ordinary browser requests and never enter /_next/image.
    remotePatterns: trustedMedia?.remotePatterns ?? [],
    maximumRedirects: 0,
    maximumResponseBody: MAX_OPTIMIZED_MEDIA_RESPONSE_BYTES,
    dangerouslyAllowLocalIP: false,
    dangerouslyAllowSVG: false,
  },
  async headers() {
    const productionHeaders = isStrictProductionEnv()
      ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
      : [];

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          // The Content-Security-Policy is deliberately NOT here. One of its
          // directives changes per request — `script-src` carries a nonce — so
          // it is built in `middleware.ts` from `lib/contentSecurityPolicy.ts`
          // and is the only place that header is set. Emitting a second static
          // copy from this list would mean every response carried two policies
          // and had to satisfy both, which is a very quiet way to break a page.
          // `X-Frame-Options: DENY` above is the legacy half of
          // `frame-ancestors 'none'`, and it still reaches the static asset
          // responses that middleware does not run on.
          //
          // Google sign-in is a redirect flow today, but a popup flow is one
          // configuration change away and strict `same-origin` silently severs
          // the opener that such a flow depends on. This keeps the isolation
          // that matters — other origins cannot reach into this window — while
          // leaving that door open.
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin-allow-popups",
          },
          // CreatorJobs pages and assets are not building blocks for other
          // sites. This says so at the resource level, which is the half
          // `frame-ancestors` does not cover.
          {
            key: "Cross-Origin-Resource-Policy",
            value: "same-origin",
          },
          ...productionHeaders,
        ],
      },
    ];
  },
};

export default nextConfig;
