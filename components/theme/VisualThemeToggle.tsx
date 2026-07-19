"use client";

// Floating control for the reversible visual-theme preview. Sits at the foot of
// the sidebar rail (bottom-left) — clear of the dev tools/QA buttons (left-24),
// the post-flow checklist and chat dock (bottom-right), composers, and mobile
// navigation. v2: a labeled pill (the v1 36px ghost circle proved too easy to
// miss) with a quiet first-run pulse until the user toggles once.

import React from "react";
import {
  DEFAULT_VISUAL_THEME,
  VISUAL_THEME_STORAGE_KEY,
  applyVisualTheme,
  normalizeStoredTheme,
  type VisualTheme,
} from "../../lib/visualTheme";

export default function VisualThemeToggle() {
  const [theme, setTheme] = React.useState<VisualTheme>(DEFAULT_VISUAL_THEME);
  // First-run affordance: pulse until any value has ever been stored. Read in
  // an effect so SSR and the first client render always match (no hydration
  // mismatch); "false" is the safe server default.
  const [neverToggled, setNeverToggled] = React.useState(false);

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VISUAL_THEME_STORAGE_KEY);
      setTheme(normalizeStoredTheme(stored));
      setNeverToggled(stored === null);
    } catch {
      // Storage unavailable → stay on the current theme, no pulse.
    }
  }, []);

  const toggle = () => {
    const next: VisualTheme = theme === "enhanced" ? "current" : "enhanced";
    setTheme(next);
    setNeverToggled(false);
    applyVisualTheme(document.documentElement, next);
    try {
      window.localStorage.setItem(VISUAL_THEME_STORAGE_KEY, next);
    } catch {
      // Persistence is best-effort; the in-page toggle still works.
    }
  };

  const enhanced = theme === "enhanced";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={enhanced}
      aria-label="Toggle enhanced visual theme"
      title={`Toggle enhanced visual theme (${enhanced ? "Enhanced" : "Current"})`}
      data-testid="visual-theme-toggle"
      className={[
        "fixed bottom-4 left-3 z-[90] inline-flex h-10 cursor-pointer items-center gap-2 rounded-full pl-2.5 pr-3.5",
        "border border-[var(--vt-line-strong,rgba(255,255,255,0.14))] bg-[var(--vt-panel,rgba(16,16,20,0.92))]",
        "text-[var(--vt-text-secondary,rgba(255,255,255,0.85))] backdrop-blur",
        "shadow-[0_14px_36px_-18px_rgba(0,0,0,0.95)] transition-colors",
        "hover:border-[var(--vt-line-strong,rgba(255,255,255,0.14))] hover:text-[var(--vt-ink,#ffffff)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vt-accent-ring,rgba(255,255,255,0.2))]",
        enhanced ? "shadow-[var(--vt-glow-accent,0_14px_36px_-18px_rgba(0,0,0,0.95))]" : "",
        neverToggled ? "vt-toggle-pulse" : "",
      ].join(" ")}
    >
      {/* Half-filled circle: reads as "appearance", not as dark/light mode. */}
      <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" aria-hidden="true">
        <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M10 3a7 7 0 0 1 0 14Z"
          fill={enhanced ? "var(--vt-accent, currentColor)" : "currentColor"}
          opacity={enhanced ? 0.95 : 0.5}
        />
      </svg>
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em]">Theme</span>
      {enhanced ? (
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--vt-accent,#ffffff)]" />
      ) : null}
    </button>
  );
}
