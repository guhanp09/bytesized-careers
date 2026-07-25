import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  INTERNAL_IDENTIFIERS,
  displayLabel,
  displayPersonName,
  hasDisplayLabel,
  pseudonymousHandle,
  timelineEventLabel,
} from "../lib/interactionLabels.ts";

/* --- the projection ------------------------------------------------------ */

test("every internal identifier the product uses has a deliberate label", () => {
  for (const value of INTERNAL_IDENTIFIERS) {
    assert.ok(hasDisplayLabel(value), `${value} has no deliberate label`);
    assert.notEqual(displayLabel(value), value, `${value} renders as itself`);
  }
});

test("an unmapped value degrades to prose rather than leaking raw", () => {
  // The floor, not the plan: a status added tomorrow reads badly but readably,
  // instead of appearing lowercase mid-sentence as `some_new_status`.
  assert.equal(displayLabel("some_new_status"), "Some New Status");
  assert.equal(displayLabel("MIXED_Case-value"), "Mixed Case Value");
});

test("the retired Shortlisted stage keeps an honest label", () => {
  // Nothing transitions into it any more, but records already in it are real
  // history and the applicant was genuinely told something.
  assert.equal(displayLabel("shortlisted"), "Under consideration");
});

test("missing values produce nothing, never the word undefined", () => {
  for (const empty of [null, undefined, ""]) {
    assert.equal(displayLabel(empty), "");
  }
});

/* --- the exact defect ---------------------------------------------------- */

test("a private status update never reads as one lowercase phrase", () => {
  // The reported string was "new saved privately": `new` was missing from an
  // inline map, fell through a raw fallback, and was concatenated with a
  // suffix. Both halves are fixed here — the label, and the separator.
  const label = timelineEventLabel({ status: "new", managerOnly: true });
  assert.equal(label, "New · saved privately");
  assert.doesNotMatch(label, /\bnew\b/);
});

test("visibility is stated as its own clause, not glued to the stage name", () => {
  assert.equal(timelineEventLabel({ status: "rejected", managerOnly: true }), "Not selected · saved privately");
  assert.equal(timelineEventLabel({ status: "rejected", communicated: true }), "Not selected · shared with them");
  assert.equal(timelineEventLabel({ status: "hired" }), "Hired");
});

/* --- names --------------------------------------------------------------- */

test("a real name is always preferred", () => {
  assert.equal(displayPersonName({ displayName: "Priya Nair", username: "priya", identity: "u1" }), "Priya Nair");
});

test("a username is used before any fallback, and always reads as a handle", () => {
  assert.equal(displayPersonName({ username: "priya_edits", identity: "u1" }), "@priya_edits");
  assert.equal(displayPersonName({ username: "@priya_edits", identity: "u1" }), "@priya_edits");
});

test("an unnamed person gets a stable handle, never a shared generic label", () => {
  // "Applicant" on every row makes distinct people indistinguishable — a
  // recruiter cannot tell two unnamed applicants apart, and the pipeline reads
  // as one person applying repeatedly.
  const first = displayPersonName({ identity: "8f2c4f2a", role: "applicant" });
  const second = displayPersonName({ identity: "1b7e9d31", role: "applicant" });
  assert.match(first, /^@editor_[a-z0-9]{4}$/);
  assert.notEqual(first, second, "two unnamed people must not collapse into one label");
  assert.notEqual(first, "Applicant");
});

test("the same person yields the same handle every time", () => {
  const identity = "3f9a-2b1c-4d5e";
  assert.equal(pseudonymousHandle(identity, "applicant"), pseudonymousHandle(identity, "applicant"));
});

test("the handle names the side of the relationship", () => {
  assert.match(pseudonymousHandle("abcd1234", "applicant"), /^@editor_/);
  assert.match(pseudonymousHandle("abcd1234", "recruiter"), /^@channel_/);
  assert.match(pseudonymousHandle("abcd1234"), /^@member_/);
});

test("an identifier with nothing usable still yields a handle, not an empty string", () => {
  assert.equal(pseudonymousHandle("", "applicant"), "@editor");
  assert.equal(pseudonymousHandle(null), "@member");
});

/* --- the guard ----------------------------------------------------------- */

const WORKSPACE_FILES = [
  "components/you/ApplicationsWorkspace.tsx",
  "components/you/PipelineBoard.tsx",
  "components/you/CompactChatDock.tsx",
  "lib/ownerInteractions.ts",
];

test("no raw internal identifier is concatenated into user-facing prose", () => {
  /*
    Catches the shape of the original defect rather than its exact string: a
    template literal that interpolates a status straight into a sentence. Both
    known leaks came from `?? event.new_status` inside a label expression.
  */
  const offenders = [];
  for (const file of WORKSPACE_FILES) {
    // Strip comments first. Prose *about* the defect legitimately quotes the
    // raw identifier, and a line-prefix heuristic cannot tell that apart from
    // the defect itself — blank them out so line numbers still line up.
    const source = fs
      .readFileSync(path.join(process.cwd(), file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
      .replace(/(^|[^:])\/\/[^\n]*/g, (_match, lead) => lead);
    for (const [index, line] of source.split("\n").entries()) {
      // A label or body built from a raw status field.
      if (/\b(label|title|body|text)\s*[:=][^;\n]*\$\{[^}]*\b(new_status|backendStatus|status)\b[^}]*\}/.test(line)) {
        offenders.push(`${file}:${index + 1} ${line.trim()}`);
      }
      // The specific fallback that produced "new saved privately".
      if (/\?\?\s*\w*\.?new_status/.test(line)) {
        offenders.push(`${file}:${index + 1} ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `raw status interpolated into prose:\n${offenders.join("\n")}`);
});

test("no shared generic person label survives in the mapper", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "lib/ownerInteractions.ts"), "utf8");
  assert.doesNotMatch(source, /\|\|\s*"Applicant"/, 'the generic "Applicant" fallback is back');
});
