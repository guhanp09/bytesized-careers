import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTimestampedVideoUrl,
  normalizeReferenceTimestampInput,
  normalizeReferenceVideo,
  parseReferenceTimestamp,
} from "../lib/referenceVideos.ts";
import { JOBS } from "../lib/jobs.ts";

test("parseReferenceTimestamp accepts common timestamp formats", () => {
  assert.equal(parseReferenceTimestamp("0:00"), 0);
  assert.equal(parseReferenceTimestamp("0:12"), 12);
  assert.equal(parseReferenceTimestamp("1:08"), 68);
  assert.equal(parseReferenceTimestamp("12:35"), 755);
  assert.equal(parseReferenceTimestamp("1:02:03"), 3723);
  assert.equal(parseReferenceTimestamp("33"), 1980);
});

test("normalizeReferenceTimestampInput cleans timestamp display values", () => {
  assert.deepEqual(normalizeReferenceTimestampInput("4:4"), { time: "4:04", seconds: 244 });
  assert.deepEqual(normalizeReferenceTimestampInput("04:04"), { time: "4:04", seconds: 244 });
  assert.deepEqual(normalizeReferenceTimestampInput("1:2:3"), { time: "1:02:03", seconds: 3723 });
  assert.deepEqual(normalizeReferenceTimestampInput("01:02:03"), { time: "1:02:03", seconds: 3723 });
  assert.deepEqual(normalizeReferenceTimestampInput("0:7"), { time: "0:07", seconds: 7 });
  assert.deepEqual(normalizeReferenceTimestampInput("0033"), { time: "33:00", seconds: 1980 });
});

test("parseReferenceTimestamp rejects invalid timestamp formats", () => {
  assert.equal(parseReferenceTimestamp(""), null);
  assert.equal(parseReferenceTimestamp("abc"), null);
  assert.equal(parseReferenceTimestamp("1::2"), null);
  assert.equal(parseReferenceTimestamp("1:99"), null);
  assert.equal(parseReferenceTimestamp("1:02:99"), null);
  assert.equal(parseReferenceTimestamp("1.5"), null);
  assert.equal(parseReferenceTimestamp("1:2:3:4"), null);
  assert.equal(parseReferenceTimestamp("hello 0:12"), null);
  assert.equal(parseReferenceTimestamp("-1"), null);
});

test("buildTimestampedVideoUrl updates YouTube timestamp parameters", () => {
  assert.equal(
    buildTimestampedVideoUrl("https://www.youtube.com/watch?v=abc123", 12),
    "https://www.youtube.com/watch?v=abc123&t=12s"
  );
  assert.equal(
    buildTimestampedVideoUrl("https://youtu.be/abc123?feature=share&t=1s", 68),
    "https://youtu.be/abc123?feature=share&t=68s"
  );
});

test("buildTimestampedVideoUrl falls back for unsupported URLs", () => {
  assert.equal(
    buildTimestampedVideoUrl("https://example.com/video", 12),
    "https://example.com/video"
  );
});

test("normalizeReferenceVideo preserves rich reference notes and old payload compatibility", () => {
  assert.deepEqual(normalizeReferenceVideo("https://youtu.be/basic"), { url: "https://youtu.be/basic" });

  const rich = normalizeReferenceVideo({
    title: "  Pacing reference  ",
    url: "https://www.youtube.com/watch?v=abc123",
    what_to_reference: " Study the intro hook. ",
    timestamp_notes: [
      { time: "0:12", title: " Hook ", description: " Fast start. " },
      { time: "1:99", title: "Bad", description: "Invalid" },
    ],
  });

  assert.equal(rich?.title, "Pacing reference");
  assert.equal(rich?.whatToReference, "Study the intro hook.");
  assert.equal(rich?.timestampNotes?.length, 1);
  assert.equal(rich?.timestampNotes?.[0]?.seconds, 12);
  assert.equal(rich?.timestampNotes?.[0]?.time, "0:12");
  assert.equal(rich?.timestampNotes?.[0]?.title, "Hook");
});

test("mock jobs enrich every reference video with reusable popover details", () => {
  const jobsWithReferences = JOBS.filter((job) => (job.referenceVideos || []).length > 0);
  assert.ok(jobsWithReferences.length > 3);

  for (const job of jobsWithReferences) {
    for (const video of job.referenceVideos || []) {
      assert.ok(video.title?.trim(), `${job.id} reference video should have a title`);
      assert.ok(video.whatToReference?.trim(), `${job.id} ${video.title} should have what-to-reference copy`);
      assert.ok((video.timestampNotes || []).length >= 3, `${job.id} ${video.title} should have timestamp notes`);
      for (const note of video.timestampNotes || []) {
        assert.ok(Number.isFinite(note.seconds), `${job.id} ${video.title} note should have seconds`);
        assert.ok(note.title.trim(), `${job.id} ${video.title} note should have a title`);
      }
    }
  }
});
