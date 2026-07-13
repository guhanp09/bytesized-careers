import assert from "node:assert/strict";
import test from "node:test";

import { mapActivityToOwnerInteractions } from "../lib/ownerInteractions.ts";

const now = "2026-07-13T00:00:00Z";

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
    ["Application received", "Not selected saved privately", "Not selected shared"]
  );
});
