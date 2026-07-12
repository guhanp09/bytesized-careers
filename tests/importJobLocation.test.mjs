import test from "node:test";
import assert from "node:assert/strict";

import { parseJobPost } from "../lib/importJob/parseJobPost.ts";

const parse = (text) => parseJobPost(`Hiring a video editor.\n${text}`);

test("remote-only: work mode imported, city never prefilled", () => {
  const d = parse("This is a remote role.").draft;
  assert.equal(d.workMode.status, "imported");
  assert.equal(d.workMode.value, "Remote");
  assert.equal(d.city.status, "missing");
  assert.equal(d.city.value, null);
});

test("hybrid + recognized city: both imported, alias canonicalized", () => {
  const d = parse("Location: Bangalore (Hybrid)").draft;
  assert.equal(d.workMode.value, "Hybrid");
  assert.equal(d.city.status, "imported");
  assert.equal(d.city.value, "Bengaluru");
});

test("on-site + unrecognized city text stays prefilled for review", () => {
  const r = parse("On-site role.\nLocation: Erode");
  assert.equal(r.draft.workMode.value, "On-site");
  assert.equal(r.draft.city.status, "review");
  assert.equal(r.draft.city.value, "Erode");
  assert.ok(r.warnings.some((w) => w.code === "city-not-recognized"));
});

test("on-site with no city: city missing (needed to publish)", () => {
  const d = parse("On-site role in our studio.").draft;
  assert.equal(d.workMode.value, "On-site");
  assert.equal(d.city.status, "missing");
});

test("bare 'Location: Mumbai' never infers On-site", () => {
  const d = parse("Location: Mumbai").draft;
  assert.equal(d.workMode.status, "missing");
  assert.equal(d.city.status, "review");
  assert.equal(d.city.value, "Mumbai");
  assert.match(d.city.note, /Pick Remote, Hybrid, or On-site/);
});

test("'Remote (Bangalore preferred)': Remote wins, city becomes a work-mode note", () => {
  const d = parse("Remote (Bangalore preferred)").draft;
  assert.equal(d.workMode.value, "Remote");
  assert.equal(d.workMode.status, "review");
  assert.match(d.workMode.note, /Bengaluru/);
  assert.equal(d.city.value, null);
});

test("NCR region: conflict with expansion cities, nothing prefilled", () => {
  const r = parse("On-site.\nLocation: Delhi NCR");
  assert.equal(r.draft.city.status, "conflict");
  assert.equal(r.draft.city.value, null);
  const cities = r.draft.city.alternatives.map((a) => a.value);
  for (const c of ["Delhi", "Noida", "Gurugram"]) assert.ok(cities.includes(c), c);
  assert.ok(r.warnings.some((w) => w.code === "region-needs-city"));
});

test("multiple distinct cities: conflict, nothing prefilled", () => {
  const d = parse("Hybrid. Offices in Mumbai and Pune.").draft;
  assert.equal(d.city.status, "conflict");
  assert.equal(d.city.value, null);
  const cities = d.city.alternatives.map((a) => a.value);
  assert.ok(cities.includes("Mumbai"));
  assert.ok(cities.includes("Pune"));
});

test("regression: freelance/retainer/full-time/part-time never set work mode", () => {
  for (const phrase of ["Freelance role.", "Monthly retainer.", "Full-time position.", "Part-time work."]) {
    const d = parse(phrase).draft;
    assert.equal(d.workMode.status, "missing", phrase);
  }
});

test("regression: 'remove' never fuzzy-matches Remote", () => {
  const d = parse("We will remove low performers quickly.").draft;
  assert.equal(d.workMode.status, "missing");
});

test("conflicting modes: first mention wins with alternatives", () => {
  const d = parse("Remote or on-site, your choice.").draft;
  assert.equal(d.workMode.status, "conflict");
  assert.equal(d.workMode.value, "Remote");
  assert.ok(d.workMode.alternatives.some((a) => a.value === "On-site"));
});
