import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), "utf8");

test("the realtime client uses an authenticated subprotocol instead of a token query string", () => {
  const source = read("lib/realtimeMessaging.ts");
  assert.match(source, /new WebSocket\(realtimeUrl\(\), \[SOCKET_SUBPROTOCOL, this\.accessToken\]\)/);
  assert.doesNotMatch(source, /access_token=/);
  assert.match(source, /forceClose\(\)/);
  assert.match(source, /const key = `\$\{backendUserId\}:\$\{accessToken\}`/);
});

test("the realtime client uses bounded reconnects and throttles typing transport", () => {
  const source = read("lib/realtimeMessaging.ts");
  assert.match(source, /MAX_RECONNECT_DELAY_MS = 8_000/);
  assert.match(source, /Math\.min\(500 \* 2 \*\* this\.reconnectAttempt, MAX_RECONNECT_DELAY_MS\)/);
  assert.match(source, /TYPING_THROTTLE_MS = 650/);
  assert.match(source, /if \(now - lastSentAt < TYPING_THROTTLE_MS\) return/);
  assert.match(source, /event\.code === 4401 \|\| event\.code === 4403/);
});

test("one authenticated socket handshake produces one canonical connected event", () => {
  const source = read("lib/realtimeMessaging.ts");
  assert.doesNotMatch(source, /listener\(\{ type: "connected"/);
});

test("both Inbox surfaces reconcile real-time events and retain HTTP fallback polling", () => {
  const workspace = read("components/you/ApplicationsWorkspace.tsx");
  const dock = read("components/you/CompactChatDock.tsx");
  for (const source of [workspace, dock]) {
    assert.match(source, /useRealtimeMessaging\(/);
    assert.match(source, /conversation\.typing/);
    assert.match(source, /conversation\.read_progress/);
    assert.match(source, /realtimeStateRef\.current === "connected" \? 15_000/);
    assert.match(source, /realtimeStateRef\.current = realtimeState/);
    assert.match(source, /read_by_recipient/);
  }
  assert.match(workspace, /data-testid="block-user-confirmation"/);
  assert.match(workspace, /You blocked \$\{firstNameOf/);
});
