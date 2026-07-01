import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKFLOW_ACTIONS,
  WORKFLOW_ACTION_IDS,
  getWorkflowAction,
  summarizeWorkflow,
} from "../lib/devWorkflows.ts";

test("the workflow catalog covers the required cross-persona flows", () => {
  assert.deepEqual(
    WORKFLOW_ACTION_IDS.sort(),
    [
      "apply-to-job",
      "reply-to-application",
      "reply-to-hiring-request",
      "send-hiring-request",
      "send-message",
    ].sort()
  );
});

test("apply/hire defaults are recipient-distinct (actor != target)", () => {
  for (const action of WORKFLOW_ACTIONS) {
    assert.notEqual(action.actorKey, action.targetKey, `${action.id} must cross personas`);
  }
  assert.equal(getWorkflowAction("apply-to-job").actorKey, "talent-complete");
  assert.equal(getWorkflowAction("apply-to-job").targetKey, "recruiter-active");
  assert.equal(getWorkflowAction("send-hiring-request").actorKey, "recruiter-active");
});

test("messaging is now a real, supported workflow", () => {
  const message = getWorkflowAction("send-message");
  assert.equal(message.supported, true);
  assert.ok(message.note);
});

test("summarizeWorkflow renders pass/fail clearly", () => {
  const passing = summarizeWorkflow({
    ok: true,
    checks: [
      { label: "a", ok: true },
      { label: "b", ok: true },
    ],
  });
  assert.deepEqual(passing, { ok: true, passed: 2, total: 2, label: "Passed 2/2" });

  const failing = summarizeWorkflow({
    ok: false,
    checks: [
      { label: "a", ok: true },
      { label: "b", ok: false },
    ],
  });
  assert.equal(failing.ok, false);
  assert.equal(failing.label, "Failed 1/2");

  const unsupported = summarizeWorkflow({ ok: false, checks: [] });
  assert.equal(unsupported.label, "Not supported");

  assert.equal(summarizeWorkflow(null).label, "No result");
  assert.equal(summarizeWorkflow({ error: "boom" }).label, "Error");
});
