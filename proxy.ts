import { NextResponse, type NextRequest } from "next/server";

import {
  CSP_NONCE_HEADER,
  buildContentSecurityPolicy,
  contentSecurityPolicyHeaderName,
  type CspEnvironment,
} from "./lib/contentSecurityPolicy";

/**
 * Issues one nonce per response and attaches the content security policy.
 *
 * This exists because of how Next applies a nonce to its own inline scripts: it
 * reads the `Content-Security-Policy` header off the *request*, pulls the nonce
 * out of `script-src`, and stamps it onto the bootstrap and flight-data scripts
 * it emits (`next/dist/server/app-render/get-script-nonce-from-header.js`). So
 * the nonce has to be decided before rendering starts, which means here.
 *
 * The request header is always overwritten, never read. A client that sends its
 * own `Content-Security-Policy` or `x-nonce` header would otherwise be choosing
 * the value that authorizes inline script on its own page, which is the whole
 * attack the nonce is supposed to prevent.
 *
 * The file is `proxy.ts` rather than `middleware.ts` because Next 16 renamed the
 * convention; the old name still builds but warns, and the two may not coexist.
 */

const explicitAppEnv = () => process.env.APP_ENV || process.env.NEXT_PUBLIC_APP_ENV;

/** The same server-side production signal `next.config.ts` gates HSTS on. */
const isStrictProductionEnv = (): boolean => {
  const appEnv = explicitAppEnv();
  if (appEnv) return appEnv === "production";
  return process.env.VERCEL_ENV === "production";
};

/**
 * `NODE_ENV` is set by the Next CLI itself — `next dev` is development, `next
 * build`/`next start` are production — so it reports how the application was
 * actually compiled rather than how it was labelled.
 */
const cspEnvironment = (): CspEnvironment =>
  process.env.NODE_ENV === "development" ? "development" : "production";

const generateNonce = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export function proxy(request: NextRequest): NextResponse {
  const nonce = generateNonce();
  const policy = buildContentSecurityPolicy({
    nonce,
    environment: cspEnvironment(),
    backendUrl: process.env.NEXT_PUBLIC_BACKEND_URL,
  });
  const headerName = contentSecurityPolicyHeaderName({
    strictProduction: isStrictProductionEnv(),
    reportOnlyRequested: process.env.CSP_REPORT_ONLY === "1",
  });

  const requestHeaders = new Headers(request.headers);
  // Server-owned, both of them. `set` replaces whatever arrived.
  requestHeaders.set(CSP_NONCE_HEADER, nonce);
  requestHeaders.set("content-security-policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(headerName, policy);
  return response;
}

export const config = {
  // Documents only, because a content security policy is a statement about a
  // document. Immutable build output is served straight from disk and carries
  // no inline script, and API routes answer with JSON that no browser is going
  // to execute, style or frame — running this on them would buy nothing and put
  // a request-header rewrite in front of every authenticated call. Both still
  // receive `X-Frame-Options` and `nosniff` from the static header list in
  // `next.config.ts`.
  matcher: ["/((?!api/|_next/static|_next/image).*)"],
};
