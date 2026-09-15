import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

import {
  clearYouTubeIdentityCacheForTests,
  parseYouTubeUrl,
  resolveYouTubeChannelIdentity,
} from "../lib/youtubeIdentity.ts";

const providerIdentity = (overrides = {}) => ({
  platform: "YouTube",
  name: "Marques Brownlee",
  logoUrl: "https://yt3.ggpht.com/high.jpg",
  canonicalUrl: "https://www.youtube.com/channel/UC1234567890123456789012",
  externalId: "UC1234567890123456789012",
  handle: "@mkbhd",
  confidence: "high",
  source: "youtube_data_api",
  ...overrides,
});

test("YouTube provider credentials and network execution live only in the backend", () => {
  const sourceWithoutComments = (path) => ts.createPrinter({ removeComments: true }).printFile(
    ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true)
  );
  const envWithoutComments = (path) => readFileSync(path, "utf8").split("\n")
    .filter((line) => !line.trimStart().startsWith("#")).join("\n");
  const resolver = sourceWithoutComments("lib/youtubeIdentity.ts");
  const route = sourceWithoutComments("app/api/profile/organization-identity/route.ts");
  const frontendEnv = envWithoutComments(".env.example");
  const backendEnv = envWithoutComments("backend/.env.example");

  assert.doesNotMatch(resolver, /googleapis\.com|\bfetch\s*\(|apiKey/);
  assert.doesNotMatch(route, /YOUTUBE_(?:DATA_)?API_KEY|googleapis\.com/);
  assert.match(route, /resolveMyYouTubeIdentity\(accessToken, selector\)/);
  assert.doesNotMatch(frontendEnv, /YOUTUBE_(?:DATA_)?API_KEY/);
  assert.match(backendEnv, /YOUTUBE_API_KEY=/);
});

test("parses YouTube handle URLs", () => {
  assert.deepEqual(parseYouTubeUrl("https://www.youtube.com/@mkbhd"), {
    type: "handle",
    handle: "mkbhd",
    normalizedUrl: "https://www.youtube.com/@mkbhd",
  });
  assert.equal(parseYouTubeUrl("https://youtube.com/@mkbhd").type, "handle");
  assert.equal(parseYouTubeUrl("https://m.youtube.com/@mkbhd").type, "handle");
});

test("parses YouTube channel ID URLs", () => {
  assert.deepEqual(parseYouTubeUrl("https://www.youtube.com/channel/UC1234567890123456789012"), {
    type: "channelId",
    channelId: "UC1234567890123456789012",
    normalizedUrl: "https://www.youtube.com/channel/UC1234567890123456789012",
  });
});

test("parses legacy user, custom, and video URLs", () => {
  assert.deepEqual(parseYouTubeUrl("https://www.youtube.com/user/someuser"), {
    type: "username",
    username: "someuser",
    normalizedUrl: "https://www.youtube.com/user/someuser",
  });
  assert.deepEqual(parseYouTubeUrl("https://www.youtube.com/c/somecustomname"), {
    type: "customPath",
    path: "somecustomname",
    normalizedUrl: "https://www.youtube.com/c/somecustomname",
  });
  assert.deepEqual(parseYouTubeUrl("https://youtu.be/abc123DEF_-"), {
    type: "video",
    videoId: "abc123DEF_-",
    normalizedUrl: "https://youtu.be/abc123DEF_-",
  });
});

test("rejects non-YouTube URLs", () => {
  assert.equal(parseYouTubeUrl("https://example.com/@mkbhd").type, "invalid");
});

test("selects an authenticated backend handle lookup and returns its normalized identity", async () => {
  clearYouTubeIdentityCacheForTests();
  const requested = [];
  const result = await resolveYouTubeChannelIdentity("https://www.youtube.com/@mkbhd", {
    resolveProviderIdentity: async (selector) => {
      requested.push(selector);
      return providerIdentity();
    },
  });

  assert.deepEqual(requested, [{ selector: "handle", value: "mkbhd" }]);
  assert.deepEqual(result, providerIdentity());
});

test("falls back without a backend provider resolver", async () => {
  clearYouTubeIdentityCacheForTests();
  const warnings = [];
  const result = await resolveYouTubeChannelIdentity("https://www.youtube.com/@mkbhd", {
    warn: (message) => warnings.push(message),
  });

  assert.equal(result?.name, "@mkbhd");
  assert.equal(result?.logoUrl, null);
  assert.equal(result?.source, "url_fallback");
  assert.equal(warnings.length, 1);
});

test("falls back when the backend finds no provider identity", async () => {
  clearYouTubeIdentityCacheForTests();
  const result = await resolveYouTubeChannelIdentity("https://www.youtube.com/@mkbhd", {
    resolveProviderIdentity: async () => null,
  });

  assert.equal(result?.name, "@mkbhd");
  assert.equal(result?.logoUrl, null);
  assert.equal(result?.confidence, "low");
  assert.equal(result?.source, "url_fallback");
});

test("falls back when the authenticated backend lookup is unavailable", async () => {
  clearYouTubeIdentityCacheForTests();
  const result = await resolveYouTubeChannelIdentity("https://www.youtube.com/@mkbhd", {
    resolveProviderIdentity: async () => {
      throw new Error("backend unavailable");
    },
  });

  assert.equal(result?.source, "url_fallback");
});

test("a custom path asks the server for the channel id and never fetches the page", async () => {
  // `youtube.com/somebrand` is the one shape the Data API cannot look up
  // directly: the id lives in the page. Reading that page is a fetch of a URL a
  // user chose, so it belongs to the backend's pinned boundary — this runtime
  // only asks for the id.
  clearYouTubeIdentityCacheForTests();
  const requested = [];

  const result = await resolveYouTubeChannelIdentity("https://www.youtube.com/somebrand", {
    resolveChannelIdFromPage: async () => "UCabcdefghijklmnopqrstuv",
    resolveProviderIdentity: async (selector) => {
      requested.push(selector);
      return providerIdentity({
        name: "Some Brand",
        externalId: "UCabcdefghijklmnopqrstuv",
        canonicalUrl: "https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv",
        handle: "@somebrand",
      });
    },
  });

  assert.equal(result.externalId, "UCabcdefghijklmnopqrstuv");
  assert.equal(result.source, "youtube_data_api");
  assert.deepEqual(requested, [
    { selector: "channel_id", value: "UCabcdefghijklmnopqrstuv" },
  ]);
});

test("without a server-side resolver a custom path falls back instead of fetching", async () => {
  clearYouTubeIdentityCacheForTests();
  let providerCalls = 0;

  const result = await resolveYouTubeChannelIdentity("https://www.youtube.com/somebrand", {
    resolveProviderIdentity: async () => {
      providerCalls += 1;
      return providerIdentity();
    },
  });

  // Losing an enrichment is cheaper than keeping an unpinned fetch alive for it.
  assert.notEqual(result, null);
  assert.notEqual(result.source, "youtube_data_api");
  assert.equal(providerCalls, 0);
});
