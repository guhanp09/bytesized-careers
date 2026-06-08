import test from "node:test";
import assert from "node:assert/strict";

import {
  decodeExperienceHtmlEntities,
  initialsForExperience,
  resolveExperienceOrganizationName,
} from "../lib/profileExperience.ts";

test("decodes instagram metadata entities before cleanup", () => {
  assert.equal(decodeExperienceHtmlEntities("Vika (&#064;vkgoeswild)"), "Vika (@vkgoeswild)");
});

test("cleans instagram display name with handle and suffix", () => {
  assert.equal(
    resolveExperienceOrganizationName({
      rawName: "Vika (@vkgoeswild) • Instagram photos and videos",
      platform: "Instagram",
      normalizedUrl: "https://www.instagram.com/vkgoeswild",
    }),
    "Vika"
  );
});

test("cleans instagram display name with escaped handle", () => {
  assert.equal(
    resolveExperienceOrganizationName({
      rawName: "Vika (&#064;vkgoeswild) • Instagram photos and videos",
      platform: "Instagram",
      normalizedUrl: "https://www.instagram.com/vkgoeswild",
    }),
    "Vika"
  );
});

test("keeps instagram handle when no display name exists", () => {
  assert.equal(
    resolveExperienceOrganizationName({
      rawName: "@vkgoeswild • Instagram photos and videos",
      platform: "Instagram",
      normalizedUrl: "https://www.instagram.com/vkgoeswild",
    }),
    "@vkgoeswild"
  );
});

test("cleans instagram pipe suffix", () => {
  assert.equal(
    resolveExperienceOrganizationName({
      rawName: "Vika | Instagram",
      platform: "Instagram",
      normalizedUrl: "https://www.instagram.com/vkgoeswild",
    }),
    "Vika"
  );
});

test("falls back to instagram handle for unusable metadata", () => {
  assert.equal(
    resolveExperienceOrganizationName({
      rawName: "Login • Instagram",
      platform: "Instagram",
      normalizedUrl: "https://www.instagram.com/vkgoeswild",
    }),
    "@vkgoeswild"
  );
});

test("falls back to instagram handle when metadata is absent", () => {
  assert.equal(
    resolveExperienceOrganizationName({
      rawName: null,
      platform: "Instagram",
      normalizedUrl: "https://www.instagram.com/vkgoeswild",
    }),
    "@vkgoeswild"
  );
});

test("initials use the cleaned instagram name", () => {
  const cleaned = resolveExperienceOrganizationName({
    rawName: "Vika (&#064;vkgoeswild) • Instagram photos and videos",
    platform: "Instagram",
    normalizedUrl: "https://www.instagram.com/vkgoeswild",
  });

  assert.equal(cleaned, "Vika");
  assert.equal(initialsForExperience(cleaned), "V");
});
