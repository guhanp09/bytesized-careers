/**
 * An import may never wait forever.
 *
 * A live import was watched for two minutes and reached nothing: no question, no
 * draft, no failure. The backend had finished. The screen had not noticed,
 * because the code that notices lived inside a timer that only ran while there
 * was nothing to notice:
 *
 *     if (phase !== "processing" || draft.processing_status !== "processing") return;
 *     setTimeout(() => { if (terminal) open(draft); }, 1200);
 *
 * A second reader — a four-second heartbeat refreshing the same draft — usually
 * delivered the finished status first. That flipped the guard, the effect tore
 * down its timer, and the branch that opens the draft went with it. Nothing was
 * left scheduled. The spinner stayed until the recruiter gave up.
 *
 * These tests pin the replacement: settlement is a pure function of the phase
 * and the status, so it cannot depend on which reader won a race. The property
 * that matters is the last test in the first group — *every* backend status
 * reachable while processing names a destination, and only the two that mean
 * "still working" are allowed to wait.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        !/\.[a-z0-9]+$/i.test(specifier)
      ) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});

const {
  IMPORT_PHASES,
  IMPORT_PROCESSING_STATUSES,
  OPENABLE_STATUSES,
  backendHasSettled,
  settlementFor,
} = await import("../lib/importJob/settlement.ts");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** The statuses that legitimately mean "the backend is still working". */
const IN_FLIGHT = ["awaiting_processing", "processing"];

test("the status vocabulary matches the backend literal exactly", () => {
  // Drift here is how an unhandled status becomes a permanent spinner. The
  // backend's Pydantic literal is the authority; this list mirrors it.
  const schema = readFileSync(
    new URL("../backend/app/schemas/job_import.py", import.meta.url),
    "utf8"
  );
  const block = schema.slice(
    schema.indexOf("JobImportProcessingStatus = Literal["),
    schema.indexOf("JobImportValidationStatus")
  );
  const declared = [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

  assert.deepEqual(
    [...IMPORT_PROCESSING_STATUSES].sort(),
    declared.sort(),
    "lib/importJob/settlement.ts has drifted from the backend status literal"
  );
});

test("only a genuinely in-flight backend status may keep the screen waiting", () => {
  // The central invariant. Every other status names somewhere to go.
  for (const status of IMPORT_PROCESSING_STATUSES) {
    const settlement = settlementFor("processing", status);
    if (IN_FLIGHT.includes(status)) {
      assert.equal(settlement, "keep_waiting", status);
    } else {
      assert.notEqual(
        settlement,
        "keep_waiting",
        `${status} left the screen waiting on work the backend has finished`
      );
    }
  }
});

test("a settled backend status is never described as still running", () => {
  for (const status of IMPORT_PROCESSING_STATUSES) {
    assert.equal(backendHasSettled(status), !IN_FLIGHT.includes(status), status);
  }
});

test("every phase and status pair resolves to a defined settlement", () => {
  const allowed = new Set([
    "keep_waiting",
    "open_draft",
    "show_failure",
    "start_over",
    "idle",
  ]);
  for (const phase of IMPORT_PHASES) {
    for (const status of IMPORT_PROCESSING_STATUSES) {
      const settlement = settlementFor(phase, status);
      assert.ok(allowed.has(settlement), `${phase}/${status} -> ${settlement}`);
    }
  }
});

test("a finished draft opens no matter which reader delivered the status", () => {
  // The regression itself. Before the fix this depended on whether the 1.2s
  // timer or the 4s heartbeat observed the transition first.
  for (const status of OPENABLE_STATUSES) {
    assert.equal(settlementFor("processing", status), "open_draft", status);
  }
});

test("a failed extraction becomes a failure the recruiter can act on", () => {
  assert.equal(settlementFor("processing", "processing_failed"), "show_failure");
});

test("a draft that was discarded or superseded stops the wait", () => {
  // Neither will ever report again. Waiting on them is waiting on nothing —
  // previously an unhandled status and therefore an unbounded spinner.
  assert.equal(settlementFor("processing", "discarded"), "start_over");
  assert.equal(settlementFor("processing", "superseded"), "start_over");
});

test("a settled screen is not moved by a late background read", () => {
  // A recruiter reading a failure, or already handing off, must not be yanked
  // elsewhere by a poll that resolves afterwards.
  for (const phase of ["entry", "creating", "failure", "applying"]) {
    for (const status of IMPORT_PROCESSING_STATUSES) {
      assert.equal(settlementFor(phase, status), "idle", `${phase}/${status}`);
    }
  }
});

test("the client waits longer than the server's own worst case", () => {
  // The client used to abandon `POST /process` at 120s while the server allowed
  // one 90s extraction plus one 90s retry. A slow-but-successful import
  // returned at ~150s, by which time the screen had shown a failure and stopped
  // looking — so a completed draft was reported as a failed one and lost.
  const client = read("lib/jobImportReadiness.ts");
  const budget = Number(
    /JOB_IMPORT_PROCESSING_TIMEOUT_MS = ([\d_]+)/.exec(client)[1].replace(/_/g, "")
  );

  const config = readFileSync(
    new URL("../backend/app/core/config.py", import.meta.url),
    "utf8"
  );
  const providerBlock = config.slice(config.indexOf("openai_request_timeout_seconds"));
  const perAttempt = Number(/default=([\d.]+)/.exec(providerBlock)[1]);
  const retryBlock = config.slice(config.indexOf("openai_max_retries"));
  const retries = Number(/default=(\d+)/.exec(retryBlock)[1]);

  const serverWorstCaseMs = perAttempt * (1 + retries) * 1000;
  assert.ok(
    budget > serverWorstCaseMs,
    `client budget ${budget}ms does not cover the server's ${serverWorstCaseMs}ms worst case`
  );
});

test("the screen keeps reading while the backend is still working", () => {
  const page = read("components/import-job/ImportJobPageClient.tsx");

  // A rejected read must re-arm rather than end the loop. Without this, one
  // failed poll leaves nothing scheduled and the screen waits on a reader that
  // has already stopped.
  assert.match(page, /catch\(\(\) => setPollTick\(\(tick\) => tick \+ 1\)\)/);
  assert.match(page, /backendHasSettled\(draft\.processing_status\)/);
});

test("the recruiter is never shown a technical reason for a stalled import", () => {
  const page = read("components/import-job/ImportJobPageClient.tsx");
  const messages = [...page.matchAll(/^const [A-Z_]+_MESSAGE =\n?\s*"([^"]+)"/gm)].map(
    (m) => m[1]
  );

  assert.ok(messages.length >= 2);
  for (const message of messages) {
    assert.doesNotMatch(
      message,
      /openai|gpt|provider|cloudflare|traceback|exception|enum|status code|processing_failed|superseded/i,
      message
    );
    // Every failure message has to leave the recruiter somewhere to go.
    assert.match(message, /retry|paste|continue|start it again/i, message);
  }
});
