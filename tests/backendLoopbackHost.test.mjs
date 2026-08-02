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

// ---------------------------------------------------------------------------
// Client timeout budget
// ---------------------------------------------------------------------------

test("provider-bound import calls outlast the server's own budget", () => {
  const client = read("lib/jobImportReadiness.ts");

  // The default write budget is 8s. A real extraction can run to ~90s, because
  // the backend allows OPENAI_REQUEST_TIMEOUT_SECONDS (30s) with up to
  // OPENAI_MAX_RETRIES (2) retries. Aborting first cancels work the server is
  // still doing, and the abort is reported as "backend unreachable".
  const processing = Number(
    /JOB_IMPORT_PROCESSING_TIMEOUT_MS = ([\d_]+)/.exec(client)?.[1].replace(/_/g, "")
  );
  assert.ok(Number.isFinite(processing), "the processing budget must be declared");
  assert.ok(
    processing >= 90_000,
    `processing budget ${processing}ms must clear the server's ~90s worst case`
  );

  // And it must actually be applied to the call that waits for the provider.
  const processBlock = /processJobImportDraft[\s\S]*?\n}/.exec(client)?.[0] ?? "";
  assert.match(
    processBlock,
    /timeoutMs: JOB_IMPORT_PROCESSING_TIMEOUT_MS/,
    "the /process call must use the processing budget, not the 8s default"
  );
});

test("the slower import writes do not fall back to the 8s default", () => {
  const client = read("lib/jobImportReadiness.ts");
  for (const fn of ["applyJobImportDraft", "createDevelopmentJobImportFixture"]) {
    const block = new RegExp(`${fn}[\\s\\S]*?\\n}`).exec(client)?.[0] ?? "";
    assert.match(block, /timeoutMs:/, `${fn} must declare its own budget`);
  }
});

test("a client abort is reported as unreachable, which is why the budget matters", () => {
  const backend = read("lib/backendClient.ts");
  // An AbortError becomes BackendRequestError(0, ...), and status 0 is what
  // describeActionError turns into "make sure the backend is running" — advice
  // that is actively wrong when the real cause is the client giving up early.
  assert.match(backend, /AbortError/);
  assert.match(backend, /Request timed out after/);
  assert.match(backend, /isBackendUnreachableError\s*=\s*\(error: unknown\)\s*=>/);
});
