/**
 * The paste box collects text. It does not decide what the text means.
 *
 * Everything intelligent about an import happens on the server: the evidence
 * spans, the provider contract, the deterministic readers, the questions. The
 * browser's one job is to hand over what the recruiter supplied, and its
 * normalization exists so the character counter and the box agree with what
 * will actually be read — not so the server can rely on it. The server runs the
 * identical rules on arrival, which is why an import through any other client
 * is understood exactly as well.
 *
 * These tests pin that contract from the browser's side: the same shapes a
 * recruiter really pastes — a LinkedIn post with emoji rows, a forwarded email,
 * a WhatsApp note with CRLF line endings — and the invariant that decoration is
 * removed while the recruiter's own words, emoji included, are not.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_IMPORT_CHARS,
  normalizeImportText,
} from "../lib/importJob/normalize.ts";

test("a hiring post's emoji row labels do not hide the fact underneath", () => {
  const { text } = normalizeImportText(
    "\u{1F680} We're hiring a Video Editor!\n" +
      "\u{1F4CD} Location: Chennai (on-site)\n" +
      "\u{1F4B0} Compensation: ₹30,000 – ₹40,000 per month\n" +
      "⏳ Experience: 1 to 2 years\n"
  );

  // Each of these is a labelled row the server reads. Left with its emoji, the
  // label no longer starts the line and the row stops being one.
  for (const line of text.split("\n")) {
    assert.ok(
      !/^[\u{1F300}-\u{1FAFF}☀-➿]/u.test(line),
      `line still opens with decoration: ${line}`
    );
  }
  assert.match(text, /^Compensation: /m);
  assert.match(text, /^Experience: 1 to 2 years$/m);
});

test("an emoji the recruiter wrote into a sentence is theirs and stays", () => {
  const { text } = normalizeImportText("We ship fast \u{1F680} every single week");

  assert.match(text, /\u{1F680}/u);
});

test("bullet glyphs become one bullet syntax", () => {
  const { text } = normalizeImportText(
    "• Edit weekly videos\n▪ Write captions\n- Publish on Fridays"
  );

  assert.deepEqual(text.split("\n"), [
    "- Edit weekly videos",
    "- Write captions",
    "- Publish on Fridays",
  ]);
});

test("a copied email keeps its lines and loses its invisible characters", () => {
  const { text } = normalizeImportText(
    "Subject: Fwd: Video Editor opening\r\n" +
      "Experience: 1 to 2 years\r\n" +
      "Compensation:​ ₹30,000 per month\r\n"
  );

  assert.ok(!text.includes("\r"), "carriage returns survived");
  assert.ok(!text.includes(" "), "a non-breaking space survived");
  assert.ok(!text.includes("​"), "a zero-width space survived");
  assert.match(text, /^Experience: 1 to 2 years$/m);
  assert.equal(text.trimEnd().split("\n").length, 3);
});

test("smart quotes become the ones a regex can match", () => {
  const { text } = normalizeImportText("Pay is ‘₹20k’ a “month”");

  assert.equal(text, "Pay is '₹20k' a \"month\"");
});

test("normalizing twice changes nothing", () => {
  // The server normalizes on arrival too. If a second pass moved the text, the
  // recruiter would be looking at one string and the import would read another.
  const once = normalizeImportText(
    "\u{1F4B0} Compensation: ₹30,000\r\n• Edit​ videos  weekly\n"
  ).text;

  assert.equal(normalizeImportText(once).text, once);
});

test("an oversized paste is cut at the boundary without splitting a character", () => {
  // Emoji, so the cut lands inside surrogate pairs if it is made on UTF-16
  // units. The leading word keeps the line from being decoration-only, which
  // normalization removes on purpose.
  const raw = `we ship ${"\u{1F600}".repeat(MAX_IMPORT_CHARS + 50)}`;
  const { text, truncated, charCount } = normalizeImportText(raw);

  assert.equal(truncated, true);
  assert.equal(charCount, MAX_IMPORT_CHARS);
  assert.ok(!text.includes("\uFFFD"), "a surrogate pair was split");
});

const importClient = async () => {
  const { readFile } = await import("node:fs/promises");
  return readFile(
    new URL("../components/import-job/ImportJobPageClient.tsx", import.meta.url),
    "utf8"
  );
};

test("the paste entry point sends text and nothing about its meaning", async () => {
  const source = await importClient();

  // The client names the source kind and hands over the words. Reading a field
  // out of them here would be a second implementation of intelligence that
  // already exists once, on the server — and the two would diverge the first
  // time either changed.
  assert.match(source, /source_type: "pasted_text"/);
  assert.match(source, /original_text: text/);
  assert.doesNotMatch(source, /experience_level\s*[:=]/);
  assert.doesNotMatch(source, /budget_(?:amount|max|unit)\s*[:=]/);
  assert.doesNotMatch(source, /work_mode\s*[:=]/);
});

test("a paste the server refuses is explained in the server's words", async () => {
  // Only the server knows whether the text was several jobs or no job at all,
  // so it writes the sentence. Collapsing both into one generic failure is what
  // told a recruiter to "try again" when the answer was "paste one of them".
  const source = await importClient();

  assert.match(source, /JOB_IMPORT_TEXT_MULTIPLE_JOBS/);
  assert.match(source, /JOB_IMPORT_TEXT_NO_JOB_CONTENT/);
});
