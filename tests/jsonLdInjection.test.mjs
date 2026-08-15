/**
 * Structured data is published on pages whose content recruiters and creators
 * write. An inline `<script type="application/ld+json">` block ends at the
 * first `</script` an HTML parser sees — including one inside a JSON string —
 * so a job title carrying that sequence stops being data and starts being
 * markup on a public page.
 *
 * These tests hold two things at once: the escaped output cannot break out of
 * the tag, and it still parses back to exactly the values that went in. An
 * escape that changed the data would be a different bug.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { serializeJsonLd } from "../lib/jsonLd.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("a closing script tag in user content cannot end the data block", () => {
  const hostile = {
    "@type": "JobPosting",
    title: "Video editor </script><img src=x onerror=alert(1)>",
    description: "Ends the tag: </SCRIPT > and </script\t>",
  };

  const serialized = serializeJsonLd(hostile);

  assert.ok(!/<\/script/i.test(serialized), "the output still contains a closing script tag");
  assert.ok(!serialized.includes("<"), "an unescaped < survived");
  assert.ok(!serialized.includes(">"), "an unescaped > survived");
  // The values are unchanged for anything that reads the JSON.
  assert.deepEqual(JSON.parse(serialized), hostile);
});

test("html entities cannot reconstruct a delimiter", () => {
  const serialized = serializeJsonLd({ title: "&lt;/script&gt; &amp; more" });

  assert.ok(!serialized.includes("&"), "an unescaped ampersand survived");
  assert.equal(JSON.parse(serialized).title, "&lt;/script&gt; &amp; more");
});

test("line and paragraph separators are escaped without changing the value", () => {
  const value = { title: "line break", description: "para break" };

  const serialized = serializeJsonLd(value);

  assert.ok(!serialized.includes(" "));
  assert.ok(!serialized.includes(" "));
  assert.deepEqual(JSON.parse(serialized), value);
});

test("ordinary content is untouched apart from the escapes", () => {
  const value = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "Video Editor",
    baseSalary: { "@type": "MonetaryAmount", currency: "INR", value: 40000 },
    nested: [{ a: null }, { b: true }],
  };

  assert.deepEqual(JSON.parse(serializeJsonLd(value)), value);
});

test("every inline structured-data block uses the serializer", () => {
  // A page that reaches for JSON.stringify here is the whole defect: the
  // escaping decision has to be made where the string is built, and one missed
  // call site is a live injection point.
  for (const path of ["app/jobs/[id]/page.tsx", "app/talent/[id]/page.tsx"]) {
    const source = read(path);
    const blocks = source.split('type="application/ld+json"').slice(1);
    assert.ok(blocks.length > 0, `${path} no longer renders structured data`);
    for (const block of blocks) {
      const head = block.slice(0, 400);
      assert.match(head, /serializeJsonLd\(/, `${path} has an unescaped structured-data block`);
      assert.doesNotMatch(head, /__html: JSON\.stringify\(/, `${path} still stringifies directly`);
    }
  }
});
