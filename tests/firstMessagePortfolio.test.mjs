import test from "node:test";
import assert from "node:assert/strict";

import {
  toPortfolioOption,
  toPortfolioOptions,
} from "../lib/firstMessagePortfolio.ts";

// Adding a portfolio item from inside the job-application popup runs the REAL project
// builder in-flow (PortfolioProjectWorkspace `embedded` mode), which persists a profile
// project and hands the created backend item back. These helpers turn that item into a
// selectable picker option and gate which items a recruiter could actually see.

function makeItem(overrides = {}) {
  return {
    id: "proj-1",
    user_id: "u1",
    title: "My finance explainer",
    source_url: "https://youtube.com/watch?v=abc",
    thumbnail_url: "https://img/thumb.jpg",
    role_name: "Editor",
    links: ["https://youtube.com/watch?v=abc"],
    tags: [],
    tools: [],
    status: "now",
    is_public: true,
    publish_status: "published",
    created_at: "2026-01-02",
    updated_at: "2026-01-02",
    ...overrides,
  };
}

test("toPortfolioOption surfaces a created item as a selectable picker option", () => {
  const option = toPortfolioOption(makeItem());
  assert.equal(option.id, "proj-1");
  assert.equal(option.title, "My finance explainer");
  assert.equal(option.url, "https://youtube.com/watch?v=abc");
  assert.equal(option.thumbnailUrl, "https://img/thumb.jpg");
  assert.equal(option.subtitle, "Editor");
});

test("a builder-created project carries an external URL so the recruiter can open it", () => {
  // The attached project rides along the application as a `relevant_portfolio` answer
  // whose `url` is this link — viewable by the recipient even before any in-app profile
  // lookup. Falls back through source_url -> youtube_url -> media_url -> links[0].
  const option = toPortfolioOption(
    makeItem({ source_url: "", youtube_url: "", media_url: "", links: ["https://behance.net/gallery/1"] })
  );
  assert.equal(option.url, "https://behance.net/gallery/1");
});

test("toPortfolioOptions exposes published public items and hides drafts/private", () => {
  // Part 4 visibility contract: a *published, public* project is a real profile item the
  // recruiter can also browse in-app; drafts and private items stay out of the picker.
  const options = toPortfolioOptions([
    makeItem({ id: "published", publish_status: "published", is_public: true }),
    makeItem({ id: "draft", publish_status: "draft", is_public: true }),
    makeItem({ id: "private", publish_status: "published", is_public: false }),
  ]);
  assert.deepEqual(options.map((o) => o.id), ["published"]);
});
