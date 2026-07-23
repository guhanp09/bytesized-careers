import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(repoRoot, path), "utf8");

/**
 * Guards for the decision-note work: an explanation attached to a shared
 * outcome must reach the other participant through the authoritative request,
 * and must never be faked into local state when nothing was sent.
 */

test("a hiring-request decline sends its note through the transition request", () => {
  const workspace = read("components/you/ApplicationsWorkspace.tsx");
  // The confirm dialog only offers a note where the action actually shares.
  assert.match(workspace, /allowNote: live\s*\n\s*\? item\.kind === "hiring_request" && destructive/);
  // ...and that note is handed to the backend call, not to local state.
  assert.match(workspace, /trimmedNote \|\| undefined/);

  const client = read("lib/backendClient.ts");
  assert.match(client, /export async function transitionTalentInterestStatus\([\s\S]*?note\?: string/);
  assert.match(
    client,
    /transitionTalentInterestStatus[\s\S]*?idempotency_key: idempotencyKey,\s*\n\s*\.\.\.\(note \? \{ note \} : \{\}\)/
  );
});

test("live status commits never append an unsent note to local state", () => {
  const workspace = read("components/you/ApplicationsWorkspace.tsx");
  // Every live-mode commit passes `undefined` for the local note; only the
  // demo-mode call at the end of applyStatusAction may append one.
  const liveNoteAppends = workspace.match(/commitStatusLocally\(target, action, trimmedNote, \{/g);
  assert.equal(
    liveNoteAppends,
    null,
    "live commitStatusLocally calls must not forward a note into local replies"
  );
  assert.match(workspace, /commitStatusLocally\(target, action, trimmedNote\);/);
});

test("sharing an application decision carries the note atomically", () => {
  const workspace = read("components/you/ApplicationsWorkspace.tsx");
  assert.match(workspace, /data-testid="stage-notify-note"/);
  assert.match(workspace, /sendStatusUpdates\(notifyPromptItems, notifyPrompt\.stageKey, notifyNote\)/);
  assert.match(workspace, /note\?\.trim\(\) \|\| undefined/);

  const client = read("lib/backendClient.ts");
  assert.match(client, /export async function communicateApplicationStatus\([\s\S]*?note\?: string/);
});

test("the notify prompt never claims success for an unsupported kind", () => {
  const workspace = read("components/you/ApplicationsWorkspace.tsx");
  // The old silent `continue` let the success toast fire regardless.
  assert.doesNotMatch(workspace, /if \(target\.kind !== "application"\) continue;/);
  assert.match(workspace, /const unsupported = targets\.filter\(\(target\) => target\.kind !== "application"\)/);
  assert.match(workspace, /phase: "error",\s*\n\s*errorMessage:/);
  assert.match(workspace, /data-testid="stage-notify-error"/);
});

test("Pipeline confirms the same consequential moves the Inbox does", () => {
  const board = read("components/you/PipelineBoard.tsx");
  assert.match(board, /const CONFIRMED_STAGE_MOVES = \["hired", "accepted", "declined", "rejected"\]/);
  assert.match(board, /if \(CONFIRMED_STAGE_MOVES\.includes\(stageKey\)\)/);
  // A private "not selected" must not claim it was shared.
  assert.match(board, /This is saved privately\. You choose separately whether to tell the applicant\./);
});

test("dead status-update and manager-note client helpers are gone", () => {
  const client = read("lib/backendClient.ts");
  for (const name of [
    "sendConversationStatusUpdate",
    "updateApplicationManagerNote",
    "updateTalentInterestManagerNote",
  ]) {
    assert.doesNotMatch(client, new RegExp(`function ${name}\\b`), `${name} should be removed`);
  }
});
