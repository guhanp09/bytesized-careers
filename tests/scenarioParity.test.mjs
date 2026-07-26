import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { mapActivityToOwnerInteractions } from "../lib/ownerInteractions.ts";
import { toFrontendJob } from "../lib/backendClient.ts";
import { portfolioForInteraction } from "../lib/creatorProjection.ts";
import { toOwnerInteractions } from "../lib/seed/scenarioManifest.ts";

/**
 * Backend/Mock semantic parity.
 *
 * The point is to compare *the two code paths*, not two readings of one file.
 * The backend side is a real restore, read back through the production activity
 * serializer, normalised by `toFrontendJob` and mapped by
 * `mapActivityToOwnerInteractions` — every step the live app performs, in the
 * order it performs them. The frontend side is the Mock adaptation of the same
 * manifest. Both must describe the same interaction.
 *
 * Reusing `toFrontendJob` is not incidental. The first version of this suite fed
 * the raw snake_case payload straight to the mapper, skipping the normalisation
 * `getActivitySummary` always applies, and then reported the client's own
 * camelCase conversion as three missing backend fields. Two of those "backend
 * gaps" did not exist. A parity harness that does not walk the real path
 * measures the harness.
 *
 * The backend payload is scratch output produced by
 * `backend/tests/test_creator_scenario_parity_dump.py`. It is deliberately not
 * committed: a checked-in copy would be exactly the second dataset this phase
 * exists to remove, and it would go stale in silence. These tests skip when it
 * is absent, and the validation matrix runs pytest first.
 */

const DUMP_DIR = path.join(process.cwd(), ".parity-dumps");
const MANIFEST_DIR = path.join(process.cwd(), "fixtures", "creator_scenarios", "generated");

/** The anchor both sides materialise offsets against. */
const ANCHOR_MS = Date.parse("2026-01-15T09:00:00.000Z");

/** Scenarios carrying relationships, and therefore worth comparing. */
const COMPARED_SCENARIOS = ["default", "edge", "busy", "talent", "recruiter"];

/**
 * Fields excluded from comparison, each with the reason it carries no product
 * meaning *on this path*. Nothing is excluded because it happened to differ.
 *
 * The distinction that matters: "incidental" means either a value with no
 * user-facing meaning, or a value this endpoint structurally does not carry.
 * It never means "a thing users can see that the two paths disagree about".
 */
const ALLOWED_DIFFERENCES = {
  counterpartyAvatarUrl:
    "environment-specific absolute URL; the manifest stores a host that does not resolve",
  statusVersion: "backend optimistic-concurrency bookkeeping with no user-facing meaning",
  rowTimestamps:
    "database insertion time, not the scenario instant; the scenario instant is compared separately",
  "job.channelLogoUrl": "environment-specific absolute URL",
  "job.budget":
    "legacy preformatted display string; the manifest deliberately stores none so the " +
    "structured commercial model is used, and that model is compared field by field instead",
  messages:
    "the activity summary does not carry conversation messages at all — threads load per " +
    "conversation on demand, so mapActivityToOwnerInteractions produces interactions without " +
    "them. Comparing message content here would test an endpoint that is not in this path",
  engagementAndPayment:
    "engagement and payment state reach the workspace through the per-conversation thread " +
    "endpoint and `engagementsByRecord`, not through the activity summary. They are compared " +
    "against the manifest by the backend restore tests, which read the rows directly",
  starAndSnooze:
    "personal organisation is per-viewer client state in this phase, held by neither the " +
    "activity summary nor the manifest adaptation, so there is nothing on either path to compare",
};

/**
 * Findings about the *live backend path*, recorded rather than hidden.
 *
 * This list previously held three entries. Two were wrong — artefacts of the
 * harness skipping `toFrontendJob`, not gaps in the serializer — and are struck
 * out below rather than quietly deleted, because a parity suite that silently
 * rewrites its own history is worth nothing. The third was real and is fixed.
 */
