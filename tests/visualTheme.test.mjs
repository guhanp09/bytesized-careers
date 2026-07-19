import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEFAULT_VISUAL_THEME,
  VISUAL_THEME_ATTRIBUTE,
  VISUAL_THEME_BOOTSTRAP_SCRIPT,
  VISUAL_THEME_STORAGE_KEY,
  applyVisualTheme,
  normalizeStoredTheme,
} from "../lib/visualTheme.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("normalizeStoredTheme: only the exact 'enhanced' value opts in", () => {
  assert.equal(normalizeStoredTheme("enhanced"), "enhanced");
  for (const raw of [null, undefined, "", "current", "ENHANCED", "Enhanced", "enhanced ", "junk", "true"]) {
    assert.equal(normalizeStoredTheme(raw), "current", String(raw));
  }
  assert.equal(DEFAULT_VISUAL_THEME, "current");
});

test("applyVisualTheme sets and removes the root attribute", () => {
  const calls = [];
  const root = {
    setAttribute: (n, v) => calls.push(["set", n, v]),
    removeAttribute: (n) => calls.push(["remove", n]),
  };
  applyVisualTheme(root, "enhanced");
  applyVisualTheme(root, "current");
  assert.deepEqual(calls, [
    ["set", VISUAL_THEME_ATTRIBUTE, "enhanced"],
    ["remove", VISUAL_THEME_ATTRIBUTE],
  ]);
});

test("the bootstrap script reads the storage key and stamps the attribute", () => {
  assert.match(VISUAL_THEME_BOOTSTRAP_SCRIPT, /localStorage\.getItem/);
  assert.ok(VISUAL_THEME_BOOTSTRAP_SCRIPT.includes(JSON.stringify(VISUAL_THEME_STORAGE_KEY)));
  assert.ok(VISUAL_THEME_BOOTSTRAP_SCRIPT.includes(JSON.stringify(VISUAL_THEME_ATTRIBUTE)));
  assert.match(VISUAL_THEME_BOOTSTRAP_SCRIPT, /catch/); // fails closed on storage errors
  assert.doesNotMatch(VISUAL_THEME_BOOTSTRAP_SCRIPT, /<\/script/i);
});

