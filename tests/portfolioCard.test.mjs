import test from "node:test";
import assert from "node:assert/strict";

import { portfolioSummaryPreview } from "../lib/portfolioCard.ts";

test("prefers the contribution summary (what I did)", () => {
  assert.equal(
    portfolioSummaryPreview({ contribution_summary: "Planned the structure.", description: "desc" }),
    "Planned the structure."
  );
});

test("falls back to the description when no contribution summary", () => {
  assert.equal(
    portfolioSummaryPreview({ contribution_summary: null, description: "A retention-first edit." }),
    "A retention-first edit."
  );
});

test("returns null when there is nothing meaningful to show", () => {
  assert.equal(portfolioSummaryPreview({ contribution_summary: null, description: null }), null);
  assert.equal(portfolioSummaryPreview({ contribution_summary: "   ", description: "" }), null);
  assert.equal(portfolioSummaryPreview({}), null);
});
