"use client";

// Small floating control for the reversible visual-theme preview. Sits at the
// foot of the sidebar rail (bottom-left) — clear of the dev tools/QA buttons
// (left-24), the post-flow checklist and chat dock (bottom-right), composers,
// and mobile navigation.

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

  React.useEffect(() => {
    try {
      setTheme(normalizeStoredTheme(window.localStorage.getItem(VISUAL_THEME_STORAGE_KEY)));
    } catch {
      // Storage unavailable → stay on the current theme.
    }
  }, []);

  const toggle = () => {
    const next: VisualTheme = theme === "enhanced" ? "current" : "enhanced";
    setTheme(next);
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
      className="fixed bottom-4 left-3 z-[90] flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-[var(--vt-line,rgba(255,255,255,0.10))] bg-[var(--vt-panel,rgba(16,16,20,0.92))] text-[var(--vt-text-muted,rgba(255,255,255,0.55))] shadow-[0_10px_30px_-18px_rgba(0,0,0,0.9)] backdrop-blur transition-colors hover:text-[var(--vt-ink,#ffffff)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vt-accent-ring,rgba(255,255,255,0.2))]"
    >
      {/* Half-filled circle: reads as "appearance", not as dark/light mode. */}
      <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
        <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 3a7 7 0 0 1 0 14Z" fill={enhanced ? "var(--vt-accent, currentColor)" : "currentColor"} opacity={enhanced ? 0.9 : 0.45} />
      </svg>
    </button>
  );
}
