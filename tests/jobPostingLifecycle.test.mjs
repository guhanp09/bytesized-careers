import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  jobPostingVisibility,
  talentListingVisibility,
} from "../lib/seo/jobPostingLifecycle.ts";

/**
 * A closed job must stop telling search engines it is open.
 *
 * `JobPosting` structured data is not decoration. It is a machine-readable claim
 * that a role exists and can be applied to, and aggregators act on it: they list
 * the job, people click it, and if the role closed a month ago they arrive at
 * nothing. That is the complaint behind Google's requirement to remove a posting
 * when it closes, and behind the manual actions issued to sites that do not.
 *
 * Before this, the page emitted a full JobPosting for every job it could load,
 * whatever its status — so a closed role kept advertising itself, indefinitely,
 * with no expiry to contradict it.
 *
 * The other half is that the rule has to be the SAME rule in two places. In a
 * Next route, `generateMetadata` and the page body are separate functions, and
 * duplicating the condition eventually produces a page that noindexes itself
 * while still publishing an open JobPosting — worse than either mistake alone,
 * because search drops the page while the aggregator keeps the listing.
 */

const here = dirname(fileURLToPath(import.meta.url));
const pageSource = readFileSync(
  join(here, "..", "app", "jobs", "[id]", "page.tsx"),
  "utf8",
);

const NOW = new Date("2026-08-17T12:00:00.000Z");

test("a published job with no deadline is open", () => {
  const visibility = jobPostingVisibility({ status: "published" }, NOW);

  assert.equal(visibility.structuredData, true);
  assert.equal(visibility.indexable, true);
});

test("a featured job is open", () => {
  // `featured` is a promoted published job, not a separate lifecycle state.
  // Treating it as unrecognised would silently delist every promoted role.
  assert.equal(jobPostingVisibility({ status: "featured" }, NOW).structuredData, true);
});

test("a published job whose deadline has passed publishes nothing", () => {
  // The case a status check alone misses: the database says open, the posting
  // says otherwise, and an applicant relies on the posting.
  const visibility = jobPostingVisibility(
    { status: "published", deadlineAt: "2026-08-01T00:00:00.000Z" },
    NOW,
  );

  assert.equal(visibility.structuredData, false);
  assert.equal(visibility.indexable, false);
  assert.match(visibility.reason, /deadline/);
});

test("a deadline still in the future keeps the job open", () => {
  // Guards the test above: if any deadline suppressed the posting, every job
  // with an application window would vanish from search.
  const visibility = jobPostingVisibility(
    { status: "published", deadlineAt: "2026-09-01T00:00:00.000Z" },
    NOW,
  );

  assert.equal(visibility.structuredData, true);
});

for (const status of ["closed", "archived", "paused", "draft"]) {
  test(`a ${status} job publishes no JobPosting and is not indexed`, () => {
    const visibility = jobPostingVisibility({ status }, NOW);

    assert.equal(visibility.structuredData, false, status);
    assert.equal(visibility.indexable, false, status);
  });
}

test("paused is excluded deliberately, not by accident", () => {
  // Worth its own case because it is the arguable one. Paused means "not
  // accepting applications right now", and the vocabulary has no way to say
  // that — an aggregator reads a JobPosting as an open role or reads nothing.
  const visibility = jobPostingVisibility({ status: "paused" }, NOW);

  assert.equal(visibility.structuredData, false);
  assert.match(visibility.reason, /not open to applications/);
});

test("an unknown or missing status is treated as not open", () => {
  // Fails closed. A status added later that nobody classified must not default
  // to advertising a role that may not exist.
  for (const status of [undefined, null, "", "  ", "expired", "under_review"]) {
    assert.equal(jobPostingVisibility({ status }, NOW).structuredData, false, String(status));
  }
});

test("an unparseable deadline does not delist an open job", () => {
  // A bad date is a data problem, not a closure. Reading it as expiry would
  // remove a live job from search over a formatting error.
  const visibility = jobPostingVisibility(
    { status: "published", deadlineAt: "not a date" },
    NOW,
  );

  assert.equal(visibility.structuredData, true);
});

test("the rule is evaluated against a passed-in clock", () => {
  // So expiry is testable at all. A function reading the wall clock could only
  // be tested for the state the machine happens to be in today.
  const job = { status: "published", deadlineAt: "2026-08-10T00:00:00.000Z" };

  assert.equal(jobPostingVisibility(job, new Date("2026-08-05T00:00:00Z")).structuredData, true);
  assert.equal(jobPostingVisibility(job, new Date("2026-08-15T00:00:00Z")).structuredData, false);
});