test("the root layout mounts the toggle, the bootstrap, and token-driven body colors", () => {
  const layout = read("app/layout.tsx");
  assert.match(layout, /VisualThemeToggle/);
  assert.match(layout, /VISUAL_THEME_BOOTSTRAP_SCRIPT/);
  assert.match(layout, /bg-\[var\(--vt-canvas,#0b0b0f\)\]/);
  assert.match(layout, /text-\[var\(--vt-ink,#ffffff\)\]/);
});

test("globals.css keeps the current design as the token defaults", () => {
  const css = read("app/globals.css");
  // The enhanced block exists and is attribute-scoped (reversible).
  assert.match(css, /:root\[data-visual-theme="enhanced"\]/);
  // Default tokens are the CURRENT design's exact values — the off-state is
  // pixel-identical by construction.
  const defaults = css.match(/:root \{[\s\S]*?--vt-canvas:[\s\S]*?\n\}/);
  assert.ok(defaults, "default --vt token block should exist");
  assert.match(defaults[0], /--vt-canvas: #0b0b0f;/);
  assert.match(defaults[0], /--vt-card: rgba\(255, 255, 255, 0\.06\);/);
  assert.match(defaults[0], /--vt-line: rgba\(255, 255, 255, 0\.1\);/);
  assert.match(defaults[0], /--vt-ink: #ffffff;/);
  assert.match(defaults[0], /--vt-card-sheen: none;/);
  assert.match(defaults[0], /--vt-chip-active-glow: none;/);
  assert.match(defaults[0], /--vt-nav-active: transparent;/);
  // v2 additions keep the same discipline: defaults equal the current design.
  assert.match(defaults[0], /--vt-chip-active-bg: #ffffff;/);
  assert.match(defaults[0], /--vt-chip-active-grad: none;/);
  assert.match(defaults[0], /--vt-post-bg: #ffffff;/);
  assert.match(defaults[0], /--vt-cta-text: rgba\(255, 255, 255, 0\.9\);/);
  assert.match(defaults[0], /--vt-card-line: rgba\(255, 255, 255, 0\.1\);/);
  assert.match(defaults[0], /--vt-accent-grad: none;/);
  assert.match(defaults[0], /--vt-nav-active-shadow: none;/);
  // Enhanced-only atmosphere is scoped to the attribute (never the default theme)
  // and painted on the root element (layering-proof under Tailwind's cascade layers).
  const atmosphere = css.match(/:root\[data-visual-theme="enhanced"\] \{\s*background-color[\s\S]*?\n\}/);
  assert.ok(atmosphere, "enhanced root atmosphere block should exist");
  assert.match(atmosphere[0], /radial-gradient/);
  assert.match(atmosphere[0], /background-attachment: fixed/);
  assert.match(css, /:root\[data-visual-theme="enhanced"\] body \{\s*background: transparent;/);
  // v2: the amber opportunity family and the periwinkle selection gradient exist
  // only inside the enhanced overrides.
  const enhancedBlock = css.match(/:root\[data-visual-theme="enhanced"\] \{[\s\S]*?--vt-canvas:[\s\S]*?\n\}/);
  assert.ok(enhancedBlock, "enhanced token block should exist");
  assert.match(enhancedBlock[0], /--vt-post-bg: #fcbb00;/);
  assert.match(enhancedBlock[0], /--vt-chip-active-grad: linear-gradient/);
  assert.match(enhancedBlock[0], /--vt-nav-active-shadow: inset 2px 0 0 0/);
  assert.doesNotMatch(defaults[0], /#fcbb00/);
});

test("the toggle is accessible, labeled, and non-intrusively positioned", () => {
  const toggle = read("components/theme/VisualThemeToggle.tsx");
  assert.match(toggle, /aria-pressed/);
  assert.match(toggle, /aria-label="Toggle enhanced visual theme"/);
  assert.match(toggle, /title=/);
  assert.match(toggle, /data-testid="visual-theme-toggle"/);
  // Bottom-left rail foot — clear of dev tools (left-24) and bottom-right stacks.
  assert.match(toggle, /bottom-4 left-3/);
  // v2 discoverability: a visible label and a first-run pulse read from an
  // effect (never SSR-branched — no hydration mismatch).
  assert.match(toggle, />Theme<\/span>/);
  assert.match(toggle, /vt-toggle-pulse/);
  assert.match(toggle, /setNeverToggled\(stored === null\)/);
});

test("enhanced-only component classes are scoped and motion is guarded", () => {
  const css = read("app/globals.css");
  for (const cls of ["vt-cta", "vt-card", "vt-avatar"]) {
    assert.match(css, new RegExp(`:root\\[data-visual-theme="enhanced"\\] \\.${cls}`), cls);
    // No unscoped rule — the classes must be invisible in the default theme.
    assert.doesNotMatch(css, new RegExp(`(?<!enhanced"\\] )\\.${cls}\\s*\\{`), `${cls} must only exist under the enhanced scope`);
  }
  assert.match(css, /@keyframes vt-toggle-pulse/);
  const reducedMotion = css.match(/@media \(prefers-reduced-motion: reduce\) \{\s*\.vt-toggle-pulse \{\s*animation: none;/);
  assert.ok(reducedMotion, "the toggle pulse must be disabled under reduced motion");
});

test("the /jobs surfaces reference tokens with current-value fallbacks", () => {
  for (const path of [
    "components/JobGridClient.tsx",
    "components/JobCard.tsx",
    "components/Sidebar.tsx",
    "components/SubfilterRow.tsx",
    "components/Header.tsx",
    "components/marketplace/PostMenu.tsx",
    "components/ui/MetaRow.tsx",
    "components/ui/StatRow.tsx",
    "components/ui/TagPill.tsx",
    "components/jobs/ChannelAttribution.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /var\(--vt-/, path);
  }
  // The card keeps its structure: sheen is a background-image token, off by default.
  const card = read("components/JobCard.tsx");
  assert.match(card, /\[background-image:var\(--vt-card-sheen,none\)\]/);
});
