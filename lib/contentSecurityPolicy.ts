/**
 * What a CreatorJobs page may execute, load, and reach.
 *
 * The policy lives here rather than in `next.config.ts` because one directive —
 * `script-src` — has to change on every request. Inline scripts exist and cannot
 * be removed: Next's App Router streams its flight data through inline
 * `<script>` blocks whose contents differ per page and per render, so no fixed
 * hash can cover them. That leaves exactly two options, a per-request nonce or
 * `'unsafe-inline'`, and `'unsafe-inline'` in `script-src` means the policy does
 * not defend against script injection at all. So: a nonce, generated in
 * middleware, written into the request so the framework stamps its own scripts
 * with it, and written into the response so the browser knows which ones to
 * trust.
 *
 * Everything here is a pure function of a nonce and configuration, so the whole
 * policy can be asserted in a unit test rather than only observed in a browser.
 *
 * Two decisions are worth stating outright, because both look like laziness and
 * neither is:
 *
 * `style-src` carries `'unsafe-inline'`. A nonce cannot authorize a *style
 * attribute*, only a `<style>` element, and this codebase sets `style={{…}}` in
 * about three dozen components. The alternative is not "a stricter style policy"
 * but "no style policy", and an injected stylesheet is a far smaller problem
 * than injected script. `script-src` gets no such exception.
 *
 * `img-src` carries `https:`. Creators link their work from wherever it lives,
 * which is the product, so a host list is not a thing that can exist. Images
 * cannot execute, and the permission is confined to this one directive — it is
 * deliberately not mirrored into `script-src`, `frame-src` or `connect-src`.
 */

export type CspEnvironment = "development" | "production";

export const CSP_ENFORCE_HEADER = "Content-Security-Policy";
export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";

/** The request header the layout reads its nonce back out of. */
export const CSP_NONCE_HEADER = "x-nonce";

/** Base64 as `crypto.getRandomValues` + `btoa` produce it, and nothing else. */
const NONCE_PATTERN = /^[A-Za-z0-9+/]{16,}={0,2}$/;

/**
 * A scheme, a host, and optionally a port — nothing that could end a directive
 * or start a header. Anything a URL parser produces that does not match this is
 * dropped rather than repaired.
 */
const ORIGIN_PATTERN = /^(?:https?|wss?):\/\/(?:[a-z0-9.-]+|\[[0-9a-f:]+\])(?::\d{1,5})?$/i;

/**
 * Mirrors `preferIPv4Loopback` in `lib/backendClient.ts`.
 *
 * The browser client rewrites a `localhost` backend to `127.0.0.1` before it
 * connects, because on macOS the two resolve differently and uvicorn binds one
 * of them. `connect-src` has to name the origin the browser actually opens, so
 * it has to know about the same rewrite. Both spellings are emitted: they are
 * the same machine, so listing both costs nothing and means a change to the
 * client's loopback handling cannot silently break local development.
 */
const loopbackVariants = (origin: string): string[] => {
  const pinned = origin.replace(/^((?:https?|wss?):\/\/)localhost(?=:|$)/i, "$1127.0.0.1");
  return pinned === origin ? [origin] : [origin, pinned];
};

/**
 * The origins the browser may open a connection to, derived from the configured
 * backend URL.
 *
 * Configuration is parsed, never interpolated. A value like
 * `https://api.example.com; script-src *` has to become nothing at all rather
 * than become a directive: this function is the only place a configured string
 * enters a response header, so it fails closed on everything it cannot fully
 * understand. Losing `connect-src` for a misconfigured backend breaks the
 * application loudly, which is the correct direction to fail.
 */
export function backendConnectSources(rawBackendUrl: string | null | undefined): string[] {
  if (typeof rawBackendUrl !== "string") return [];
  const candidate = rawBackendUrl.trim();
  if (!candidate) return [];
  // The URL parser *deletes* tabs and newlines rather than rejecting them, so
  // `https://api.example.com\tevil` would quietly parse as the host
  // `api.example.comevil`. That cannot inject a directive, but it can authorize
  // an origin nobody configured, which is not a thing to be relaxed about.
  if (/[\u0000-\u001f\u007f]/.test(candidate)) return [];

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return [];
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return [];
  // Credentials in a configured origin are a misconfiguration, and the userinfo
  // section is exactly where a value stops meaning what it looks like it means.
  if (parsed.username || parsed.password) return [];
  if (!parsed.hostname) return [];

  const httpOrigin = `${parsed.protocol}//${parsed.host}`;
  // `lib/realtimeMessaging.ts` builds its socket URL by swapping the scheme of
  // this same origin, so the policy derives the socket origin the same way
  // rather than guessing at a separate realtime host.
  const socketScheme = parsed.protocol === "https:" ? "wss:" : "ws:";
  const socketOrigin = `${socketScheme}//${parsed.host}`;

  const sources = [
    ...loopbackVariants(httpOrigin),
    ...loopbackVariants(socketOrigin),
  ];

  // Last gate. `new URL` normalizes a great deal, but the value only leaves here
  // if it is unmistakably an origin.
  return sources.every((source) => ORIGIN_PATTERN.test(source)) ? sources : [];
}

/**
 * The complete policy for one response.
 *
 * @throws if the nonce is not a value this module could have generated. A nonce
 * that fails this check is either a bug or a caller trying to put something else
 * into the header, and neither may reach a browser.
 */
export function buildContentSecurityPolicy(options: {
  nonce: string;
  environment: CspEnvironment;
  backendUrl?: string | null;
}): string {
  const { nonce, environment, backendUrl } = options;

  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error("Refusing to build a content security policy from an unrecognized nonce.");
  }

  const scriptSrc = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"];
  if (environment === "development") {
    // The dev server compiles modules through `eval` for its refresh transport.
    // A production build does not, and the production policy must never carry
    // this — there is a test for that, keyed on the server-side environment
    // rather than on anything a client can influence.
    scriptSrc.push("'unsafe-eval'");
  }

  const connectSrc = ["'self'", ...backendConnectSources(backendUrl)];

  const directives: Array<[string, string[]]> = [
    ["default-src", ["'self'"]],
    ["base-uri", ["'self'"]],
    ["object-src", ["'none'"]],
    ["frame-ancestors", ["'none'"]],
    // CreatorJobs embeds nothing today: portfolio video is linked and
    // thumbnailed, never framed, and the oEmbed `embed_html` a provider returns
    // is stored but never rendered. If an embed is added later this directive is
    // where it gets named, one provider at a time.
    ["frame-src", ["'none'"]],
    // Sign-in navigates (`window.location`) rather than submitting a form, so no
    // provider origin belongs here.
    ["form-action", ["'self'"]],
    ["script-src", scriptSrc],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:", "https:"]],
    ["font-src", ["'self'"]],
    ["connect-src", connectSrc],
  ];

  return directives
    .map(([directive, sources]) => `${directive} ${sources.join(" ")}`)
    .join("; ");
}

/**
 * Which header the policy ships under.
 *
 * Report-only exists so a policy change can be observed before it can break
 * anything, and it is unreachable in production by construction rather than by
 * remembering to turn it off. `strictProduction` is the same server-side signal
 * that gates HSTS; a `NEXT_PUBLIC_` value must never reach this decision.
 */
export function contentSecurityPolicyHeaderName(options: {
  strictProduction: boolean;
  reportOnlyRequested: boolean;
}): string {
  if (options.strictProduction) return CSP_ENFORCE_HEADER;
  return options.reportOnlyRequested ? CSP_REPORT_ONLY_HEADER : CSP_ENFORCE_HEADER;
}
