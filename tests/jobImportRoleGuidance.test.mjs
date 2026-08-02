import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const {
  contextualGuidance,
  detectCreatorRole,
  genericCreativeGuidance,
  roleGuidanceCopy,
} = await import("../lib/jobImportRoleGuidance.ts");

const context = (overrides = {}) => ({
  jobTitle: null,
  roleName: null,
  specialization: null,
  platforms: ["youtube"],
  formats: [],
  niches: [],
  tools: [],
  engagementType: "ongoing_freelance",
  workMode: "remote",
  compensationUnit: null,
  sourceLabel: "the public post",
  omitted: true,
  conflicted: false,
  ...overrides,
});

const ROLES = {
  "video-editor": { roleName: "Video Editor", jobTitle: "Video Editor for a finance channel" },
  "thumbnail-designer": {
    roleName: "Thumbnail Designer",
    jobTitle: "Thumbnail Designer for a gaming channel",
  },
  scriptwriter: { roleName: "Scriptwriter", jobTitle: "Scriptwriter for educational videos" },
  "podcast-editor": { roleName: "Podcast Editor", jobTitle: "Podcast Editor, weekly show" },
  "creator-strategist": {
    roleName: "Creator Strategist",
    jobTitle: "Creator Strategist for a brand channel",
  },
};

const prose = (copy) =>
  `${copy.heading} ${copy.explanation} ${copy.question} ${copy.candidateImpact}`;

test("each supported role is detected from title, role name, or specialization", () => {
  assert.equal(detectCreatorRole({ roleName: "Video Editor" }), "video-editor");
  assert.equal(detectCreatorRole({ roleName: "Thumbnail Designer" }), "thumbnail-designer");
  assert.equal(detectCreatorRole({ roleName: "Scriptwriter" }), "scriptwriter");
  assert.equal(detectCreatorRole({ roleName: "Podcast Editor" }), "podcast-editor");
  assert.equal(detectCreatorRole({ roleName: "Creator Strategist" }), "creator-strategist");

  // A vague title still resolves through the specialization.
  assert.equal(
    detectCreatorRole({ jobTitle: "Packaging help", specialization: "Thumbnail design" }),
    "thumbnail-designer"
  );
  // Nothing recognisable yields no profile rather than a wrong one.
  assert.equal(detectCreatorRole({ jobTitle: "Community volunteer" }), null);
});

test("the more specific role wins over a broader one that also matches", () => {
  // "Podcast Editor" contains "editor"; it must not resolve to Video Editor.
  assert.equal(detectCreatorRole({ roleName: "Podcast Editor" }), "podcast-editor");
  assert.equal(
    detectCreatorRole({ jobTitle: "Thumbnail designer and editor" }),
    "thumbnail-designer"
  );
});

test("revision guidance reasons about the actual craft, not a renamed template", () => {
  const byRole = Object.fromEntries(
    Object.entries(ROLES).map(([key, fields]) => [
      key,
      roleGuidanceCopy("revisions", context(fields)),
    ])
  );

  // Each of these must appear in its own role's reasoning and nowhere else,
  // which is only possible if the explanation is about the work itself.
  assert.match(byRole["video-editor"].explanation, /re-cuts|passes/i);
  assert.match(byRole["thumbnail-designer"].explanation, /approval|opinions/i);
  assert.match(byRole.scriptwriter.explanation, /draft|outline/i);
  assert.match(byRole["podcast-editor"].explanation, /timestamps|episode/i);

  const explanations = Object.values(byRole)
    .filter(Boolean)
    .map((copy) => copy.explanation);
  assert.equal(
    new Set(explanations).size,
    explanations.length,
    "no two roles may share a revision explanation"
  );
});

test("deliverable guidance asks for the unit that role is actually priced in", () => {
  assert.match(
    roleGuidanceCopy("deliverables", context(ROLES["video-editor"])).question,
    /how long/i
  );
  assert.match(
    roleGuidanceCopy("deliverables", context(ROLES["thumbnail-designer"])).question,
    /how many|how often/i
  );
  assert.match(
    roleGuidanceCopy("deliverables", context(ROLES.scriptwriter)).question,
    /runtime|word count/i
  );
  assert.match(
    roleGuidanceCopy("deliverables", context(ROLES["podcast-editor"])).question,
    /episode/i
  );
  assert.match(
    roleGuidanceCopy("deliverables", context(ROLES["creator-strategist"])).question,
    /deliver/i
  );
});

test("source-input guidance names what that role actually receives", () => {
  assert.match(
    roleGuidanceCopy("source-inputs", context(ROLES["video-editor"])).explanation,
    /footage|b-roll/i
  );
  assert.match(
    roleGuidanceCopy("source-inputs", context(ROLES["thumbnail-designer"])).explanation,
    /title|concept|source images/i
  );
  assert.match(
    roleGuidanceCopy("source-inputs", context(ROLES.scriptwriter)).explanation,
    /research|outline/i
  );
  assert.match(
    roleGuidanceCopy("source-inputs", context(ROLES["podcast-editor"])).explanation,
    /recording|tracks|cleanup/i
  );
  assert.match(
    roleGuidanceCopy("source-inputs", context(ROLES["creator-strategist"])).explanation,
    /analytics|retention/i
  );
});