export const BACKEND_PATH_GAPS = {
  sentViewCounterpartyName:
    "FIXED. A sent application fell back to the literal string 'Recruiter', giving every " +
    "recruiter in an applicant's list one shared name — the same defect Phase 1 fixed for " +
    "'Applicant' on the received side. The mapper now uses displayPersonName, and the scenario " +
    "restore populates each job's hiring identity from its owner, so the fallback is reached " +
    "only when a name genuinely does not exist and is then a stable per-person handle",
  sentViewPortfolio:
    "NOT A GAP. first_message_answers is exposed on sent applications and always was. The " +
    "portfolio appeared missing because this suite compared the raw `portfolio` field instead " +
    "of portfolioForInteraction(), which is what every rendering call site actually uses and " +
    "which reads the relevant_portfolio answer",
  jobFormatsAndNiches:
    "NOT A GAP. formats_hired_for and content_niches are both present in the activity payload. " +
    "They appeared missing because this suite skipped toFrontendJob, so the camelCase fields " +
    "jobSnapshotFromJob reads were undefined. Through the real path they survive to the " +
    "workspace, and the creator projection below now asserts it",
};

const manifestFor = (scenario) =>
  JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, `${scenario}.json`), "utf8"));

function dumpFor(scenario) {
  const file = path.join(DUMP_DIR, `${scenario}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Epoch milliseconds, so ISO formatting differences are not mistaken for drift.
 *
 * A timestamp with no offset is read as UTC, which is what it is. The columns
 * are `DateTime(timezone=True)` and the restore writes aware UTC instants, but
 * the disposable SQLite database these dumps come from cannot store an offset,
 * so it hands back a naive string. Left to `Date.parse` that string becomes
 * *local* time, and every backend timestamp appeared to differ from the
 * manifest by exactly this machine's UTC offset — a property of the test
 * database, not of the data. Both sides still have to agree on the instant.
 */
const at = (iso) => {
  if (!iso) return null;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(iso);
  return Date.parse(hasZone ? iso : `${iso}Z`);
};

/**
 * The semantic projection of one interaction.
 *
 * Explicit rather than "the whole object minus some keys": a snapshot with
 * fields deleted until it passes proves only that it passes. Every field here is
 * one a user can perceive, and portfolio is read exactly as the components read
 * it rather than off the record, because that is where it actually lives.
 */
function semantics(item) {
  const portfolio = portfolioForInteraction(item);
  const creator = item.job?.creator ?? null;
  const compensation = creator?.compensation ?? null;
  return {
    id: item.id,
    kind: item.kind,
    direction: item.direction,
    // Display status is direction-dependent, which is the mapping most likely
    // to diverge between the two paths.
    status: item.status,
    backendStatus: item.backendStatus ?? null,
    participantBackendStatus: item.participantBackendStatus ?? null,
    counterpartyName: item.counterpartyName,
    counterpartyUserId: item.counterpartyUserId ?? null,
    jobId: item.job?.jobId ?? null,
    jobTitle: item.job?.title ?? null,
    jobListingStatus: item.job?.listingStatus ?? null,
    jobLocation: item.job?.location ?? null,
    jobWorkMode: item.job?.workMode ?? null,
    jobExperience: item.job?.experience ?? null,
    archived: Boolean(item.archivedAt),
    // A private note must be absent on the side that should not see it.
    hasManagerNote: Boolean(item.managerNote),
    createdAt: at(item.createdAt),
    updatedAt: at(item.updatedAt),
    portfolioCount: portfolio.length,
    portfolioIds: portfolio.map((entry) => entry.id).sort(),
    // Phase 3's creator-specific attributes. These are the fields that make the
    // product creator-specific rather than a generic job board, so a Backend
    // mode that lost them would be a different product.
    platforms: creator?.platforms ?? null,
    formats: creator?.formats ?? null,
    niches: creator?.niches ?? null,
    turnaround: creator?.turnaround ?? null,
    compensationMode: compensation?.mode ?? null,
    compensationMinimum: compensation?.minimum ?? null,
    compensationMaximum: compensation?.maximum ?? null,
    compensationCurrency: compensation?.currency ?? null,
    compensationUnit: compensation?.unit ?? null,
    // The context card beside the conversation. Retiring the hand-written
    // fixture removed the only source these ever had in Mock mode, so they are
    // compared explicitly rather than assumed.
    talentName: item.talent?.name ?? null,
    talentHeadline: item.talent?.headline ?? null,
    talentRate: item.talent?.rate ?? null,
    talentExperience: item.talent?.experience ?? null,
    talentLocation: item.talent?.location ?? null,
    talentIsOwnListing: Boolean(item.talent?.isOwnListing),
    recruiterName: item.recruiter?.name ?? null,
    // The structured answers drive the opening message the recipient reads.
    // Keys rather than values: `relevant_portfolio` is compared above in the
    // form the components consume, and the rest are plain scalars the two
    // paths copy verbatim.
    answerKeys: Object.keys(item.firstMessageAnswers ?? {}).sort(),
  };
}

/** A difference report that names the path, not a wall of JSON. */
function differences(scenario, id, frontend, backend) {
  const out = [];
  for (const key of Object.keys(frontend)) {
    const a = JSON.stringify(frontend[key]);
    const b = JSON.stringify(backend[key]);
    if (a !== b) {
      out.push(`  ${scenario} ${id} · ${key}\n      frontend: ${a}\n      backend:  ${b}`);
    }
  }
  return out;
}

/**
 * The backend path, walked the way the app walks it.
 *
 * `toFrontendJob` on both job collections is the step `getActivitySummary`
 * performs before the workspace sees anything; omitting it is what made the
 * first version of this suite report imaginary gaps.
 */
function backendInteractions(dump) {
  const items = [];
  for (const summary of Object.values(dump.views)) {
    const mapped = mapActivityToOwnerInteractions({
      myJobs: (summary.my_jobs ?? []).map(toFrontendJob),
      myTalentListings: summary.my_talent_listings ?? [],
      sentApplications: summary.sent_applications ?? [],
      receivedApplications: summary.received_applications ?? [],
      receivedInterests: summary.received_interests ?? [],
      sentInterests: summary.sent_interests ?? [],
      relatedJobs: (summary.related_jobs ?? []).map(toFrontendJob),
      relatedTalentListings: summary.related_talent_listings ?? [],
    });
    items.push(...mapped);
  }
  return items;
}

function frontendInteractions(manifest) {
  return [
    ...toOwnerInteractions(manifest, { mode: "recruiter", anchor: ANCHOR_MS }),
    ...toOwnerInteractions(manifest, { mode: "talent", anchor: ANCHOR_MS }),
  ];
}

/** Keyed by record *and* direction: one relationship is two different interactions. */
const keyOf = (item) => `${item.id}:${item.direction}`;

function comparablePair(scenario) {
  const dump = dumpFor(scenario);
  if (!dump) return null;
  const manifest = manifestFor(scenario);
  return {
    manifest,
    backend: new Map(backendInteractions(dump).map((item) => [keyOf(item), item])),
    frontend: new Map(frontendInteractions(manifest).map((item) => [keyOf(item), item])),
  };
}

const SKIP_HINT =
  "no backend parity dump — run: cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_creator_scenario_parity_dump.py";

for (const scenario of COMPARED_SCENARIOS) {
  test(`${scenario}: both consumers describe the same interactions`, (t) => {
    const pair = comparablePair(scenario);
    if (!pair) return t.skip(SKIP_HINT);
    const { backend, frontend } = pair;

    const shared = [...backend.keys()].filter((id) => frontend.has(id));
    assert.ok(shared.length > 0, "the two paths shared no records at all");

    const problems = [];
    for (const id of shared) {
      problems.push(...differences(scenario, id, semantics(frontend.get(id)), semantics(backend.get(id))));
    }
    assert.deepEqual(problems, [], `semantic parity differences:\n${problems.join("\n")}`);
  });
}

test("both viewing directions are actually compared, in every scenario that has them", (t) => {
  // Without this the suite can pass by comparing nothing. It did: an earlier
  // dump captured forty talent accounts and not one recruiter, so `default`
  // reported parity across zero received applications.
  const missing = [];
  for (const scenario of COMPARED_SCENARIOS) {
    const pair = comparablePair(scenario);
    if (!pair) return t.skip(SKIP_HINT);
    const shared = [...pair.backend.keys()].filter((id) => pair.frontend.has(id));
    for (const direction of ["received", "sent"]) {
      const count = shared.filter((id) => id.endsWith(`:${direction}`)).length;
      if (count < 3) missing.push(`${scenario} compared only ${count} ${direction} records`);
    }
  }
  assert.deepEqual(missing, [], `parity coverage is too thin to mean anything:\n${missing.join("\n")}`);
});

test("a recruiter's private position never reaches the participant, on either path", (t) => {
  const pair = comparablePair("default");
  if (!pair) return t.skip(SKIP_HINT);
  const manifest = pair.manifest;
  // Records where the manager moved on privately without telling the applicant.
  const divergent = (manifest.relationships ?? []).filter(
    (rel) => rel.participant_stage && rel.participant_stage !== rel.stage
  );
  assert.ok(divergent.length > 0, "the fixture carries no private divergence to check");

  let checked = 0;
  for (const rel of divergent) {
    for (const source of [pair.frontend, pair.backend]) {
      const sent = source.get(`${rel.id}:sent`);
      if (!sent) continue;
      checked += 1;
      // What the participant sees is what they were told, never the private stage.
      assert.equal(
        sent.backendStatus,
        rel.participant_stage,
        `${rel.id} leaked the manager's private stage to the participant`
      );
      assert.ok(!sent.managerNote, `${rel.id} leaked the private manager note`);
    }
  }
  assert.ok(checked > 0, "no divergent record was visible from the sent side to check");
});

