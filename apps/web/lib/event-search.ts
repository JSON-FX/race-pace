/**
 * Ranking for the event combobox's search box.
 *
 * Pure, and in its own module rather than inside the component, so the matching
 * rule is testable without rendering — and so a Client Component can import it
 * without dragging `next/headers` in through a query module (see
 * lib/nav-items.ts for the precedent).
 *
 * Substring, not fuzzy: an organizer typing "kita" for "Kitanglad Skyline
 * Ultra" is completing a name they already know, not exploring. Fuzzy matching
 * would also surface "Kalilangan Loop Run" for that query, and a wrong event
 * picked at a start line checks runners into the wrong race.
 */

export type SearchableEvent = { id: string; name: string; subtitle?: string | null };

/** Normalise for comparison: case- and accent-insensitive, whitespace-collapsed. */
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Filter and rank events for a query.
 *
 * A prefix match on the name outranks a match in the middle, which outranks a
 * match in the subtitle. With 100+ events "Kitanglad" should put *Kitanglad
 * Skyline Ultra* first, not whichever event happens to sort earliest and
 * mentions it in an org name.
 *
 * Ties keep the caller's original order, which is already meaningful — the
 * check-in RPC sorts by date, so an empty query shows the next race first.
 */
export function searchEvents<T extends SearchableEvent>(events: T[], query: string): T[] {
  const q = fold(query);
  if (!q) return events;

  const scored: { item: T; rank: number; index: number }[] = [];
  events.forEach((item, index) => {
    const name = fold(item.name);
    const sub = item.subtitle ? fold(item.subtitle) : "";

    let rank: number;
    if (name.startsWith(q)) rank = 0;
    else if (name.includes(` ${q}`)) rank = 1; // start of any later word
    else if (name.includes(q)) rank = 2;
    else if (sub.includes(q)) rank = 3;
    else return;

    scored.push({ item, rank, index });
  });

  return scored
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((s) => s.item);
}
