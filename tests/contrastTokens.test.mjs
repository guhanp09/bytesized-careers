import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Contrast is a property of the token *values*, so it is checked here rather
 * than in a browser. A CSS-level test catches a regression the moment someone
 * edits a token, which is months before it would surface in an axe run against
 * one particular rendered page.
 *
 * The tokens are parsed out of `app/globals.css` rather than duplicated, so this
 * cannot drift from what actually ships.
 */

const CSS = fs.readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");

function tokenValue(name) {
  const match = new RegExp(`--color-${name}:\\s*([^;]+);`).exec(CSS);
  assert.ok(match, `token --color-${name} is missing from globals.css`);
  return match[1].trim();
}

function parseColor(value) {
  const rgba = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,/\s]+([\d.]+))?\s*\)/.exec(value);
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] === undefined ? 1 : Number(rgba[4]),
    };
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  assert.ok(hex, `cannot parse colour: ${value}`);
  const n = parseInt(hex[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
}

/** Flatten a translucent foreground onto an opaque background. */
function composite(fg, bg) {
  return {
    r: bg.r + (fg.r - bg.r) * fg.a,
    g: bg.g + (fg.g - bg.g) * fg.a,
    b: bg.b + (fg.b - bg.b) * fg.a,
    a: 1,
  };
}

function luminance({ r, g, b }) {
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(fgToken, bgToken) {
  const bg = parseColor(tokenValue(bgToken));
  const fg = composite(parseColor(tokenValue(fgToken)), bg);
  const [light, dark] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/** Every surface text can legitimately sit on, lightest last. */
const SURFACES = ["canvas", "shell", "panel", "raised", "elevated", "overlay"];
/** Every text tier that must carry information. `disabled` is exempt by WCAG. */
const TEXT = ["ink", "default", "secondary", "muted", "subtle"];

test("every informational text tier clears AA on every surface", () => {
  const failures = [];
  for (const text of TEXT) {
    for (const surface of SURFACES) {
      const ratio = contrast(text, surface);
      if (ratio < 4.5) failures.push(`${text} on ${surface}: ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], `below 4.5:1 —\n${failures.join("\n")}`);
});

test("the faintest tier still clears AA on the lightest surface, with margin", () => {
  // `subtle` on `overlay` is the worst pairing the system can produce. If this
  // has less than a little headroom, a future surface tweak silently breaks AA.
  const ratio = contrast("subtle", "overlay");
  assert.ok(ratio >= 4.6, `subtle on overlay is only ${ratio.toFixed(2)}:1`);
});

test("the text scale is monotonic, so the hierarchy is real", () => {
  const ratios = TEXT.map((token) => contrast(token, "raised"));
  for (let index = 1; index < ratios.length; index += 1) {
    assert.ok(
      ratios[index] < ratios[index - 1],
      `${TEXT[index]} (${ratios[index].toFixed(2)}) is not quieter than ${TEXT[index - 1]} (${ratios[
        index - 1
      ].toFixed(2)})`
    );
  }
});

test("state hues are readable on the surfaces they appear on", () => {
  const hues = ["state-review", "state-interview", "state-agreed", "state-closed", "state-hold"];
  const failures = [];
  for (const hue of hues) {
    for (const surface of ["raised", "elevated", "overlay"]) {
      const ratio = contrast(hue, surface);
      if (ratio < 4.5) failures.push(`${hue} on ${surface}: ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], `state hues below 4.5:1 —\n${failures.join("\n")}`);
});

test("meaningful borders and the focus ring clear the 3:1 non-text requirement", () => {
  // WCAG 1.4.11: a border that carries meaning (a selected state, a focus
  // indicator) must be distinguishable. Decorative `line` is exempt and is not
  // asserted here — but it must never be the only signal for anything.
  for (const surface of ["raised", "elevated"]) {
    const strong = contrast("line-strong", surface);
    assert.ok(strong >= 3, `line-strong on ${surface} is ${strong.toFixed(2)}:1`);
  }
  const focus = contrast("focus", "canvas");
  assert.ok(focus >= 3, `focus ring on canvas is ${focus.toFixed(2)}:1`);
});

test("the surface ladder is monotonic, so depth reads in one direction", () => {
  const levels = SURFACES.map((surface) => luminance(parseColor(tokenValue(surface))));
  for (let index = 1; index < levels.length; index += 1) {
    assert.ok(
      levels[index] > levels[index - 1],
      `${SURFACES[index]} is not lighter than ${SURFACES[index - 1]}`
    );
  }
});

test("disabled text is quiet enough to read as inactive", () => {
  // The one tier allowed below AA — but it must be visibly *below* `subtle`,
  // or it is just another information tier that happens to fail.
  assert.ok(contrast("disabled", "raised") < contrast("subtle", "raised"));
});
