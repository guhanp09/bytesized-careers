import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("Post Job presents only an implemented organization-verification method", () => {
  const source = read("components/PostJobPage.tsx");

  assert.match(source, /Confirm with public code/);
  assert.doesNotMatch(source, /Sign in as this channel\/page|Coming soon/);
});

test("profile platform actions are explicit per platform", () => {
  const row = read("components/profile/PlatformLogosRow.tsx");
  const profile = read("components/you/YouHubClient.tsx");

  assert.match(row, /platformActions\?: Partial<Record<PlatformKey, PlatformActions>>/);
  assert.match(row, /platformActions\?\.\[platform\.key\]/);
  assert.match(row, /action\?\.connect/);
  assert.match(row, /action\?\.disconnect/);
  assert.doesNotMatch(row, /onConnectAccount|onRemoveAccount/);

  assert.match(profile, /youtube:\s*\{\s*connect: startYouTubeConnectFlow,\s*disconnect: disconnectYouTubeFromProfile/);
  assert.doesNotMatch(
    profile,
    /Instagram connection is not configured|Instagram account[^\n]+not available yet|TODO: Wire to backend endpoint/
  );
});

test("Instagram is represented as a public profile link, not a provider connection", () => {
  const settings = read("components/settings/SettingsClient.tsx");
  const settingsPage = read("app/settings/page.tsx");

  assert.match(settings, /title="Accounts & profile links"/);
  assert.match(settings, /title="Instagram profile link"/);
  assert.match(settings, /This is not an Instagram account connection or verification\./);
  assert.match(settings, /\? "Added" : "Not set"/);
  assert.doesNotMatch(settings, /shown as a connected profile link/);
  assert.doesNotMatch(settingsPage, /connected accounts/i);
});