test("nobody is called by a shared generic name on either path", (t) => {
  // "Recruiter" for every recruiter is not a name; it is the absence of one
  // rendered as though it were present. The fallback must be per-person.
  const generic = new Set(["Recruiter", "Talent", "Applicant", "Member"]);
  const offenders = [];
  for (const scenario of COMPARED_SCENARIOS) {
    const pair = comparablePair(scenario);
    if (!pair) return t.skip(SKIP_HINT);
    for (const [source, label] of [
      [pair.backend, "backend"],
      [pair.frontend, "frontend"],
    ]) {
      for (const [id, item] of source) {
        if (generic.has((item.counterpartyName || "").trim())) {
          offenders.push(`${scenario} ${id} (${label}) is called "${item.counterpartyName}"`);
        }
      }
    }
  }
  assert.deepEqual(offenders, [], `generic counterparty names:\n${offenders.join("\n")}`);
});

test("an unnamed person still gets a stable, distinct handle", () => {
  // The fallback has to survive missing data without merging two people.
  const summary = {
    myJobs: [],
    myTalentListings: [],
    sentApplications: [
      {
        id: "a1",
        job_id: "j1",
        job_owner_user_id: "owner-1111",
        status: "new",
        created_at: "2026-01-15T09:00:00Z",
        updated_at: "2026-01-15T09:00:00Z",
      },
      {
        id: "a2",
        job_id: "j2",
        job_owner_user_id: "owner-2222",
        status: "new",
        created_at: "2026-01-15T09:00:00Z",
        updated_at: "2026-01-15T09:00:00Z",
      },
    ],
    receivedApplications: [],
    receivedInterests: [],
    sentInterests: [],
    relatedJobs: [],
    relatedTalentListings: [],
  };
  const [first, second] = mapActivityToOwnerInteractions(summary);
  assert.notEqual(first.counterpartyName, second.counterpartyName);
  for (const item of [first, second]) {
    assert.match(item.counterpartyName, /^@channel_/);
    // A handle is not an email and not a raw identifier.
    assert.doesNotMatch(item.counterpartyName, /@.*\./);
  }
  // Deterministic: the same person is the same handle on every render.
  assert.equal(mapActivityToOwnerInteractions(summary)[0].counterpartyName, first.counterpartyName);
});

