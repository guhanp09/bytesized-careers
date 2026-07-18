// Reversible visual-theme preview (current ⇄ enhanced).
//
// The enhanced theme is a pure CSS-token layer: `:root` defines --vt-* defaults
// equal to the current design's exact values, and `[data-visual-theme="enhanced"]`
// overrides them (see app/globals.css). Nothing here touches functionality; the
// attribute + localStorage value are the entire mechanism, so removing the
// enhanced CSS block and the toggle restores the current design wholesale.

export type VisualTheme = "current" | "enhanced";

export const VISUAL_THEME_STORAGE_KEY = "cj_visual_theme";
export const VISUAL_THEME_ATTRIBUTE = "data-visual-theme";
export const DEFAULT_VISUAL_THEME: VisualTheme = "current";

/** Pure: anything that isn't exactly "enhanced" falls back to the current theme. */
export function normalizeStoredTheme(raw: string | null | undefined): VisualTheme {
  return raw === "enhanced" ? "enhanced" : DEFAULT_VISUAL_THEME;
}

export function applyVisualTheme(root: { setAttribute: (n: string, v: string) => void; removeAttribute: (n: string) => void }, theme: VisualTheme): void {
  if (theme === "enhanced") root.setAttribute(VISUAL_THEME_ATTRIBUTE, "enhanced");
  else root.removeAttribute(VISUAL_THEME_ATTRIBUTE);
}

/**
 * Pre-paint bootstrap: applied inline in the root layout so a stored "enhanced"
 * choice takes effect before hydration (no theme flash). Fails closed to the
 * current theme on any storage error.
 */
export const VISUAL_THEME_BOOTSTRAP_SCRIPT = `try{if(localStorage.getItem(${JSON.stringify(
  VISUAL_THEME_STORAGE_KEY
)})==="enhanced")document.documentElement.setAttribute(${JSON.stringify(
  VISUAL_THEME_ATTRIBUTE
)},"enhanced")}catch(e){}`;
