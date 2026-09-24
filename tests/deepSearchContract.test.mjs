import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { parseQuery } from "../lib/search/queryParser.ts";
import { rankJobs, rankTalent } from "../lib/search/ranking.ts";


const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("live Jobs and Talent pages use the repository-owned deep-search API", () => {
  const client = read("lib/backendClient.ts");
  assert.match(client, /export async function deepSearchJobs/);
  assert.match(client, /\/search\/jobs/);
  assert.match(client, /export async function deepSearchTalent/);
  assert.match(client, /\/search\/talent/);
  assert.match(read("app/jobs/page.tsx"), /deepSearchJobs/);
  assert.match(read("app/talent/page.tsx"), /deepSearchTalent/);
});

test("search explanation UI preserves a query while switching result domains", () => {
  const summary = read("components/search/SearchSummary.tsx");
  assert.match(summary, /encodeURIComponent\(intent\.query\)/);
  assert.match(summary, /aria-label="Search results type"/);
  assert.match(summary, /Clear search/);
  assert.equal((summary.match(/prefetch=\{false\}/g) || []).length, 3);
  assert.match(summary, /youtube: "YouTube"/);
  assert.match(summary, /Why this result matched|Recognized search criteria/);
  assert.match(read("components/JobCard.tsx"), /SearchMatchReasons/);
  assert.match(read("components/TalentCard.tsx"), /SearchMatchReasons/);
});

test("historical job languages are not an active ranking signal", () => {
  const query = parseQuery("Tamil video editor");
  const results = rankJobs(
    [
      {
        id: "newer-no-language",
        title: "Video editor",
        primaryRoleName: "Video Editor",
        languages: [],
        createdAt: "2026-07-30",
      },
      {
        id: "older-tamil",
        title: "Video editor",
        primaryRoleName: "Video Editor",
        languages: ["Tamil"],
        languageRequirements: [
          { language: "Tamil", priority: "required" },
        ],
        createdAt: "2026-07-01",
      },
    ],
    query,
  );
  assert.equal(results[0].item.id, "newer-no-language");
});

test("public talent language data can satisfy free-text without becoming a job requirement", () => {
  const results = rankTalent(
    [
      {
        id: "tamil",
        title: "Creator strategist",
        primary_role: "Content Strategist",
        languages: ["Tamil"],
        location: "Chennai",
        created_at: "2026-07-01",
      },
      {
        id: "other",
        title: "Creator strategist",
        primary_role: "Content Strategist",
        languages: ["English"],
        location: "Chennai",
        created_at: "2026-07-30",
      },
    ],
    parseQuery("Tamil creator strategist Chennai"),
  );
  assert.equal(results[0].item.id, "tamil");
});

test("deep search backend reads only authoritative public record types", () => {
  const repository = read("backend/app/repositories/search_repository.py");
  const visibility = read("backend/app/repositories/public_visibility.py");
  const accountState = read("backend/app/core/account_state.py");
  // Public eligibility moved to one shared policy in R1A. Verify both the
  // repository's use of it and its unchanged publication/stronger account rules.
  assert.match(repository, /\.where\(\*public_job_predicates\(\)\)/);
  assert.match(repository, /\.where\(\*public_talent_predicates\(\)\)/);
  assert.match(visibility, /Job\.status == "published"/);
  assert.match(visibility, /TalentListing\.status\.in_\(\("published", "featured"\)\)/);
  assert.match(visibility, /active_account_clause\(User\)/);
  assert.match(accountState, /user_model\.suspended_at\.is_\(None\)/);
  assert.match(accountState, /user_model\.deletion_hidden_at\.is_\(None\)/);
  assert.doesNotMatch(repository, /JobImport|Message|Screening|Application/);

  const serializer = read("backend/app/services/public_listing_serializer.py");
  assert.match(serializer, /screening_questions = None/);
  assert.match(serializer, /language_requirements = None/);
});
