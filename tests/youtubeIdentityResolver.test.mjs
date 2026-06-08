import test from "node:test";
import assert from "node:assert/strict";

import {
  clearYouTubeIdentityCacheForTests,
  parseYouTubeUrl,
  resolveYouTubeChannelIdentity,
} from "../lib/youtubeIdentity.ts";

const jsonResponse = (body) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const channelItem = (overrides = {}) => ({
  id: "UCxxxx",
  snippet: {
    title: "Marques Brownlee",
    customUrl: "@mkbhd",
    thumbnails: {
      default: { url: "https://yt3.ggpht.com/default.jpg" },
      medium: { url: "https://yt3.ggpht.com/medium.jpg" },
      high: { url: "https://yt3.ggpht.com/high.jpg" },
    },
    ...overrides,
  },
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
  assert.deepEqual(parseYouTubeUrl("https://youtu.be/abc123"), {
    type: "video",
    videoId: "abc123",
    normalizedUrl: "https://youtu.be/abc123",
  });
});

test("rejects non-YouTube URLs", () => {
  assert.equal(parseYouTubeUrl("https://example.com/@mkbhd").type, "invalid");
});

test("resolves YouTube channel identity from mocked channels API", async () => {
  clearYouTubeIdentityCacheForTests();
  const requestedUrls = [];
  const fetcher = async (input) => {
    requestedUrls.push(String(input));
    return jsonResponse({ items: [channelItem()] });
  };

  const result = await resolveYouTubeChannelIdentity("https://www.youtube.com/@mkbhd", {
    apiKey: "test-key",
    fetcher,
  });

  assert.equal(result?.platform, "YouTube");
  assert.equal(result?.name, "Marques Brownlee");
  assert.equal(result?.logoUrl, "https://yt3.ggpht.com/high.jpg");
  assert.equal(result?.externalId, "UCxxxx");
  assert.equal(result?.canonicalUrl, "https://www.youtube.com/channel/UCxxxx");
  assert.equal(result?.handle, "@mkbhd");
  assert.equal(result?.confidence, "high");
  assert.equal(result?.source, "youtube_data_api");
  assert.match(requestedUrls[0], /forHandle=%40mkbhd/);
});

test("falls back without API key and does not fetch", async () => {
  clearYouTubeIdentityCacheForTests();
  let fetchCount = 0;
  const result = await resolveYouTubeChannelIdentity("https://www.youtube.com/@mkbhd", {
    apiKey: "",
    fetcher: async () => {
      fetchCount += 1;
      return jsonResponse({ items: [] });
    },
  });

  assert.equal(fetchCount, 0);
  assert.equal(result?.name, "@mkbhd");
  assert.equal(result?.logoUrl, null);
  assert.equal(result?.source, "url_fallback");
});

test("falls back when channels API returns no items", async () => {
  clearYouTubeIdentityCacheForTests();
  const result = await resolveYouTubeChannelIdentity("https://www.youtube.com/@mkbhd", {
    apiKey: "test-key",
    fetcher: async () => jsonResponse({ items: [] }),
  });

  assert.equal(result?.name, "@mkbhd");
  assert.equal(result?.logoUrl, null);
  assert.equal(result?.confidence, "low");
  assert.equal(result?.source, "url_fallback");
});

test("uses medium thumbnail when high thumbnail is absent", async () => {
  clearYouTubeIdentityCacheForTests();
  const result = await resolveYouTubeChannelIdentity("https://www.youtube.com/@mkbhd", {
    apiKey: "test-key",
    fetcher: async () =>
      jsonResponse({
        items: [
          channelItem({
            thumbnails: {
              default: { url: "https://yt3.ggpht.com/default.jpg" },
              medium: { url: "https://yt3.ggpht.com/medium.jpg" },
            },
          }),
        ],
      }),
  });

  assert.equal(result?.logoUrl, "https://yt3.ggpht.com/medium.jpg");
});

test("returns null logo when channel has no thumbnails", async () => {
  clearYouTubeIdentityCacheForTests();
  const result = await resolveYouTubeChannelIdentity("https://www.youtube.com/@mkbhd", {
    apiKey: "test-key",
    fetcher: async () =>
      jsonResponse({
        items: [channelItem({ thumbnails: {} })],
      }),
  });

  assert.equal(result?.name, "Marques Brownlee");
  assert.equal(result?.logoUrl, null);
});
