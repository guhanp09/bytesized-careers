import test from "node:test";
import assert from "node:assert/strict";

import { getActivitySummary } from "../lib/backendClient.ts";
import { mergeOwnerInteractionPages } from "../lib/ownerInteractions.ts";

const interaction = (id, updatedAt, marker = id) => ({
  id,
  createdAt: updatedAt,
  updatedAt,
  marker,
});

test("activity pages append in timeline order and a repeated anchor cannot overwrite local state", () => {
  const tied = "2026-08-20T12:00:00.000Z";
  const existingAnchor = interaction("anchor", "2026-08-01T12:00:00.000Z", "kept");
  const merged = mergeOwnerInteractionPages(
    [interaction("newest", "2026-08-21T12:00:00.000Z"), interaction("tie-a", tied), existingAnchor],
    [interaction("tie-b", tied), interaction("older", "2026-08-10T12:00:00.000Z"), interaction("anchor", "2026-08-01T12:00:00.000Z", "overwritten")]
  );

  assert.deepEqual(
    merged.map((item) => item.id),
    ["newest", "tie-a", "tie-b", "older", "anchor"]
  );
  assert.equal(merged.find((item) => item.id === "anchor")?.marker, "kept");
});

test("activity client sends the scoped cursor contract and maps exact page metadata", async () => {
  const previousFetch = globalThis.fetch;
  const previousBase = process.env.NEXT_PUBLIC_BACKEND_URL;
  let requestedUrl = "";
  let authorization = "";
  process.env.NEXT_PUBLIC_BACKEND_URL = "https://backend.example.test/api/v1";
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(
      JSON.stringify({
        my_jobs: [],
        my_talent_listings: [],
        sent_applications: [],
        received_applications: [],
        received_interests: [],
        sent_interests: [],
        related_jobs: [],
        related_talent_listings: [],
        page: {
          mode: "talent",
          limit: 100,
          returned: 0,
          total: 137,
          has_more: true,
          next_cursor: "next_cursor",
          snapshot_at: "2026-08-21T10:00:00Z",
          counts: {
            sent_applications: 91,
            received_applications: 7,
            sent_interests: 11,
            received_interests: 46,
          },
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const summary = await getActivitySummary("access-token", {
      mode: "talent",
      limit: 100,
      cursor: "cursor_with-safe/chars",
      include: "00000000-0000-4000-8000-000000000001",
    });
    const url = new URL(requestedUrl);
    assert.equal(url.origin, "https://backend.example.test");
    assert.equal(url.pathname, "/api/v1/me/activity/summary");
    assert.equal(url.searchParams.get("mode"), "talent");
    assert.equal(url.searchParams.get("limit"), "100");
    assert.equal(url.searchParams.get("cursor"), "cursor_with-safe/chars");
    assert.equal(url.searchParams.get("include"), "00000000-0000-4000-8000-000000000001");
    assert.equal(authorization, "Bearer access-token");
    assert.deepEqual(summary.page, {
      mode: "talent",
      limit: 100,
      returned: 0,
      total: 137,
      hasMore: true,
      nextCursor: "next_cursor",
      snapshotAt: "2026-08-21T10:00:00Z",
      counts: {
        sentApplications: 91,
        receivedApplications: 7,
        sentInterests: 11,
        receivedInterests: 46,
      },
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBase === undefined) delete process.env.NEXT_PUBLIC_BACKEND_URL;
    else process.env.NEXT_PUBLIC_BACKEND_URL = previousBase;
  }
});

test("activity client remains compatible with the pre-pagination backend during rollout", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        my_jobs: [],
        my_talent_listings: [],
        sent_applications: [{ id: "sent-app" }],
        received_applications: [{ id: "received-app" }],
        received_interests: [{ id: "received-interest" }],
        sent_interests: [{ id: "sent-interest" }],
        related_jobs: [],
        related_talent_listings: [],
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  try {
    const summary = await getActivitySummary("access-token", { mode: "hiring" });
    assert.equal(summary.page.mode, "hiring");
    assert.equal(summary.page.returned, 4);
    assert.equal(summary.page.total, 4);
    assert.equal(summary.page.hasMore, false);
    assert.equal(summary.page.nextCursor, null);
    assert.deepEqual(summary.page.counts, {
      sentApplications: 1,
      receivedApplications: 1,
      sentInterests: 1,
      receivedInterests: 1,
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
});
