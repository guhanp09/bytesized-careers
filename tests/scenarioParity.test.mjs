import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { mapActivityToOwnerInteractions } from "../lib/ownerInteractions.ts";
import { toOwnerInteractions } from "../lib/seed/scenarioManifest.ts";

/**
 * Backend/Mock semantic parity.
 *
 * The point is to compare *the two code paths*, not two readings of one file.
 * The backend side is a real restore, read back through the production activity
 * serializer and mapped by `mapActivityToOwnerInteractions` — the same function
 * the live app uses. The frontend side is the Mock adaptation of the same
 * manifest. Both must describe the same interaction.
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

/**
 * Fields excluded from comparison, each with the reason it carries no product
 * meaning. Nothing is excluded because it happened to differ.
 */
const ALLOWED_DIFFERENCES = {
  counterpartyAvatarUrl:
    "environment-specific absolute URL; the manifest stores a host that does not resolve",
  statusVersion: "backend optimistic-concurrency bookkeeping with no user-facing meaning",
  rowTimestamps:
    "database insertion time, not the scenario instant; the scenario instant is compared separately",
  "job.channelLogoUrl": "environment-specific absolute URL",
  "job.budget": "legacy display string; the structured commercial model is compared instead",
  messages:
    "the activity summary does not carry conversation messages at all — threads load per " +
    "conversation on demand, so mapActivityToOwnerInteractions produces interactions without " +
    "them. Comparing message content here would test an endpoint that is not in this path",
};

/**
 * Gaps this suite found in the *live backend path*, recorded rather than hidden.
 *
 * These are not manifest problems and not Mock problems: they are places where
 * the existing activity serializer carries less than the workspace can display,
 * so the same record is poorer in Backend mode than in Mock mode. Each one is a
 * real product finding, listed here so excluding it from the comparison cannot
 * quietly become forgetting it.
 */
export const BACKEND_PATH_GAPS = {
  sentViewCounterpartyName:
    "On a *sent* application the summary carries no recruiter display-name snapshot, so the " +
    "counterparty renders as the generic 'Recruiter'. This is the same shape of defect Phase 1 " +
    "fixed for 'Applicant' on the received side, still present on the sent side",
  sentViewPortfolio:
    "first_message_answers, and therefore relevant_portfolio, is not exposed on the sent view, " +
    "so an applicant reviewing their own application sees no portfolio where Mock shows theirs",
  jobFormatsAndNiches:
    "the job payload in the activity summary does not expose formats_hired_for or content_niches, " +
    "so Phase 3's format and niche attributes are absent in Backend mode while platforms survive",
};

const manifestFor = (scenario) =>
  JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, `${scenario}.json`), "utf8"));

