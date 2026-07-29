import test from "node:test";
import assert from "node:assert/strict";

import { isSafeHref, splitAnswerLinks } from "../lib/answerLinks.ts";

/**
 * Links inside text the counterparty wrote.
 *
 * A screening answer is very often "here is the reel: <url>", so leaving them
 * inert taxes every application — and making every one clickable would honour
 * whatever scheme the sender chose. These hold the line between the two.
 */

const linksIn = (text) =>
  splitAnswerLinks(text)
    .filter((segment) => segment.kind === "link")
    .map((segment) => segment.href);

const render = (text) => splitAnswerLinks(text).map((segment) => segment.value).join("");

test("nothing is lost or added, whatever the text", () => {
  // The strongest property: segments always reassemble into the original. A
  // renderer built on this cannot drop half a sentence or duplicate a word.
  for (const text of [
    "See https://folio.scenario.invalid/reel for the cut.",
    "no links here at all",
    "https://a.invalid https://b.invalid",
    "javascript:alert(1)",
    "trailing punctuation (https://a.invalid/x).",
    "",
    "   ",
    "https://",
    "a://b://c",
  ]) {
    assert.equal(render(text), text, `round-trip failed for ${JSON.stringify(text)}`);
  }
});

test("http and https become links", () => {
  assert.deepEqual(linksIn("Reel: https://folio.scenario.invalid/reel"), [
    "https://folio.scenario.invalid/reel",
  ]);
  assert.deepEqual(linksIn("Old site http://folio.scenario.invalid"), [
    "http://folio.scenario.invalid",
  ]);
});

test("a scripting scheme is shown but never made clickable", () => {
  // The whole point: it stays visible, so a reviewer can see what was sent,
  // and stays inert, so seeing it costs nothing.
  for (const hostile of [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
  ]) {
    assert.deepEqual(linksIn(`Reach me at ${hostile}`), [], hostile);
    assert.ok(render(`Reach me at ${hostile}`).includes(hostile), `${hostile} was dropped`);
  }
});

test("the label is exactly what was typed", () => {
  // A link that displays one destination and carries another is the oldest
  // trick there is; equality here forecloses it.
  const url = "https://folio.scenario.invalid/a?b=c&d=e";
  const [link] = splitAnswerLinks(`see ${url}`).filter((s) => s.kind === "link");
  assert.equal(link.value, url);
  assert.equal(link.href, url);
});

test("a full stop after a link belongs to the sentence", () => {
  assert.deepEqual(linksIn("Watch https://folio.scenario.invalid/reel."), [
    "https://folio.scenario.invalid/reel",
  ]);
  assert.deepEqual(linksIn("Watch (https://folio.scenario.invalid/reel)."), [
    "https://folio.scenario.invalid/reel",
  ]);
  assert.equal(render("Watch https://folio.scenario.invalid/reel."), "Watch https://folio.scenario.invalid/reel.");
});

test("several links in one answer are all found", () => {
  assert.deepEqual(
    linksIn("one https://a.invalid/x and two https://b.invalid/y, that is all"),
    ["https://a.invalid/x", "https://b.invalid/y"]
  );
});

test("a bare domain is not promoted to a link", () => {
  // Guessing at bare hostnames turns "plate.and.pan" and the end of a sentence
  // into links nobody wrote.
  assert.deepEqual(linksIn("find me at folio.scenario.invalid"), []);
  assert.deepEqual(linksIn("I work on Plate.And.Pan mostly"), []);
});

test("isSafeHref answers the same question on its own", () => {
  assert.equal(isSafeHref("https://a.invalid"), true);
  assert.equal(isSafeHref("http://a.invalid"), true);
  assert.equal(isSafeHref("javascript:alert(1)"), false);
  assert.equal(isSafeHref("not a url"), false);
  assert.equal(isSafeHref(""), false);
});

test("no segment carries markup, because none is built", () => {
  // Segments, never an HTML string — so there is nothing for a caller to hand
  // to dangerouslySetInnerHTML.
  const segments = splitAnswerLinks("<img src=x onerror=alert(1)> https://a.invalid");
  for (const segment of segments) {
    assert.ok(["text", "link"].includes(segment.kind));
    assert.equal(typeof segment.value, "string");
  }
  assert.equal(render("<img src=x onerror=alert(1)> https://a.invalid"), "<img src=x onerror=alert(1)> https://a.invalid");
});
