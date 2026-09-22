import assert from "node:assert/strict";
import test from "node:test";

import { mapActivityToOwnerInteractions } from "../lib/ownerInteractions.ts";
import { pipelineProfileHrefOf } from "../lib/applicationPipeline.ts";

const now = "2026-07-13T00:00:00Z";

/** One received application, with whatever history the case needs. */
function activityWith(overrides = {}) {
  return {
    myJobs: [
      { id: "job-1", title: "Finance editor", budget: "₹25,000 per video", type: "Remote", workMode: "Remote", tags: [] },
    ],
    myTalentListings: [],
    relatedJobs: [],
    relatedTalentListings: [],
    sentApplications: [],
    receivedApplications: [
      {
        id: "application-1",
        job_id: "job-1",
        applicant_user_id: "talent-1",
        job_owner_user_id: "owner-1",
        portfolio_item_ids: [],
        applicant_snapshot: { display_name: "Priya Nair" },
        status: "reviewing",
        participant_status: "reviewing",
        status_version: 3,
        created_at: "2026-07-10T00:00:00Z",
        updated_at: "2026-07-25T00:00:00Z",
        status_history: [],
        ...overrides,
      },
    ],
    receivedInterests: [],
    sentInterests: [],
    savedJobs: [],
    savedTalentListings: [],
  };
}

test("the activity page carries its authorized conversation into workspace actions", () => {
  const [item] = mapActivityToOwnerInteractions(
    activityWith({ conversation_id: "conversation-1" })
  );

  assert.equal(item.conversationId, "conversation-1");
});

test("an agency application names and links to its actual recruiter", () => {
  const [item] = mapActivityToOwnerInteractions({
    myJobs: [],
    myTalentListings: [],
    relatedJobs: [{
      id: "agency-job",
      title: "Editor for FitLab",
      channel: { name: "FitLab" },
      postedByAgency: true,
      managedByAgencyName: "BrightLab Media",
      channelProfileSlug: null,
      agencyProfileSlug: "dev_brightlab",
      tags: [],
    }],
    relatedTalentListings: [],
    sentApplications: [{
      id: "agency-application",
      job_id: "agency-job",
      job_owner_user_id: "agency-owner",
      status: "new",
      created_at: now,
      updated_at: now,
    }],
    receivedApplications: [],
    receivedInterests: [],
    sentInterests: [],
  });

  assert.equal(item.counterpartyName, "BrightLab Media");
  assert.equal(item.job.channelName, "FitLab");
  assert.equal(item.job.agencyProfileSlug, "dev_brightlab");
  assert.equal(pipelineProfileHrefOf(item), "/u/dev_brightlab?view=hiring");
});

test("persisted interaction history survives mapping into the Inbox timeline", () => {
  const items = mapActivityToOwnerInteractions({
    myJobs: [
      {
        id: "job-1",
        title: "Finance editor",
        budget: "₹25,000 per video",
        type: "Remote",
        workMode: "Remote",
        tags: [],
      },
    ],
    myTalentListings: [],
    relatedJobs: [],
    relatedTalentListings: [],
    sentApplications: [],
    receivedApplications: [
      {
        id: "application-1",
        job_id: "job-1",
        applicant_user_id: "talent-1",
        job_owner_user_id: "owner-1",
        portfolio_item_ids: [],
        applicant_snapshot: { display_name: "Priya Nair" },
        status: "rejected",
        participant_status: "rejected",
        status_version: 3,
        created_at: "2026-07-10T00:00:00Z",
        updated_at: now,
        status_history: [
          {
            id: "private-event",
            previous_status: "new",
            new_status: "rejected",
            status_version: 2,
            event_kind: "transition",
            audience: "manager_only",
            created_at: "2026-07-12T00:00:00Z",
          },
          {
            id: "shared-event",
            previous_status: "new",
            new_status: "rejected",
            status_version: 3,
            event_kind: "communicated",
            audience: "participants",
            created_at: now,
          },
        ],
      },
    ],
    receivedInterests: [],
    sentInterests: [],
  });

  assert.equal(items.length, 1);
  assert.deepEqual(
    items[0].timeline.map((entry) => entry.label),
    // The separator is the fix: "Not selected saved privately" read as one
    // phrase, so the visibility statement looked like part of the stage name.
    ["Application received", "Not selected · saved privately", "Not selected · shared with them"]
  );
});

