import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/**
 * On macOS `localhost` resolves to ::1 first, while the dev backend binds
 * `--host 127.0.0.1` (IPv4 only). A browser calling `http://localhost:8000`
 * therefore gets connection refused while the backend is running perfectly —
 * the fetch throws before any HTTP, which surfaces as status 0 and the
 * misleading "make sure the backend is running" message.
 *
 * Binding uvicorn to `::` is not the fix: on macOS that binds IPv6 only and
 * breaks every IPv4 caller instead.
 */

// The regex both modules use, reproduced here so the behaviour is tested
// directly rather than only asserted to exist in source.
const preferIPv4Loopback = (url) =>
  url.replace(/^(https?:\/\/)localhost(?=[:/]|$)/i, "$1127.0.0.1");

test("the loopback name is rewritten to IPv4", () => {
  assert.equal(
    preferIPv4Loopback("http://localhost:8000/api/v1"),
    "http://127.0.0.1:8000/api/v1"
  );
  assert.equal(preferIPv4Loopback("http://localhost:8000"), "http://127.0.0.1:8000");
  assert.equal(preferIPv4Loopback("https://localhost/api/v1"), "https://127.0.0.1/api/v1");
  // Case is not meaningful in a hostname.
  assert.equal(preferIPv4Loopback("http://LOCALHOST:8000"), "http://127.0.0.1:8000");
});

test("an address that is already IPv4 is left alone", () => {
  const url = "http://127.0.0.1:8000/api/v1";
  assert.equal(preferIPv4Loopback(url), url);
});

test("real hostnames are never rewritten", () => {
  // The rule is about the loopback name only. A deployed host that merely
  // contains "localhost" as a substring must survive untouched.
  for (const url of [
    "https://api.creatorjobs.com/api/v1",
    "https://localhost.example.com/api/v1",
    "https://staging-localhost-proxy.internal/api/v1",
  ]) {
    assert.equal(preferIPv4Loopback(url), url, url);
  }
});

test("both backend entry points apply the rule", () => {
  // The browser path and the NextAuth server path each resolve their own base
  // URL; fixing one and not the other leaves sign-in broken.
  for (const path of ["lib/backendClient.ts", "lib/auth.ts"]) {
    const source = read(path);
    assert.match(source, /preferIPv4Loopback/, `${path} must normalise the host`);
    assert.match(
      source,
      /preferIPv4Loopback\(raw\)/,
      `${path} must apply it to the resolved URL`
    );
  }
});
