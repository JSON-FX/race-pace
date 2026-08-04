export type Theme = "light" | "dark";

const KEY = "rp-theme";

export function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch { /* private mode — fall through to the media query */ }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(t: Theme): void {
  document.documentElement.classList.toggle("dark", t === "dark");
  try { localStorage.setItem(KEY, t); } catch { /* nothing to do */ }
}
