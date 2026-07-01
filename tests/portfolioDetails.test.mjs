import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPortfolioTimestampUrl,
  getPortfolioContextChips,
  getPortfolioHighlights,
  getPortfolioResults,
  getPortfolioTimestampNotes,
  getPortfolioWhatIDid,
  uniquePortfolioList,
} from "../lib/portfolioDetails.ts";

test("portfolio detail helpers normalize rich project fields", () => {
  const item = {
    title: "Finance explainer",
    what_i_did: "  Reworked the hook and pacing. ",
    contribution_highlights: ["Hook rewrite", "hook rewrite", "Packaging system"],
    timestamp_notes: [
      { time: "0:42", title: "Hook", description: "Changed the open." },
      { time: "broken", title: "Bad" },
    ],
    tools: ["Premiere Pro"],
    content_niches: ["Finance"],
    content_genres: ["Explainers"],
    platforms: ["YouTube"],
    formats: ["Shorts"],
    tags: ["Finance", "Retention"],
    results: ["12 Shorts created"],
    public_metrics: { views: 18000 },
    manual_metrics: { retention_percent: 44 },
  };

  assert.equal(getPortfolioWhatIDid(item), "Reworked the hook and pacing.");
  assert.deepEqual(getPortfolioHighlights(item), ["Hook rewrite", "Packaging system"]);
  assert.equal(getPortfolioTimestampNotes(item).length, 1);
  assert.equal(getPortfolioTimestampNotes(item)[0].seconds, 42);
  assert.deepEqual(getPortfolioContextChips(item), ["Finance", "Explainers", "YouTube", "Shorts", "Retention"]);
  assert.deepEqual(getPortfolioResults(item), ["12 Shorts created", "18K views", "Retention 44%"]);
});

test("portfolio detail helpers preserve old simple projects", () => {
  const item = {
    title: "Simple project",
    contribution_summary: "Edited a basic reel.",
    contribution_tags: ["Editing"],
    tags: [],
  };

  assert.equal(getPortfolioWhatIDid(item), "Edited a basic reel.");
  assert.deepEqual(getPortfolioHighlights(item), ["Editing"]);
  assert.deepEqual(getPortfolioTimestampNotes(item), []);
});

test("portfolio timestamp URLs reuse YouTube timestamp behavior", () => {
  assert.equal(
    buildPortfolioTimestampUrl("https://www.youtube.com/watch?v=abc123&list=demo", 42),
    "https://www.youtube.com/watch?v=abc123&list=demo&t=42s"
  );
  assert.equal(buildPortfolioTimestampUrl("https://example.com/work", 42), null);
});

test("unique portfolio list trims and de-dupes case-insensitively", () => {
  assert.deepEqual(uniquePortfolioList([" Finance ", "finance", "", "Education"], 4), ["Finance", "Education"]);
});
