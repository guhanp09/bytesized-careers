import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("header notifications dropdown uses compact accessible rows", () => {
  const source = read("components/Header.tsx");

  assert.match(source, /aria-haspopup="dialog"/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /notifications-popover-title/);
  assert.match(source, /data-testid="notification-row"/);
  assert.match(source, /data-testid="notification-unread-dot"/);
  assert.match(source, /Unread notification/);
  assert.match(source, /Read notification/);
  assert.match(source, /View all notifications/);
  assert.match(source, /grid-cols-\[40px_minmax\(0,1fr\)\]/);
  assert.match(source, /absolute left-1\.5 top-\[27px\]/);
  assert.doesNotMatch(source, /grid-cols-\[8px_40px_minmax\(0,1fr\)\]/);
});

test("header notifications dropdown is not grouped into YouTube sections", () => {
  const source = read("components/Header.tsx");

  assert.doesNotMatch(source, /Important/);
  assert.doesNotMatch(source, /More notifications/);
  assert.match(source, /notifications\.slice\(0, 8\)/);
});
