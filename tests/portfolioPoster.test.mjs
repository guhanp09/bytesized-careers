import test from "node:test";
import assert from "node:assert/strict";

import {
  MEDIA_ICONS,
  POSTER_PALETTES,
  POSTER_PATTERNS,
  portfolioPoster,
  posterGradient,
  posterInitials,
  posterPatternUrl,
} from "../lib/portfolioPoster.ts";

test("the same item is the same poster, every time", () => {
  // A poster that changed between renders would make a strip of work look like
  // different work each time the inbox refreshed.
  const a = portfolioPoster("item-4f2a", "Retention rebuild");
  const b = portfolioPoster("item-4f2a", "Retention rebuild");
  assert.deepEqual(a, b);
});

test("different items get visibly different posters", () => {
  const ids = ["a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8", "i9", "j10", "k11", "l12"];
  const signatures = new Set(
    ids.map((id) => {
      const poster = portfolioPoster(id, "Work");
      return `${poster.palette.key}|${poster.pattern}|${Math.round(poster.angle / 30)}`;
    })
  );
  // With 6 palettes x 4 patterns x rotation there is no excuse for a dozen
  // items collapsing into a handful of looks.
  assert.ok(signatures.size >= 8, `only ${signatures.size} distinct looks across 12 items`);
});

test("the poster varies along three axes, not just colour", () => {
  const posters = Array.from({ length: 40 }, (_, index) => portfolioPoster(`seed-${index}`, "Work"));
  assert.ok(new Set(posters.map((p) => p.palette.key)).size > 1, "colour never varies");
  assert.ok(new Set(posters.map((p) => p.pattern)).size > 1, "pattern never varies");
  assert.ok(new Set(posters.map((p) => p.angle)).size > 1, "rotation never varies");
});

test("every palette and pattern chosen is one that exists", () => {
  const paletteKeys = new Set(POSTER_PALETTES.map((p) => p.key));
  for (let index = 0; index < 60; index += 1) {
    const poster = portfolioPoster(`x-${index}`, "Work");
    assert.ok(paletteKeys.has(poster.palette.key));
    assert.ok(POSTER_PATTERNS.includes(poster.pattern));
    assert.ok(poster.angle >= 0 && poster.angle < 360);
  }
});

test("an item with no id still yields a poster rather than throwing", () => {
  const poster = portfolioPoster("", "Some title");
  assert.ok(poster.palette);
  assert.equal(poster.initials, "ST");
});

test("initials take two letters from the first two words", () => {
  assert.equal(posterInitials("Retention rebuild"), "RR");
  assert.equal(posterInitials("Motion"), "M");
  assert.equal(posterInitials("  "), "··");
  assert.equal(posterInitials("“Quoted” start"), "QS");
});

test("the pattern is an inline data URI, so a poster never costs a request", () => {
  // The entire reason posters are generated is that fetching artwork from a
  // hiring inbox means third-party calls and a layout that breaks on failure.
  const url = posterPatternUrl(portfolioPoster("item-1", "Work"));
  assert.match(url, /^url\("data:image\/svg\+xml,/);
  assert.doesNotMatch(url, /https?:\/\//);
});

test("the gradient names both stops of its own palette", () => {
  const poster = portfolioPoster("item-2", "Work");
  const gradient = posterGradient(poster);
  assert.ok(gradient.includes(poster.palette.from));
  assert.ok(gradient.includes(poster.palette.to));
});

test("every palette stop is dark enough to carry white overlay text", () => {
  // The title is drawn on top of the poster, so a light stop would fail
  // contrast exactly where the text is hardest to move.
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  for (const palette of POSTER_PALETTES) {
    for (const stop of [palette.from, palette.to]) {
      const ratio = (1.05) / (luminance(stop) + 0.05);
      assert.ok(ratio >= 4.5, `${palette.key} ${stop} is only ${ratio.toFixed(2)}:1 against white`);
    }
  }
});

test("each media kind has an icon that exists in the repo's set", () => {
  // Rendering a missing icon name silently draws nothing.
  const available = new Set(["circle-play", "image", "podcast", "external-link"]);
  for (const [kind, icon] of Object.entries(MEDIA_ICONS)) {
    assert.ok(available.has(icon), `${kind} points at unknown icon ${icon}`);
  }
});
