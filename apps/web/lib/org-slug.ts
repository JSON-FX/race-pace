/**
 * Slug rules, split out of `lib/queries/organizations.ts` for the same reason
 * `lib/nav-items.ts` and `lib/team-roles.ts` exist: the New-organization dialog
 * is a Client Component and needs these, but `queries/organizations.ts` imports
 * `@/lib/supabase/server`, which imports `next/headers` and cannot be bundled
 * for the browser (`next build` fails outright, it is not a warning).
 *
 * This file must therefore stay import-free of anything server-only.
 * `queries/organizations.ts` re-exports both functions, so server callers can
 * keep importing them from there.
 */

/**
 * Lowercase-kebab, ASCII only. Diacritics are folded rather than dropped, so
 * "Peñafrancia Runners" becomes "penafrancia-runners" and not
 * "pe-afrancia-runners" — a slug with a hole in the middle of a word is worse
 * than one that transliterates.
 *
 * Deliberately duplicated in `supabase/functions/org-provision/index.ts`: that
 * file runs on Deno and cannot import from `apps/web`. The dialog normalises
 * for display and for the availability probe, the function normalises again for
 * storage, and the two MUST agree — otherwise an operator is told one string is
 * available and gets a duplicate-key error for another. Change both together.
 */
export function normalizeSlug(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Matches the shape `normalizeSlug` produces, and nothing else. Used to tell
 *  "you have not typed enough yet" apart from "that name has no usable slug"
 *  (e.g. "***" normalises to the empty string, which must never be offered as
 *  available). */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}
