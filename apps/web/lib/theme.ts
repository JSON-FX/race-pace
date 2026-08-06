export type Theme = "light" | "dark";

const KEY = "rp-theme";

export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch { /* private mode — fall through to the default */ }
  // Default to light regardless of prefers-color-scheme until the shadcn migration
  // finishes. Screens still on the legacy `--canvas`/`--ink` variables have no dark
  // variant, so auto-enabling dark paints near-white text on hardcoded white cards.
  // Restore the media query once the LEGACY block leaves index.css.
  return "light";
}

export function applyTheme(t: Theme): void {
  document.documentElement.classList.toggle("dark", t === "dark");
  try { localStorage.setItem(KEY, t); } catch { /* nothing to do */ }
}
