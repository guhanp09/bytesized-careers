import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  getCanonicalPublicProfile,
  resetCanonicalProfileCache,
} from "../lib/seed/canonicalProfile.ts";
import { SCENARIO_NAMES } from "../lib/seed/scenarioNames.ts";

/**
 * The applicant page, reached from the review.
 *
 * The workspace read the canonical corpus; `/u/{slug}` did not. So a reviewer
 * could open an application, read the name, click it, and land on "Profile not
 * found" — on the one page whose entire job is to show the person's work.
 *
 * These hold two properties. That a canonical slug resolves to a *complete*
 * profile, and that it can only ever resolve within its own scenario.
 */

const manifest = (name) =>
  JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), "fixtures", "creator_scenarios", "generated", `${name}.json`),
      "utf8"
    )
  );

const firstApplicant = (name) => {
  const data = manifest(name);
  const live = data.relationships.filter((rel) => !rel.archived);
  const actor = data.actors.find((entry) => entry.id === live[0].talent_id);
  return { data, actor };
};

test.beforeEach(() => resetCanonicalProfileCache());

/* ---- it resolves at all -------------------------------------------------- */

test("a canonical applicant resolves to a profile", async () => {
  const { actor } = firstApplicant("default");
  const profile = await getCanonicalPublicProfile(actor.username, { anchorMode: "fixed" });
  assert.ok(profile, `${actor.username} did not resolve`);
  assert.equal(profile.username, actor.username);
  assert.equal(profile.display_name, actor.display_name);
});

test("the slug is matched case-insensitively, as the route normalises it", async () => {
  const { actor } = firstApplicant("default");
  const profile = await getCanonicalPublicProfile(actor.username.toUpperCase(), {
    anchorMode: "fixed",
  });
  assert.ok(profile);
  assert.equal(profile.username, actor.username);
});

test("every live applicant in every normal scenario resolves", async () => {
  for (const name of ["default", "busy", "talent", "recruiter"]) {
    const data = manifest(name);
    const byId = new Map(data.actors.map((actor) => [actor.id, actor]));
    for (const rel of data.relationships) {
      if (rel.archived) continue;
      const actor = byId.get(rel.talent_id);
      const profile = await getCanonicalPublicProfile(actor.username, { anchorMode: "fixed" });
      assert.ok(profile, `${name}: ${actor.username} resolves to nothing`);
    }
  }
});

/* ---- and resolves to something worth reading ----------------------------- */

test("the resolved profile carries what a reviewer came to see", async () => {
  const { actor } = firstApplicant("default");
  const profile = await getCanonicalPublicProfile(actor.username, { anchorMode: "fixed" });

  // A name over an empty page is technically a resolution and practically a
  // dead end, which is exactly the state this replaced.
  assert.ok(profile.bio, "no biography");
  assert.ok(profile.headline, "no headline");
  assert.ok(profile.location, "no location");
  assert.ok(profile.timezone, "no timezone");
  assert.ok(profile.skills.length > 0, "no skills");
  assert.ok(profile.collaboration_preferences.tools, "no tools");
  assert.ok(profile.portfolio_now.length >= 2, "fewer than two pieces of work");
});

test("attached work arrives whole, not as a list of titles", async () => {
  const { actor } = firstApplicant("default");
  const profile = await getCanonicalPublicProfile(actor.username, { anchorMode: "fixed" });
  for (const item of profile.portfolio_now) {
    assert.ok(item.title, "a portfolio item with no title");
    assert.ok(item.description, `${item.title} has no description`);
    assert.ok(item.contribution_summary, `${item.title} does not say what they did`);
    assert.equal(item.user_id, actor.id);
    assert.equal(item.is_public, true);
  }
});

test("a talent's lists land on the talent side, a recruiter's on the hiring side", async () => {
  const data = manifest("default");
  const talent = data.actors.find((actor) => !(actor.sides || []).includes("recruiter"));
  const recruiter = data.actors.find((actor) => (actor.sides || []).includes("recruiter"));

  const talentProfile = await getCanonicalPublicProfile(talent.username, { anchorMode: "fixed" });
  assert.deepEqual(talentProfile.creator_platforms, talent.platforms);
  assert.equal(talentProfile.hiring_info, null);
  assert.equal(talentProfile.content_style.primary_niche, talent.niches[0]);

  const hiringProfile = await getCanonicalPublicProfile(recruiter.username, {
    anchorMode: "fixed",
  });
  assert.deepEqual(hiringProfile.hiring_info.platforms, recruiter.platforms);
  assert.deepEqual(hiringProfile.creator_platforms, []);
  assert.equal(hiringProfile.hiring_info.channels_or_pages_managed, recruiter.description);
});

test("durations are the product's label, not raw seconds", async () => {
  const { actor } = firstApplicant("default");
  const profile = await getCanonicalPublicProfile(actor.username, { anchorMode: "fixed" });
  for (const item of profile.portfolio_now) {
    if (item.duration === null) continue;
    assert.match(item.duration, /^\d+:\d{2}(:\d{2})?$/, `${item.duration} is not a duration label`);
  }
});

/* ---- and never resolves across a boundary -------------------------------- */

test("a slug can only resolve inside its own scenario", async () => {
  // Structural, not a comparison: the prefix picks the file, so no other
  // manifest is ever opened. Switching scenarios cannot surface a stranger.
  const { actor } = firstApplicant("busy");
  const profile = await getCanonicalPublicProfile(actor.username, { anchorMode: "fixed" });
  assert.ok(profile);

  const otherScenarios = SCENARIO_NAMES.filter((name) => name !== "busy");
  for (const name of otherScenarios) {
    const data = manifest(name);
    const found = data.actors.some((entry) => entry.username === actor.username);
    assert.equal(found, false, `${actor.username} also exists in ${name}`);
  }
});

test("a slug that belongs to no scenario falls through rather than being invented", async () => {
  // Returning a placeholder here would shadow the real resolvers behind it.
  for (const slug of ["ananya-editor", "someone", "def", "", "  "]) {
    assert.equal(await getCanonicalPublicProfile(slug, { anchorMode: "fixed" }), null, slug);
  }
});

test("a scenario-shaped prefix with an unknown handle still resolves to nothing", async () => {
  assert.equal(
    await getCanonicalPublicProfile("def-t99999", { anchorMode: "fixed" }),
    null
  );
});

test("canonical handles are unique across the whole corpus", async () => {
  // The prefix scheme is what makes single-file lookup correct. If two
  // scenarios could mint the same handle, the lookup would be a coin toss.
  const seen = new Map();
  for (const name of SCENARIO_NAMES) {
    for (const actor of manifest(name).actors) {
      const existing = seen.get(actor.username);
      assert.equal(existing, undefined, `${actor.username} is in both ${existing} and ${name}`);
      seen.set(actor.username, name);
    }
  }
});
