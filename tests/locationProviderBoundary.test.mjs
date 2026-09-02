import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { BackendRequestError, requestJson } from "../lib/backendClient.ts";

const read = (path) => readFileSync(path, "utf8");

test("location provider execution lives only behind the authenticated backend boundary", () => {
  const autocomplete = read("app/api/location/autocomplete/route.ts");
  const details = read("app/api/location/details/route.ts");
  const nextRoutes = `${autocomplete}\n${details}`;
  const backend = read("backend/app/services/google_places_service.py");

  for (const source of [autocomplete, details]) {
    assert.match(source, /getServerSession\(authOptions\)/);
    assert.match(source, /session\.backendAccessToken/);
    assert.match(source, /sec-fetch-site/);
    assert.match(source, /origin_rejected/);
    assert.match(source, /Cache-Control", "no-store/);
  }
  assert.match(autocomplete, /searchMyLocationSuggestions/);
  assert.match(details, /readMyLocationDetails/);
  assert.doesNotMatch(nextRoutes, /maps\.googleapis\.com/);
  assert.doesNotMatch(nextRoutes, /GOOGLE_PLACES_API_KEY/);
  assert.doesNotMatch(nextRoutes, /response\.json\(\).*Google/);

  assert.match(backend, /follow_redirects=False/);
  assert.match(backend, /trust_env=False/);
  assert.match(backend, /asyncio\.timeout/);
  assert.match(backend, /MAX_PROVIDER_RESPONSE_BYTES/);
  assert.match(backend, /aiter_bytes\(\)/);
  assert.match(backend, /destination=<fixed>/);
});

test("the server credential and distributed user quota have one owner", () => {
  const frontendEnv = read(".env.example");
  const backendEnv = read("backend/.env.example");
  const backendConfig = read("backend/app/core/config.py");
  const routes = read("backend/app/api/v1/routers/locations.py");
  const limits = read("backend/app/core/rate_limit.py");

  assert.doesNotMatch(frontendEnv, /GOOGLE_PLACES_API_KEY/);
  assert.match(backendEnv, /GOOGLE_PLACES_API_KEY=/);
  assert.match(backendConfig, /google_places_api_key: SecretStr/);
  assert.match(routes, /authenticated_rate_limit\(LOCATION_LOOKUP_LIMIT\)/);
  assert.match(limits, /LOCATION_LOOKUP_LIMIT = RateLimitRule/);
});

test("Google Maps attribution is source-specific, visible, and not translated", () => {
  const component = read("components/you/LocationAutocompleteField.tsx");
  const types = read("lib/locationTypes.ts");
  const autocomplete = read("app/api/location/autocomplete/route.ts");

  assert.match(types, /attribution\?: "google_maps"/);
  assert.match(autocomplete, /result\.attribution === "google_maps"/);
  assert.match(component, /attribution === "google_maps" && suggestions\.length/);
  assert.match(component, /aria-label="Google Maps attribution"/);
  assert.match(component, /<span translate="no">Google Maps<\/span>/);
  assert.match(component, /overflow-hidden/);
  assert.match(component, /max-h-56 overflow-y-auto/);
});

test("location errors preserve bounded retry guidance without exposing backend detail", () => {
  const client = read("lib/backendClient.ts");
  const autocomplete = read("app/api/location/autocomplete/route.ts");
  const details = read("app/api/location/details/route.ts");

  assert.match(client, /retryAfterSeconds\?: number/);
  assert.match(client, /response\.headers\.get\("Retry-After"\)/);
  assert.match(autocomplete, /error\.retryAfterSeconds/);
  assert.match(details, /error\.retryAfterSeconds/);
  assert.match(autocomplete, /Too many location searches/);
  assert.match(details, /Too many location searches/);
});

test("the shared backend client retains only a safe numeric Retry-After value", async () => {
  const previousFetch = globalThis.fetch;
  const previousBase = process.env.NEXT_PUBLIC_BACKEND_URL;
  process.env.NEXT_PUBLIC_BACKEND_URL = "https://backend.example.test/api/v1";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        detail: { code: "quota_exceeded", message: "backend-only wording" },
      }),
      {
        status: 429,
        headers: { "Content-Type": "application/json", "Retry-After": "37" },
      }
    );

  try {
    await assert.rejects(
      () => requestJson("/me/location/autocomplete?q=Chennai", { accessToken: "token" }),
      (error) => {
        assert.ok(error instanceof BackendRequestError);
        assert.equal(error.status, 429);
        assert.equal(error.code, "quota_exceeded");
        assert.equal(error.retryAfterSeconds, 37);
        return true;
      }
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBase === undefined) delete process.env.NEXT_PUBLIC_BACKEND_URL;
    else process.env.NEXT_PUBLIC_BACKEND_URL = previousBase;
  }
});