test("the page asks the shared rule rather than restating it", () => {
  // The duplication guard. Both the metadata and the body must consult the same
  // function, or they will drift into contradicting each other.
  const occurrences = pageSource.match(/jobPostingVisibility\(job\)/g) ?? [];

  assert.ok(
    occurrences.length >= 2,
    `expected the metadata and the body to both consult the rule, saw ${occurrences.length}`,
  );
  // And no second, hand-rolled version of the same condition.
  assert.ok(
    !/status\s*===\s*"closed"/.test(pageSource),
    "the page checks a status directly; the lifecycle rule is the single source",
  );
});

test("the structured data block is conditional in the markup", () => {
  // The assertion that would have caught the original defect: the script tag was
  // rendered unconditionally.
  assert.match(pageSource, /visibility\.structuredData \?/);
});

test("the posting states that applications happen here", () => {
  // True of this platform by design — an application never leaves for an
  // external form — and it is what stops an aggregator advertising an
  // apply-elsewhere flow that does not exist.
  assert.match(pageSource, /directApply: true/);
});

test("no compensation is published in the structured data yet", () => {
  // Deliberate. `baseSalary` requires exact source amount and currency, and the
  // rules for presenting compensation truthfully are TRUST-001, which is not
  // done. Emitting a guessed or converted figure into a machine-readable
  // contract would be the worst place to get it wrong.
  const jsonLdBlock = pageSource.slice(
    pageSource.indexOf("const jobPostingJsonLd"),
    pageSource.indexOf("const isOwner"),
  );

  assert.ok(jsonLdBlock.length > 0, "could not locate the JobPosting object");
  assert.ok(!jsonLdBlock.includes("baseSalary"), "compensation is TRUST-001's decision");
});

/**
 * The talent side of the same lifecycle, which shares the status vocabulary and
 * differs in one respect that matters.
 *
 * A closed talent listing had no indexing rule at all, so a recruiter could find
 * a listing the creator had taken down. But availability is NOT part of the rule,
 * and that distinction is the reason this is a separate function: "unavailable"
 * means busy, not gone. Delisting on availability would hide real people over a
 * field they flip weekly, and a recruiter planning next quarter has every reason
 * to find them anyway.
 */

const talentPageSource = readFileSync(
  join(here, "..", "app", "talent", "[id]", "page.tsx"),
  "utf8",
);

test("a published talent listing is indexable", () => {
  assert.equal(talentListingVisibility({ status: "published" }).indexable, true);
  assert.equal(talentListingVisibility({ status: "featured" }).indexable, true);
});

for (const status of ["closed", "archived", "paused", "draft"]) {
  test(`a ${status} talent listing is not indexable`, () => {
    assert.equal(talentListingVisibility({ status }).indexable, false, status);
  });
}

test("an unknown talent listing status fails closed", () => {
  for (const status of [undefined, null, "", "retired"]) {
    assert.equal(talentListingVisibility({ status }).indexable, false, String(status));
  }
});

test("availability never decides indexability", () => {
  // The deliberate difference from the job rule, and the one someone would
  // "fix" by mistake. An unavailable creator is findable; a withdrawn listing
  // is not.
  for (const availability of ["available", "selective", "unavailable"]) {
    assert.equal(
      talentListingVisibility({ status: "published", availability_status: availability }).indexable,
      true,
      availability,
    );
  }
});

test("the talent rule reads no availability field at all", () => {
  // Structural, because the behavioural test above can only cover the values
  // that exist today.
  const source = readFileSync(
    join(here, "..", "lib", "seo", "jobPostingLifecycle.ts"),
    "utf8",
  );
  const rule = source.slice(
    source.indexOf("export function talentListingVisibility"),
  );
  const body = rule.slice(0, rule.indexOf("\n}"));

  assert.ok(!body.includes("availability"), "the talent rule consults availability");
});

test("the talent page consults the shared rule", () => {
  assert.match(talentPageSource, /talentListingVisibility\(listing\)/);
  assert.ok(
    !/listing\.status\s*===\s*"closed"/.test(talentPageSource),
    "the page checks a status directly instead of using the shared rule",
  );
});
