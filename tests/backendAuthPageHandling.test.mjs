import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("notifications page separates auth/load errors from genuine empty notifications", () => {
  const source = read("app/notifications/page.tsx");

  assert.match(source, /notifications-auth-expired/);
  assert.match(source, /notifications-load-error/);
  assert.match(source, /NotificationList/);
  assert.doesNotMatch(source, /\.catch\(\(\) => \(\{\s*items:\s*\[\]/s);
});

test("saved page separates auth/load errors from genuine empty saved items", () => {
  const source = read("app/saved/page.tsx");

  assert.match(source, /saved-auth-expired/);
  assert.match(source, /saved-load-error/);
  assert.match(source, /SavedLibraryClient/);
  assert.doesNotMatch(source, /listMySavedJobs\(token\)\.catch\(\(\) => \[\]\)/);
  assert.doesNotMatch(source, /listMySavedTalent\(token\)\.catch\(\(\) => \[\]\)/);
});