test("a portfolio is visible from both sides, and only its own", (t) => {
  const pair = comparablePair("edge");
  if (!pair) return t.skip(SKIP_HINT);
  const manifest = pair.manifest;
  const byId = new Map((manifest.relationships ?? []).map((rel) => [rel.id, rel]));

  let checkedSent = 0;
  let checkedReceived = 0;
  for (const [key, item] of pair.backend) {
    const [id, direction] = key.split(":");
    const rel = byId.get(id);
    if (!rel) continue;
    const expected = [...(rel.portfolio_ids ?? [])].sort();
    const actual = portfolioForInteraction(item)
      .map((entry) => entry.id)
      .sort();
    // Exactly the attached items: not fewer, and — the leak that matters — not
    // one extra item from anyone else's profile.
    assert.deepEqual(actual, expected, `${key} shows the wrong portfolio`);
    if (direction === "sent") checkedSent += 1;
    else checkedReceived += 1;
  }
  assert.ok(checkedSent > 0 && checkedReceived > 0, "needed both directions to prove this");
});

test("Phase 3 creator attributes survive the backend path", (t) => {
  const pair = comparablePair("default");
  if (!pair) return t.skip(SKIP_HINT);
  // The claim under test is specific: formats and niches are not merely equal to
  // the Mock side, they are actually populated. Two empty lists are also equal.
  const withFormats = [...pair.backend.values()].filter((item) => item.job?.creator?.formats?.length);
  const withNiches = [...pair.backend.values()].filter((item) => item.job?.creator?.niches?.length);
  const withTurnaround = [...pair.backend.values()].filter((item) => item.job?.creator?.turnaround);
  assert.ok(withFormats.length > 0, "no backend record carried formats_hired_for");
  assert.ok(withNiches.length > 0, "no backend record carried content_niches");
  assert.ok(withTurnaround.length > 0, "no backend record carried a turnaround");
});

