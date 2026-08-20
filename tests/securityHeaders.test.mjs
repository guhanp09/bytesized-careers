/**
 * The response headers every CreatorJobs page carries, and the policy inside
 * them.
 *
 * The static headers are asserted against the configuration rather than a
 * running server, so the contract is checked on every unit run. The content
 * security policy is asserted against the function that builds it, which is the
 * same function `proxy.ts` calls — so these are the real strings a browser
 * receives, not a restatement of them.
 *
 * What a browser does with the policy is a separate obligation and lives in
 * `tests/e2e/qa/content-security-policy.spec.ts`. A policy that passes every
 * assertion here can still break the application or protect nothing, and only a
 * browser can say which.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CSP_ENFORCE_HEADER,
  CSP_REPORT_ONLY_HEADER,
  backendConnectSources,
  buildContentSecurityPolicy,
  contentSecurityPolicyHeaderName,
} from "../lib/contentSecurityPolicy.ts";

const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
const proxySource = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
const trustedMediaSource = readFileSync(new URL("../lib/trustedMedia.ts", import.meta.url), "utf8");

const headerValue = (key) => {
  const pattern = new RegExp(
    `key:\\s*"${key}"\\s*,?\\s*\\n?\\s*value:\\s*"([^"]*)"`,
    "s"
  );
  return config.match(pattern)?.[1] ?? null;
};

const NONCE = "AbCdEfGhIjKlMnOpQrStUv==";

const policy = (overrides = {}) =>
  buildContentSecurityPolicy({
    nonce: NONCE,
    environment: "production",
    backendUrl: "https://api.creatorjobs.example/api/v1",
    ...overrides,
  });

/** One directive's source list, so a test can assert about it and nothing else. */
const directive = (name, value = policy()) => {
  const found = value
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  return found ? found.slice(name.length).trim() : null;
};

