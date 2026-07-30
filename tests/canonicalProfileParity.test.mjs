import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  getCanonicalPublicProfile,
  resetCanonicalProfileCache,
} from "../lib/seed/canonicalProfile.ts";

/**
 * Backend/Mock parity for the *profile*, not the workspace.
 *
 * `scenarioParity.test.mjs` compares the two paths through the activity
 * serializer. That says nothing about the page a reviewer opens next: it is a
 * different endpoint over different columns, so the two paths could agree about
 * every application while showing two different people.
 *
 * The backend side here is a real restore read back through the production
 * public-profile service — every step the live app performs. The Mock side is
 * the canonical resolution of the same manifest. Both must describe one person.
 *
 * The dump is scratch output from
 * `backend/tests/test_creator_scenario_parity_dump.py`, deliberately not
 * committed; these skip when it is absent and the validation matrix runs pytest
 * first.
 */

const DUMP_DIR = path.join(process.cwd(), ".parity-dumps");
const SCENARIOS = ["default", "edge", "busy", "talent", "recruiter"];

const SKIP_HINT =
  "no profile dump — run: cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_creator_scenario_parity_dump.py";

function dumpFor(scenario) {
  const file = path.join(DUMP_DIR, `${scenario}.profiles.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Fields excluded from comparison, each with the reason it carries no product
 * meaning *on this path*. Nothing is excluded because it happened to differ.
 */
const ALLOWED_DIFFERENCES = {
  stats:
    "Counted from live rows the Mock path has no equivalent of (jobs posted, reviews); the manifest asserts no such history.",
  reviews: "Aggregated from review rows; a scenario seeds none, so both sides are empty by different routes.",
  review_items: "Individual review rows, of which a scenario seeds none on either path.",
  reviews_by_mode: "The same review rows split by side; empty on both paths for the same reason.",
  roles:
    "Catalogue rows on the backend (`UserRole` → `Role`), which restore does not create; the manifest carries role names only.",
  role_answers_summary: "Derived from role questionnaire answers, which a scenario does not seed.",
  jobs_active: "Served from Job rows joined by owner; the profile route is not where the manifest asserts job state.",
  jobs_past: "Closed Job rows joined by owner; the profile route is not where the manifest asserts job state.",
  jobs_preview: "A slice of the same Job rows, carrying nothing the manifest asserts about a profile.",
  talent_listings_active: "Listing rows, compared by the activity parity suite instead.",
  talent_listings_preview: "A slice of the same listing rows, already compared by the activity parity suite.",
  social_connections: "Requires linked OAuth channels; a scenario links none.",
  youtube_badge: "Rendered only for a linked YouTube channel, which no scenario account has.",
  represented_channels: "Hiring-identity rows, which restore does not create.",
  experience: "Profile experience entries, which the manifest does not carry.",
  avatar_mode: "Derived from whether a YouTube channel is linked; no scenario links one.",
  banner_url: "Not carried by the manifest; null on both sides for different reasons.",
  portfolio_past: "Every canonical item is current work; both sides are empty.",
  portfolio_preview: "A slice of portfolio_now, which is compared directly.",
  moved_to_username: "Set only by a username change, which a scenario never performs.",
};

/** The fields a reader actually looks at, and which must therefore agree. */
const COMPARED_SCALARS = [
  "username",
  "display_name",
  "headline",
  "bio",
  "location",
  "timezone",
  "availability_status",
];

const COMPARED_LISTS = ["skills", "public_links", "creator_platforms"];

function pairs(scenario) {
  const dump = dumpFor(scenario);
  if (!dump) return null;
  return Object.entries(dump.profiles);
}

test.beforeEach(() => resetCanonicalProfileCache());

test("both paths describe the same person", async (t) => {
  let compared = 0;
  for (const scenario of SCENARIOS) {
    const entries = pairs(scenario);
    if (!entries) return t.skip(SKIP_HINT);
    for (const [username, backend] of entries) {
      const mock = await getCanonicalPublicProfile(username, { anchorMode: "fixed" });
      assert.ok(mock, `${scenario}: ${username} resolves on the backend but not in Mock mode`);
      for (const field of COMPARED_SCALARS) {
        assert.equal(
          mock[field] ?? null,
          backend[field] ?? null,
          `${scenario}/${username}: ${field} differs`
        );
      }
      compared += 1;
    }
  }
  assert.ok(compared > 0, "no profile compared");
});

test("the lists a reader scans agree, in the same order", async (t) => {
  for (const scenario of SCENARIOS) {
    const entries = pairs(scenario);
    if (!entries) return t.skip(SKIP_HINT);
    for (const [username, backend] of entries) {
      const mock = await getCanonicalPublicProfile(username, { anchorMode: "fixed" });
      for (const field of COMPARED_LISTS) {
        assert.deepEqual(
          mock[field] ?? [],
          backend[field] ?? [],
          `${scenario}/${username}: ${field} differs`
        );
      }
    }
  }
});

test("collaboration preferences survive both translations", async (t) => {
  for (const scenario of SCENARIOS) {
    const entries = pairs(scenario);
    if (!entries) return t.skip(SKIP_HINT);
    for (const [username, backend] of entries) {
      const mock = await getCanonicalPublicProfile(username, { anchorMode: "fixed" });
      // `tools` is a list in the manifest and one line in the product. Both
      // sides must flatten it the same way or the profile reads differently.
      for (const field of ["tools", "turnaround", "working_hours", "work_mode"]) {
        assert.equal(
          mock.collaboration_preferences[field] ?? null,
          backend.collaboration_preferences?.[field] ?? null,
          `${scenario}/${username}: collaboration_preferences.${field} differs`
        );
      }
    }
  }
});

test("a hiring identity reads the same on both paths", async (t) => {
  let seen = 0;
  for (const scenario of SCENARIOS) {
    const entries = pairs(scenario);
    if (!entries) return t.skip(SKIP_HINT);
    for (const [username, backend] of entries) {
      if (!backend.hiring_info?.channels_or_pages_managed) continue;
      const mock = await getCanonicalPublicProfile(username, { anchorMode: "fixed" });
      assert.ok(mock.hiring_info, `${scenario}/${username}: no hiring identity in Mock mode`);
      for (const field of ["platforms", "niches", "formats"]) {
        assert.deepEqual(
          mock.hiring_info[field] ?? [],
          backend.hiring_info[field] ?? [],
          `${scenario}/${username}: hiring_info.${field} differs`
        );
      }
      assert.equal(
        mock.hiring_info.channels_or_pages_managed,
        backend.hiring_info.channels_or_pages_managed
      );
      assert.equal(mock.hiring_info.verification_status, backend.hiring_info.verification_status);
      seen += 1;
    }
  }
  assert.ok(seen > 0, "no hiring identity compared");
});

test("what a talent makes is described identically", async (t) => {
  for (const scenario of SCENARIOS) {
    const entries = pairs(scenario);
    if (!entries) return t.skip(SKIP_HINT);
    for (const [username, backend] of entries) {
      const mock = await getCanonicalPublicProfile(username, { anchorMode: "fixed" });
      // The backend widens these with what the portfolio demonstrates; the
      // Mock side mirrors that derivation rather than trusting the stated list.
      assert.equal(
        mock.content_style.primary_niche ?? null,
        backend.content_style?.primary_niche ?? null,
        `${scenario}/${username}: primary_niche differs`
      );
      assert.deepEqual(
        mock.content_style.format ?? [],
        backend.content_style?.format ?? [],
        `${scenario}/${username}: content_style.format differs`
      );
    }
  }
});

test("the same work is attached, with the same words on it", async (t) => {
  let items = 0;
  for (const scenario of SCENARIOS) {
    const entries = pairs(scenario);
    if (!entries) return t.skip(SKIP_HINT);
    for (const [username, backend] of entries) {
      const mock = await getCanonicalPublicProfile(username, { anchorMode: "fixed" });
      const mine = new Map(mock.portfolio_now.map((item) => [item.id, item]));
      const theirs = new Map((backend.portfolio_now ?? []).map((item) => [item.id, item]));
      assert.deepEqual(
        [...theirs.keys()].sort(),
        [...mine.keys()].sort(),
        `${scenario}/${username}: different portfolio items`
      );
      for (const [id, item] of theirs) {
        const own = mine.get(id);
        for (const field of ["title", "description", "contribution_summary", "duration", "role"]) {
          assert.equal(
            own[field] ?? null,
            item[field] ?? null,
            `${scenario}/${username}/${id}: ${field} differs`
          );
        }
        assert.deepEqual(own.tools ?? [], item.tools ?? [], `${id}: tools differ`);
        items += 1;
      }
    }
  }
  assert.ok(items > 0, "no portfolio item compared");
});

test("every profile-parity exception is documented with a reason", () => {
  for (const [field, reason] of Object.entries(ALLOWED_DIFFERENCES)) {
    assert.ok(reason.length > 30, `${field} is excluded without a real reason`);
  }
});

test("nothing a reader looks at is quietly excluded", () => {
  // The exclusion list is the risk in a parity suite: it is where a real
  // disagreement goes to be forgotten. These fields may never join it.
  for (const field of [...COMPARED_SCALARS, ...COMPARED_LISTS, "portfolio_now", "hiring_info", "content_style"]) {
    assert.equal(
      Object.hasOwn(ALLOWED_DIFFERENCES, field),
      false,
      `${field} is both compared and excluded`
    );
  }
});
