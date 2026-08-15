/**
 * The response headers every CreatorJobs page carries.
 *
 * These are asserted against the configuration rather than a running server so
 * the contract is checked on every unit run, including in environments where a
 * production build is not available. A browser check that the policy does not
 * break sign-in or embeds is a separate obligation and belongs with the slice
 * that ships a full `script-src`.
 *
 * The rules below are the ones a future edit could plausibly get wrong: a
 * wildcard that makes a directive meaningless, an environment value spliced
 * into a header, or a production-only header quietly becoming unconditional.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");

const headerValue = (key) => {
  const pattern = new RegExp(
    `key:\\s*"${key}"\\s*,?\\s*\\n?\\s*value:\\s*"([^"]*)"`,
    "s"
  );
  return config.match(pattern)?.[1] ?? null;
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
  assert.match(headerValue("Content-Security-Policy") ?? "", /frame-ancestors 'none'/);
});

test("the content policy carries no wildcard source", () => {
  const csp = headerValue("Content-Security-Policy") ?? "";

  // A directive with `*`, bare `https:` or `http:` is a directive that is not
  // doing anything. If a future slice needs one, it needs a written reason.
  assert.doesNotMatch(csp, /\*/);
  assert.doesNotMatch(csp, /(^|[\s;])https?:(\s|;|$)/);
  assert.doesNotMatch(csp, /'unsafe-eval'/);
});

test("cross-origin isolation keeps the OAuth window usable", () => {
  // Strict `same-origin` severs the opener a popup sign-in depends on. This is
  // the value that isolates the window without taking that away.
  assert.equal(headerValue("Cross-Origin-Opener-Policy"), "same-origin-allow-popups");
  assert.equal(headerValue("Cross-Origin-Resource-Policy"), "same-origin");
});

test("permissions are denied by default rather than listed permissively", () => {
  const policy = headerValue("Permissions-Policy") ?? "";

  for (const feature of ["camera", "microphone", "geolocation", "payment"]) {
    assert.match(policy, new RegExp(`${feature}=\\(\\)`), `${feature} is not denied`);
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
  assert.match(config, /const isStrictProductionEnv = \(\) => \{/);
  assert.doesNotMatch(
    config,
    /Strict-Transport-Security[\s\S]{0,200}NEXT_PUBLIC_/,
    "HSTS must not be decided by a client-visible variable"
  );
});

test("no header value is built by splicing an environment variable", () => {
  // A configured origin concatenated into a policy is a header-injection
  // primitive: one stray semicolon or newline rewrites the directive list.
  // When a future slice needs the backend origin in `connect-src`, it must
  // parse and normalize it rather than interpolate it.
  const headerBlock = config.slice(config.indexOf("async headers()"));
  assert.doesNotMatch(headerBlock, /value:\s*`[^`]*\$\{/);
});