test("direction changes what a canonical status means, on both paths", (t) => {
  const pair = comparablePair("default");
  if (!pair) return t.skip(SKIP_HINT);

  // `new` is the case that matters: received it is something waiting for you,
  // sent it is something you are waiting on. A path that returned one label for
  // both would make half the workspace lie about whose turn it is.
  const front = [...pair.frontend.values()].filter((item) => item.backendStatus === "new");
  const received = front.filter((item) => item.direction === "received");
  const sent = front.filter((item) => item.direction === "sent");
  assert.ok(received.length && sent.length, "need both directions of a `new` record");
  assert.notEqual(received[0].status, sent[0].status);

  const back = [...pair.backend.values()].filter((item) => item.backendStatus === "new");
  const backReceived = back.filter((item) => item.direction === "received");
  const backSent = back.filter((item) => item.direction === "sent");
  assert.ok(backReceived.length && backSent.length, "the dump captured only one direction");
  assert.notEqual(backReceived[0].status, backSent[0].status);
  assert.equal(backReceived[0].status, received[0].status);
  assert.equal(backSent[0].status, sent[0].status);
});

test("every allowed parity exception is documented with a reason", () => {
  // An exception list without reasons is a way to make a failing test pass.
  for (const [field, reason] of Object.entries(ALLOWED_DIFFERENCES)) {
    assert.ok(reason.length > 25, `${field} has no real justification`);
  }
});

test("the backend-path findings are recorded with their outcome, not merely excluded", () => {
  // Two of the three original entries turned out to be defects in this suite
  // rather than in the product. Keeping them, labelled, is the honest record.
  assert.ok(Object.keys(BACKEND_PATH_GAPS).length >= 3);
  for (const [name, reason] of Object.entries(BACKEND_PATH_GAPS)) {
    assert.ok(reason.length > 60, `${name} is not actually explained`);
    assert.match(reason, /^(FIXED|NOT A GAP|OPEN)\./, `${name} does not state its outcome`);
  }
});

test("the indexed hero records are present on both paths", (t) => {
  const pair = comparablePair("default");
  if (!pair) return t.skip(SKIP_HINT);
  const indexed = (pair.manifest.index ?? []).map((entry) => entry.relationship_id);
  assert.ok(indexed.length > 0, "the manifest carries no scenario index");

  const backendIds = new Set([...pair.backend.values()].map((item) => item.id));
  const frontendIds = new Set([...pair.frontend.values()].map((item) => item.id));

  // Every indexed record must exist on the frontend path — the manifest is its
  // only source, so a miss there is a real defect.
  const missingFromFrontend = indexed.filter((id) => !frontendIds.has(id));
  assert.deepEqual(missingFromFrontend, [], "indexed records missing from the Mock adaptation");

  // The backend side is asserted over what the dump actually captured: it walks
  // a bounded number of accounts, so a record held by an account outside that
  // set is absent from the dump rather than absent from the product.
  const covered = indexed.filter((id) => backendIds.has(id));
  assert.ok(
    covered.length >= 5,
    `only ${covered.length} indexed records were covered by the backend dump`
  );
});