test("every response states the basics", () => {
  assert.equal(headerValue("X-Content-Type-Options"), "nosniff");
  assert.equal(headerValue("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(headerValue("X-Permitted-Cross-Domain-Policies"), "none");
});

test("framing is refused by both the modern and the legacy mechanism", () => {
  // They must agree. A `frame-ancestors` that permitted framing while
  // `X-Frame-Options` denied it would mean the answer depends on the browser.
  assert.equal(headerValue("X-Frame-Options"), "DENY");
  assert.equal(directive("frame-ancestors"), "'none'");
});

test("the policy has exactly one author", () => {
  // A second, static copy in the header list would mean every response carried
  // two policies and had to satisfy both — a very quiet way to break a page.
  assert.equal(headerValue("Content-Security-Policy"), null);
  assert.match(proxySource, /response\.headers\.set\(headerName, policy\)/);
});

test("cross-origin isolation keeps the OAuth window usable", () => {
  // Strict `same-origin` severs the opener a popup sign-in depends on. This is
  // the value that isolates the window without taking that away.
  assert.equal(headerValue("Cross-Origin-Opener-Policy"), "same-origin-allow-popups");
  assert.equal(headerValue("Cross-Origin-Resource-Policy"), "same-origin");
});

test("permissions are denied by default rather than listed permissively", () => {
  const value = headerValue("Permissions-Policy") ?? "";

  for (const feature of ["camera", "microphone", "geolocation", "payment"]) {
    assert.match(value, new RegExp(`${feature}=\\(\\)`), `${feature} is not denied`);
  }
});

test("HSTS ships only where TLS is actually terminated", () => {
  // A max-age of two years sent from a development origin is a way to lock
  // somebody out of their own localhost. It is gated on the strict production
  // environment, and that gate reads server-side configuration only.
  assert.match(
    config,
    /isStrictProductionEnv\(\)\s*\n?\s*\?\s*\[\{\s*key:\s*"Strict-Transport-Security"/
  );
  // The predicate is shared with runtime trusted-media classification. Keeping
  // a second inline implementation here could make a build allow one origin
  // while the profile page classifies another.
  assert.match(
    config,
    /const isStrictProductionEnv = \(\) => isStrictProductionEnvironment\(process\.env\)/
  );
  assert.match(trustedMediaSource, /export function isStrictProductionEnvironment/);
  assert.doesNotMatch(
    config,
    /Strict-Transport-Security[\s\S]{0,200}NEXT_PUBLIC_/,
    "HSTS must not be decided by a client-visible variable"
  );
});

test("no header value is built by splicing an environment variable", () => {
  // A configured origin concatenated into a policy is a header-injection
  // primitive: one stray semicolon or newline rewrites the directive list.
  const headerBlock = config.slice(config.indexOf("async headers()"));
  assert.doesNotMatch(headerBlock, /value:\s*`[^`]*\$\{/);
  assert.doesNotMatch(
    proxySource,
    /policy\s*=\s*`/,
    "the policy must come from the builder, not from a template literal"
  );
});

test("script execution is authorized per request, not by category", () => {
  const value = directive("script-src");

  assert.match(value, /'nonce-AbCdEfGhIjKlMnOpQrStUv=='/);
  assert.match(value, /'strict-dynamic'/);
  // The whole point. `'unsafe-inline'` in `script-src` means the policy does not
  // defend against script injection at all, and no violation would ever be
  // reported to say so.
  assert.doesNotMatch(value, /'unsafe-inline'/);
  assert.doesNotMatch(value, /'unsafe-eval'/);
  assert.doesNotMatch(value, /\*/);
  assert.doesNotMatch(value, /(^|\s)https?:(\s|$)/);
});

test("the development script allowance cannot reach a production build", () => {
  // The dev server compiles through `eval`; a production build does not.
  assert.match(directive("script-src", policy({ environment: "development" })), /'unsafe-eval'/);
  assert.doesNotMatch(directive("script-src"), /'unsafe-eval'/);
});

test("a style exception is not a script exception", () => {
  const value = directive("style-src");

  // A nonce cannot authorize a `style` attribute, only a `<style>` element, and
  // this codebase sets `style={{…}}` throughout. The alternative to this
  // exception is no style policy at all, not a stricter one.
  assert.match(value, /'unsafe-inline'/);
  // And a nonce here would *disable* that allowance, silently.
  assert.doesNotMatch(value, /'nonce-/);
  assert.doesNotMatch(value, /\*/);
});

test("broad image permission stays inside img-src", () => {
  // Creators link work from wherever it lives, so a host list cannot exist here.
  // Images cannot execute; the point is that this permission goes no further.
  assert.match(directive("img-src"), /https:/);

  for (const name of ["script-src", "connect-src", "frame-src", "default-src", "font-src", "object-src"]) {
    assert.doesNotMatch(
      directive(name) ?? "",
      /(^|\s)https?:(\s|$)/,
      `${name} must not inherit the image allowance`
    );
  }
});

test("nothing may be framed, and nothing may frame us", () => {
  // Two different questions. `frame-src` is what CreatorJobs may embed — nothing
  // today, because portfolio video is linked and thumbnailed, never framed.
  assert.equal(directive("frame-src"), "'none'");
  assert.equal(directive("frame-ancestors"), "'none'");
});

test("the strong defaults are stated rather than inherited", () => {
  assert.equal(directive("default-src"), "'self'");
  assert.equal(directive("object-src"), "'none'");
  assert.equal(directive("base-uri"), "'self'");
  // Sign-in navigates rather than submitting a form, so no provider origin
  // belongs here.
  assert.equal(directive("form-action"), "'self'");
  assert.equal(directive("font-src"), "'self'");
});

test("no font, CDN or analytics origin is authorized anywhere", () => {
  const value = policy();

  for (const host of [
    "fonts.googleapis.com",
    "fonts.gstatic.com",
    "googletagmanager.com",
    "google-analytics.com",
    "cdn.jsdelivr.net",
    "unpkg.com",
    "accounts.google.com",
    "maps.googleapis.com",
  ]) {
    assert.doesNotMatch(value, new RegExp(host.replace(/\./g, "\\.")), `${host} is authorized`);
  }
});

test("the backend origin reaches connect-src through a parser", () => {
  const value = directive(
    "connect-src",
    policy({ backendUrl: "https://api.creatorjobs.example/api/v1" })
  );

  assert.match(value, /'self'/);
  assert.match(value, /https:\/\/api\.creatorjobs\.example(\s|$)/);
  // `lib/realtimeMessaging.ts` swaps the scheme of this same origin to open its
  // socket, so the policy derives the socket origin the same way.
  assert.match(value, /wss:\/\/api\.creatorjobs\.example(\s|$)/);
  // The path is configuration, not an origin, and must not survive.
  assert.doesNotMatch(value, /api\/v1/);
});

test("the loopback rewrite the client performs is reflected in the policy", () => {
  // `lib/backendClient.ts` pins a `localhost` backend to 127.0.0.1 before the
  // browser connects, so the policy has to name the origin actually opened.
  const value = directive("connect-src", policy({ backendUrl: "http://localhost:8000/api/v1" }));

  assert.match(value, /http:\/\/127\.0\.0\.1:8000(\s|$)/);
  assert.match(value, /ws:\/\/127\.0\.0\.1:8000(\s|$)/);
});

test("configuration that is not an origin becomes nothing at all", () => {
  for (const configured of [
    "https://api.example.com; script-src *",
    "https://api.example.com\nX-Evil: yes",
    "https://api.example.com\r\nX-Evil: yes",
    "https://api.example.com\tevil",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "not a url",
    "https://user:pass@example.com",
    "//evil.example",
    "",
    "   ",
    null,
    undefined,
  ]) {
    assert.deepEqual(
      backendConnectSources(configured),
      [],
      `${JSON.stringify(configured)} produced a policy source`
    );
  }
});

test("a rejected backend origin fails closed rather than open", () => {
  // Losing `connect-src` breaks the application loudly. Widening it would not.
  const value = directive("connect-src", policy({ backendUrl: "https://api.example.com; script-src *" }));

  assert.equal(value, "'self'");
});

test("a nonce the module could not have produced is refused", () => {
  for (const nonce of [
    "short",
    "has spaces in it aaaaaaaa",
    "'; script-src *; x='aaaaaaaaaaaaaaaa",
    "AbCdEfGhIjKlMnOpQrStUv==\nX-Evil: 1",
    "",
  ]) {
    assert.throws(
      () => buildContentSecurityPolicy({ nonce, environment: "production", backendUrl: null }),
      /unrecognized nonce/,
      `${JSON.stringify(nonce)} was accepted`
    );
  }
});

test("production can never ship a report-only policy", () => {
  // Report-only is a step during a change, never a destination, and it is
  // unreachable in production by construction rather than by remembering.
  assert.equal(
    contentSecurityPolicyHeaderName({ strictProduction: true, reportOnlyRequested: true }),
    CSP_ENFORCE_HEADER
  );
  assert.equal(
    contentSecurityPolicyHeaderName({ strictProduction: false, reportOnlyRequested: true }),
    CSP_REPORT_ONLY_HEADER
  );
  assert.equal(
    contentSecurityPolicyHeaderName({ strictProduction: false, reportOnlyRequested: false }),
    CSP_ENFORCE_HEADER
  );
});

test("the nonce is server-owned and never read from the request", () => {
  // A client that supplied its own nonce would be choosing the value that
  // authorizes inline script on its own page.
  assert.match(proxySource, /crypto\.getRandomValues/);
  assert.match(proxySource, /requestHeaders\.set\(CSP_NONCE_HEADER, nonce\)/);
  assert.match(proxySource, /requestHeaders\.set\("content-security-policy", policy\)/);
  assert.doesNotMatch(proxySource, /request\.headers\.get\((?:"|')(?:x-nonce|content-security-policy)/i);
});

test("report-only is decided server-side", () => {
  assert.doesNotMatch(
    proxySource,
    /reportOnlyRequested:[^\n]*NEXT_PUBLIC_/,
    "report-only must not be decided by a client-visible variable"
  );
});