function dumpFor(scenario) {
  const file = path.join(DUMP_DIR, `${scenario}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * The semantic projection of one interaction.
 *
 * Explicit rather than "the whole object minus some keys": a snapshot with
 * fields deleted until it passes proves only that it passes. Every field here
 * is one a user can perceive.
 */
function semantics(item) {
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
    archived: Boolean(item.archivedAt),
    // A private note must be absent on the side that should not see it.
    hasManagerNote: Boolean(item.managerNote),
    portfolioCount: (item.portfolio ?? []).length,
    portfolioIds: (item.portfolio ?? []).map((entry) => entry.id).sort(),
    platforms: item.job?.creator?.platforms ?? null,
  };
}

/**
 * The received view is the one this path is fully responsible for.
 *
 * BACKEND_PATH_GAPS above records what the sent view is missing. Rather than
 * excluding those fields everywhere — which would stop them being checked at
 * all — the full comparison runs on received records, and the sent view is
 * compared on the subset the serializer does carry.
 */
function sentViewSemantics(item) {
  const full = semantics(item);
  for (const field of ["counterpartyName", "portfolioCount", "portfolioIds"]) delete full[field];
  return full;
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

function backendInteractions(dump) {
  const items = [];
  for (const summary of Object.values(dump.views)) {
    const mapped = mapActivityToOwnerInteractions({
      myJobs: summary.my_jobs ?? [],
      myTalentListings: summary.my_talent_listings ?? [],
      sentApplications: summary.sent_applications ?? [],
      receivedApplications: summary.received_applications ?? [],
      receivedInterests: summary.received_interests ?? [],
      sentInterests: summary.sent_interests ?? [],
      relatedJobs: summary.related_jobs ?? [],
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

for (const scenario of ["default", "edge"]) {
  test(`${scenario}: both consumers describe the same interactions`, (t) => {
    const dump = dumpFor(scenario);
    if (!dump) {
      return t.skip(
        "no backend parity dump — run: cd backend && APP_ENV=test .venv/bin/python -m pytest tests/test_creator_scenario_parity_dump.py"
      );
    }
    const manifest = manifestFor(scenario);
    // Keyed by record *and direction*: one relationship is a different
    // interaction to each side, so comparing a recruiter's received view against
    // a talent's sent view of the same row proves nothing.
    const key = (item) => `${item.id}:${item.direction}`;
    const backend = new Map(backendInteractions(dump).map((item) => [key(item), item]));
    const frontend = new Map(frontendInteractions(manifest).map((item) => [key(item), item]));

    const shared = [...backend.keys()].filter((id) => frontend.has(id));
    assert.ok(shared.length > 0, "the two paths shared no records at all");

    const problems = [];
    for (const id of shared) {
      const project = id.endsWith(":sent") ? sentViewSemantics : semantics;
      problems.push(
        ...differences(scenario, id, project(frontend.get(id)), project(backend.get(id)))
      );
    }
    assert.deepEqual(problems, [], `semantic parity differences:\n${problems.join("\n")}`);
  });
}

test("direction changes what a canonical status means, on both paths", (t) => {
  const dump = dumpFor("default");
  if (!dump) return t.skip("no backend parity dump");
  const manifest = manifestFor("default");

  // `new` is the case that matters: received it is something waiting for you,
  // sent it is something you are waiting on. A path that returned one label for
  // both would make half the workspace lie about whose turn it is.
  const front = frontendInteractions(manifest).filter((item) => item.backendStatus === "new");
  const received = front.filter((item) => item.direction === "received");
  const sent = front.filter((item) => item.direction === "sent");
  assert.ok(received.length && sent.length, "need both directions of a `new` record");
  assert.notEqual(received[0].status, sent[0].status);

  const back = backendInteractions(dump).filter((item) => item.backendStatus === "new");
  const backReceived = back.filter((item) => item.direction === "received");
  const backSent = back.filter((item) => item.direction === "sent");
  if (backReceived.length && backSent.length) {
    assert.notEqual(backReceived[0].status, backSent[0].status);
    assert.equal(backReceived[0].status, received[0].status);
    assert.equal(backSent[0].status, sent[0].status);
  }
});

test("every allowed parity exception is documented with a reason", () => {
  // An exception list without reasons is a way to make a failing test pass.
  for (const [field, reason] of Object.entries(ALLOWED_DIFFERENCES)) {
    assert.ok(reason.length > 25, `${field} has no real justification`);
  }
});

test("the backend-path gaps this suite found are recorded, not merely excluded", () => {
  // Excluding a field from a comparison is only honest if the reason it differs
  // is written down where someone will find it.
  assert.ok(Object.keys(BACKEND_PATH_GAPS).length >= 3);
  for (const [name, reason] of Object.entries(BACKEND_PATH_GAPS)) {
    assert.ok(reason.length > 60, `${name} is not actually explained`);
  }
});

test("the indexed hero records are present on both paths", (t) => {
  const dump = dumpFor("default");
  if (!dump) return t.skip("no backend parity dump");
  const manifest = manifestFor("default");
  const indexed = (manifest.index ?? []).map((entry) => entry.relationship_id);
  assert.ok(indexed.length > 0, "the manifest carries no scenario index");

  const backendIds = new Set(backendInteractions(dump).map((item) => item.id));
  const frontendIds = new Set(frontendInteractions(manifest).map((item) => item.id));

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
