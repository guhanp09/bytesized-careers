import type { NextConfig } from "next";

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

const explicitAppEnv = () => process.env.APP_ENV || process.env.NEXT_PUBLIC_APP_ENV;

const isStrictProductionEnv = () => {
  const appEnv = explicitAppEnv();
  if (appEnv) return appEnv === "production";
  return process.env.VERCEL_ENV === "production";
};

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

const nextConfig: NextConfig = {
  allowedDevOrigins: ["localhost", "127.0.0.1"],
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
          // The modern statement of "nobody frames this". `X-Frame-Options`
          // stays because it is what older browsers read, and the two agree;
          // `frame-ancestors` is the one a modern browser obeys, and it is the
          // only directive shipped here. A full policy needs a decision about
          // inline scripts that this slice does not make, and a half-considered
          // `script-src` breaks the application rather than protecting it.
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'",
          },
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
