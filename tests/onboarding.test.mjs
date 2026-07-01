import test from "node:test";
import assert from "node:assert/strict";

import { intentToMode, hasChosenIntent, nextStepFor } from "../lib/onboarding.ts";

test("intentToMode maps decisive intents and abstains otherwise", () => {
  assert.equal(intentToMode("HIRING_CREATOR_TALENT"), "hiring");
  assert.equal(intentToMode("LOOKING_FOR_WORK"), "talent");
  assert.equal(intentToMode("BOTH"), null);
  assert.equal(intentToMode("DECIDE_LATER"), null);
  assert.equal(intentToMode(null), null);
  assert.equal(intentToMode(undefined), null);
});

test("hasChosenIntent is true only once an explicit choice has been recorded (timestamp set)", () => {
  assert.equal(hasChosenIntent("2026-06-24T00:00:00Z"), true);
});

test("hasChosenIntent treats any user without a timestamp as not-yet-prompted (incl. existing users)", () => {
  // No timestamp = never explicitly chose, regardless of the default intent value,
  // so pre-existing users get the one-time prompt on their next visit.
  assert.equal(hasChosenIntent(null), false);
  assert.equal(hasChosenIntent(undefined), false);
  assert.equal(hasChosenIntent(""), false);
});

test("nextStepFor (hiring) nudges to post a job until one exists", () => {
  const step = nextStepFor({ mode: "hiring", hasJob: false, profileComplete: false });
  assert.equal(step?.key, "post-job");
  assert.equal(step?.ctaHref, "/post-job");

  assert.equal(nextStepFor({ mode: "hiring", hasJob: true, profileComplete: false }), null);
});

test("nextStepFor (talent) nudges to create a listing until the profile is complete", () => {
  const step = nextStepFor({ mode: "talent", hasJob: false, profileComplete: false });
  assert.equal(step?.key, "create-listing");
  assert.equal(step?.ctaHref, "/post-talent");

  assert.equal(nextStepFor({ mode: "talent", hasJob: false, profileComplete: true }), null);
});

test("nextStepFor keys on the visible mode, not job/profile state of the other side", () => {
  // A hiring view ignores profileComplete; a talent view ignores hasJob.
  assert.equal(nextStepFor({ mode: "hiring", hasJob: false, profileComplete: true })?.key, "post-job");
  assert.equal(nextStepFor({ mode: "talent", hasJob: true, profileComplete: false })?.key, "create-listing");
});
