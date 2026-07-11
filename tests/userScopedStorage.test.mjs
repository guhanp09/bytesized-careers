import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { userStorageKey } from "../lib/userScopedStorage.ts";

// Regression coverage for the "notifications say messages exist but the Inbox
// looks empty" defect: client-persisted inbox state (workspace mode/view,
// selected thread, chat dock, private-note cache) leaked across QA personas via
// global localStorage keys, steering the next persona into the wrong inbox mode.
// Every persisted key must be scoped per backend user, and a persona switch must
// land on the persona's own start route instead of re-interpreting the previous
// persona's URL (mode/thread params) under the new identity.

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relPath) => readFileSync(join(repoRoot, relPath), "utf8");

test("userStorageKey scopes by backend user id with a local fallback", () => {
  assert.equal(userStorageKey("cj.applications.workspace", "user-1"), "cj.applications.workspace::user-1");
  assert.equal(userStorageKey("cj.applications.workspace", "  user-2  "), "cj.applications.workspace::user-2");
  // Signed-out / demo sessions share one neutral bucket instead of a global key.
  assert.equal(userStorageKey("cj.applications.workspace", undefined), "cj.applications.workspace::local");
  assert.equal(userStorageKey("cj.applications.workspace", null), "cj.applications.workspace::local");
  assert.equal(userStorageKey("cj.applications.workspace", "  "), "cj.applications.workspace::local");
});

test("the applications workspace shape is persisted per backend user", () => {
  const source = read("components/applications/ApplicationsPageClient.tsx");
  assert.match(source, /userStorageKey\(STORAGE_KEY, backendUserId\)/);
  assert.match(source, /purgeLegacyStorageKey\(STORAGE_KEY\)/);
  // The raw global key must never be read or written directly anymore.
  assert.ok(!source.includes("localStorage.getItem(STORAGE_KEY)"), "reads must go through the scoped key");
  assert.ok(!source.includes("localStorage.setItem(STORAGE_KEY,"), "writes must go through the scoped key");
});

test("the inbox selection and chat dock persist per backend user", () => {
  const workspace = read("components/you/ApplicationsWorkspace.tsx");
  assert.match(workspace, /userStorageKey\(SELECTED_STORAGE_KEY, backendUserId\)/);
  assert.match(workspace, /purgeLegacyStorageKey\(SELECTED_STORAGE_KEY\)/);
  assert.match(workspace, /backendUserId=\{backendUserId\}/);
  assert.match(workspace, /storageOwnerId=\{backendUserId\}/);

  const dock = read("components/you/CompactChatDock.tsx");
  assert.match(dock, /userStorageKey\(DOCK_STORAGE_KEY, backendUserId\)/);
  assert.match(dock, /purgeLegacyStorageKey\(DOCK_STORAGE_KEY\)/);
});

test("the private-note cache is keyed by note owner", () => {
  const lib = read("lib/privateNotes.ts");
  assert.match(lib, /userStorageKey\(STORAGE_KEY, ownerId\)/);
  assert.match(lib, /loadNotes\(\s*ownerId/);
  const panel = read("components/you/PrivateNotesPanel.tsx");
  assert.match(panel, /loadNotes\(storageOwnerId, conversationId\)/);
  assert.match(panel, /saveNotes\(storageOwnerId, conversationId/);
});

test("the applications page hands the backend user id down from the server session", () => {
  const page = read("app/applications/page.tsx");
  assert.match(page, /backendUserId=\{session\.backendUserId\}/);
});

test("a persona switch lands on the persona's start route, never the previous persona's URL", () => {
  const drawer = read("components/qa/QaPersonaDrawer.tsx");
  assert.match(drawer, /window\.location\.assign\(persona\.startRoute \|\| "\/you"\)/);
  assert.ok(!drawer.includes("window.location.reload()"), "switch/exit must not reload the prior persona's URL");
});

test("an empty inbox mode surfaces the other mode's conversations instead of a dead end", () => {
  const workspace = read("components/you/ApplicationsWorkspace.tsx");
  assert.match(workspace, /data-testid="inbox-other-mode-hint"/);
  assert.match(workspace, /data-testid="inbox-other-mode-switch"/);
  // The hint counts real fetched items for the other mode — never mock data.
  assert.match(workspace, /items\.filter\(\(item\) => item\.mode === otherMode\)/);
});