test("manager-side legacy archive state survives activity mapping for resolution UI", () => {
  const [item] = mapActivityToOwnerInteractions({
    myJobs: [{ id: "job-legacy", title: "Legacy role", budget: "Flexible", type: "Remote", workMode: "Remote", tags: [] }],
    myTalentListings: [],
    relatedJobs: [],
    relatedTalentListings: [],
    sentApplications: [],
    receivedApplications: [
      {
        id: "application-legacy",
        job_id: "job-legacy",
        applicant_user_id: "talent-legacy",
        job_owner_user_id: "owner-legacy",
        portfolio_item_ids: [],
        applicant_snapshot: { display_name: "Legacy applicant" },
        status: "archived",
        participant_status: "new",
        status_version: 2,
        legacy_archive_resolution_required: true,
        created_at: "2026-07-10T00:00:00Z",
        updated_at: now,
        status_history: [],
      },
    ],
    receivedInterests: [],
    sentInterests: [],
  });

  assert.equal(item.direction, "received");
  assert.equal(item.legacyArchiveResolutionRequired, true);
  assert.equal(item.backendStatus, "archived");
});


test("a status missing from the label map never leaks its raw enum", () => {
  // This is the exact shape of the original defect: `new` was absent from an
  // inline map, fell through a `?? event.new_status` fallback, and rendered as
  // "new saved privately" — lowercase, mid-sentence, and unreadable.
  const [item] = mapActivityToOwnerInteractions(
    activityWith({
      status_history: [
        {
          id: "h1",
          new_status: "new",
          event_kind: "transition",
          audience: "manager_only",
          created_at: "2026-07-20T10:00:00Z",
        },
      ],
    })
  );
  const labels = item.timeline.map((event) => event.label);
  assert.ok(
    labels.includes("New · saved privately"),
    `expected a projected label, got ${JSON.stringify(labels)}`
  );
  for (const label of labels) {
    assert.doesNotMatch(label, /\b(new|reviewing|interviewing|rejected|hired)\b/, label);
  }
});

test("timeline entries are ordered by their instants, not by arrival", () => {
  const [item] = mapActivityToOwnerInteractions(
    activityWith({
      status_history: [
        { id: "b", new_status: "hired", event_kind: "transition", audience: "participants", created_at: "2026-07-24T10:00:00Z" },
        { id: "a", new_status: "interviewing", event_kind: "transition", audience: "participants", created_at: "2026-07-21T10:00:00Z" },
      ],
    })
  );
  const times = item.timeline.map((event) => Date.parse(event.occurredAt));
  assert.deepEqual(times, [...times].sort((x, y) => x - y));
});

test("a private decision contradicted by a later outcome is marked superseded", () => {
  // The reported timeline read `Interviewing → Not selected saved privately →
  // Hired` for one person. The private rejection is real history, so it stays —
  // but it is not current truth and must not be presented as though it were.
  const [item] = mapActivityToOwnerInteractions(
    activityWith({
      status: "hired",
      status_history: [
        { id: "a", new_status: "interviewing", event_kind: "transition", audience: "participants", created_at: "2026-07-20T10:00:00Z" },
        { id: "b", new_status: "rejected", event_kind: "transition", audience: "manager_only", created_at: "2026-07-21T10:00:00Z" },
        { id: "c", new_status: "hired", event_kind: "transition", audience: "participants", created_at: "2026-07-22T10:00:00Z" },
      ],
    })
  );
  const byId = Object.fromEntries(item.timeline.map((event) => [event.id, event]));
  assert.equal(byId.b.superseded, true, "the private rejection should be struck");
  assert.notEqual(byId.c.superseded, true, "the terminal outcome stands");
  assert.notEqual(byId.a.superseded, true, "a non-terminal stage is not superseded");
});

test("a decision the other side was actually told is never struck", () => {
  // Striking it would misrepresent what they received.
  const [item] = mapActivityToOwnerInteractions(
    activityWith({
      status: "hired",
      status_history: [
        { id: "shared", new_status: "rejected", event_kind: "communicated", audience: "participants", created_at: "2026-07-21T10:00:00Z" },
        { id: "later", new_status: "hired", event_kind: "transition", audience: "participants", created_at: "2026-07-22T10:00:00Z" },
      ],
    })
  );
  const shared = item.timeline.find((event) => event.id === "shared");
  assert.notEqual(shared.superseded, true);
});