test("a strategist is asked about analytics; an editor never is", () => {
  const strategist = roleGuidanceCopy("source-inputs", context(ROLES["creator-strategist"]));
  const editor = roleGuidanceCopy("source-inputs", context(ROLES["video-editor"]));
  assert.match(strategist.question, /analytics|access/i);
  assert.doesNotMatch(editor.question, /analytics/i);
});

test("guidance reflects live context: platform and niche appear where relevant", () => {
  const withPlatform = roleGuidanceCopy(
    "revisions",
    context({ ...ROLES["thumbnail-designer"], niches: ["gaming"] })
  );
  assert.match(withPlatform.explanation, /gaming/i);

  const withoutNiche = roleGuidanceCopy(
    "revisions",
    context({ ...ROLES["thumbnail-designer"], niches: [] })
  );
  // Absent context leaves no dangling fragment behind.
  assert.doesNotMatch(withoutNiche.explanation, / in \./);
  assert.doesNotMatch(withoutNiche.explanation, /undefined|null/);
});

test("engagement type changes whether workload is framed as recurring", () => {
  const recurring = roleGuidanceCopy(
    "revisions",
    context({ ...ROLES["thumbnail-designer"], engagementType: "retainer" })
  );
  const oneOff = roleGuidanceCopy(
    "revisions",
    context({ ...ROLES["thumbnail-designer"], engagementType: "one_time_project" })
  );
  assert.match(recurring.explanation, /recurring/i);
  assert.match(oneOff.explanation, /one-off/i);
});

test("the finding clause distinguishes absence from contradiction", () => {
  const absent = roleGuidanceCopy(
    "turnaround",
    context({ ...ROLES["video-editor"], omitted: true, conflicted: false })
  );
  const contradictory = roleGuidanceCopy(
    "turnaround",
    context({ ...ROLES["video-editor"], omitted: false, conflicted: true })
  );
  assert.match(absent.explanation, /does not say/i);
  assert.match(contradictory.explanation, /two different answers/i);
  // Ordinary absence is never described as a failure.
  assert.doesNotMatch(absent.explanation, /error|failed|could not/i);
});

test("explanations open with a capital even though source labels are lowercase", () => {
  for (const fields of Object.values(ROLES)) {
    for (const groupId of ["revisions", "source-inputs", "deliverables"]) {
      const copy = roleGuidanceCopy(groupId, context(fields));
      if (!copy) continue;
      assert.match(
        copy.explanation.charAt(0),
        /[A-Z"“I]/,
        `explanation for ${groupId} must open as a sentence`
      );
    }
  }
});

test("an unrecognised creative role still gets a useful, contextual fallback", () => {
  const unknown = context({ roleName: "Set Photographer", jobTitle: "Set Photographer" });
  assert.equal(detectCreatorRole(unknown), null);

  const copy = genericCreativeGuidance("revisions", unknown);
  assert.ok(copy);
  // The fallback names the role and explains why the field matters, rather
  // than falling back to "this field is required".
  assert.match(copy.explanation, /Set Photographer/);
  assert.doesNotMatch(prose(copy), /this field is required|please enter/i);
  assert.ok(copy.candidateImpact.length > 20);
});

test("groups that mean the same thing for every role are left generic", () => {
  // Compensation and application routing do not change by craft; inventing a
  // role-flavoured variant would be noise, so the module declines.
  assert.equal(roleGuidanceCopy("compensation", context(ROLES["video-editor"])), null);
  assert.equal(contextualGuidance("application", context(ROLES.scriptwriter)), null);
});

test("no guidance leaks an internal field path or the word legacy", () => {
  const leaks = [
    "field_path",
    "legacy",
    "weekly_hours_min",
    "application_mode",
    "budget_unit_custom",
    "source_inputs",
    "creative_autonomy",
    "_min",
    "_max",
  ];
  for (const fields of Object.values(ROLES)) {
    for (const groupId of [
      "deliverables",
      "revisions",
      "source-inputs",
      "turnaround",
      "references",
      "creative-autonomy",
      "hiring-process",
      "tools",
    ]) {
      const copy = contextualGuidance(groupId, context(fields));
      if (!copy) continue;
      const text = prose(copy);
      for (const leak of leaks) {
        assert.ok(!text.includes(leak), `${groupId} copy must not expose "${leak}"`);
      }
    }
  }
});

test("every produced turn carries all four parts a decision needs", () => {
  for (const fields of Object.values(ROLES)) {
    for (const groupId of ["deliverables", "revisions", "source-inputs", "turnaround"]) {
      const copy = contextualGuidance(groupId, context(fields));
      if (!copy) continue;
      assert.ok(copy.heading.length > 0, "a friendly heading");
      assert.ok(copy.explanation.length > 60, "what was found and why it matters");
      assert.ok(copy.question.trim().endsWith("?"), "one clear question");
      assert.ok(copy.candidateImpact.length > 20, "the impact of answering");
    }
  }
});

test("the guidance module is deterministic and makes no provider call", () => {
  const source = readFileSync(
    new URL("../lib/jobImportRoleGuidance.ts", import.meta.url),
    "utf8"
  );
  for (const forbidden of ["fetch(", "openai", "OpenAI", "Math.random", "Date.now", "await "]) {
    assert.ok(
      !source.includes(forbidden),
      `role guidance must not use ${forbidden}: it is pure, local presentation`
    );
  }

  // Same input, same output, every time.
  const once = roleGuidanceCopy("revisions", context(ROLES["video-editor"]));
  const twice = roleGuidanceCopy("revisions", context(ROLES["video-editor"]));
  assert.deepEqual(once, twice);
});
