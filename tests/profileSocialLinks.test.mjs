import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSocialIconLinks,
  normalizeSocialProfileUrl,
} from "../lib/profileSocialLinks.ts";

test("normalizes protocol-less Instagram URLs and extracts the handle", () => {
  const result = normalizeSocialProfileUrl("instagram.com/guhanpurushothaman");

  assert.equal(result.ok, true);
  assert.equal(result.url, "https://instagram.com/guhanpurushothaman");
  assert.equal(result.detection.platform, "instagram");
  assert.equal(result.detection.handle, "@guhanpurushothaman");
});

test("detects YouTube handles for accessible social labels", () => {
  const result = normalizeSocialProfileUrl("https://youtube.com/@guhanable");

  assert.equal(result.ok, true);
  assert.equal(result.detection.platform, "youtube");
  assert.equal(result.detection.handle, "@guhanable");
});

test("rejects unsafe social URL schemes", () => {
  const result = normalizeSocialProfileUrl("javascript:alert(1)");

  assert.equal(result.ok, false);
  assert.equal(result.error, "Use a safe public URL.");
});

test("builds social icon links with platform specific labels", () => {
  const links = buildSocialIconLinks({
    publicLinks: ["instagram.com/guhanpurushothaman", "youtube.com/@guhanable"],
  });

  assert.equal(links.length, 2);
  assert.equal(links[0].label, "Instagram · @guhanpurushothaman");
  assert.equal(links[0].icon, "instagram");
  assert.equal(links[1].label, "YouTube · @guhanable");
  assert.equal(links[1].icon, "youtube");
});
