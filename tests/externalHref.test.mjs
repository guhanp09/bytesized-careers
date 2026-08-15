/**
 * Rendering a stored link is a separate decision from storing it.
 *
 * The storage validator arrived after the rows did. Anything written before it
 * is still in the database exactly as typed, so the render layer cannot assume
 * the write layer cleaned it — it has to fail closed on data it did not write.
 * That is the whole reason this exists as its own contract rather than as a
 * comment saying the backend already checked.
 *
 * `undefined` rather than a placeholder is the deliberate answer: an anchor
 * with no href is inert and still shows its text, so someone whose old link is
 * unusable sees their work rather than a broken page.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { safeExternalHref, safeExternalImageSrc } from "../lib/externalHref.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("a real external link is returned", () => {
  for (const url of [
    "https://example.com/work",
    "http://example.com/work",
    "https://sub.example.co.uk:8443/a?b=c#d",
  ]) {
    assert.equal(typeof safeExternalHref(url), "string", `${url} was refused`);
  }
});

test("a legacy row holding an executable scheme renders inert", () => {
  // These are the values the storage validator refuses today and that older
  // rows may still contain. None of them may become navigation.
  for (const url of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(document.domain)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "blob:https://example.com/uuid",
  ]) {
    assert.equal(safeExternalHref(url), undefined, `${url} became a link`);
  }
});

test("credentials and unusable values are refused", () => {
  for (const url of [
    "https://user:pass@example.com/",
    "https://user@example.com/",
    "//evil.example/work",
    "/you",
    "example.com/work",
    "",
    "   ",
    null,
    undefined,
    42,
    {},
  ]) {
    assert.equal(safeExternalHref(url), undefined, `${String(url)} became a link`);
  }
});

test("image sources are decided separately from navigation", () => {
  // Today both accept exactly http(s). They are distinct functions so that
  // loosening one later cannot silently loosen the other: a `data:` image is
  // inline bytes, a `data:` href is navigation carrying this origin.
  assert.equal(safeExternalImageSrc("https://cdn.example.com/a.png"), "https://cdn.example.com/a.png");
  assert.equal(safeExternalImageSrc("javascript:alert(1)"), undefined);
});

test("every sink fed by a stored URL goes through the guard", () => {
  // One missed sink is a live injection point, and these are the components
  // that render links a user supplied.
  const sinks = [
    "components/profile/ProfileExperienceList.tsx",
    "components/profile/PublicProfileTabs.tsx",
    "components/you/PortfolioPreview.tsx",
    "components/project/ProjectDetailPage.tsx",
    "components/you/ReceivedApplicationsClient.tsx",
    "components/first-message/FirstMessageSummary.tsx",
    "components/admin/AdminVerificationClient.tsx",
  ];

  for (const path of sinks) {
    const source = read(path);
    assert.match(source, /safeExternalHref/, `${path} does not guard its links`);
    assert.doesNotMatch(
      source,
      /href=\{(?:link|item|selected)\.(?:url|proof_url)\}/,
      `${path} still renders a stored URL directly`
    );
  }
});
