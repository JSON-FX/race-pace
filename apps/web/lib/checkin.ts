export type RosterRow = {
  registration_id: string; ticket_token: string; runner: string;
  bib: string | null; category: string; status: string; checked_in_at: string | null;
};

/**
 * Shape check for a scanned ticket, run BEFORE hitting the network.
 *
 * The token is base64url `payload.signature` (functions/_shared/ticket.ts). A
 * hardware wedge scanner on a non-US keyboard layout mistranslates the `-` and
 * `_` that base64url uses, producing `/` and `+`. Catching that here lets the UI
 * say "check your scanner's keyboard layout" instead of "invalid ticket", which
 * would send a marshal hunting for a problem with the runner's phone.
 *
 * This is NOT verification. The HMAC is checked server-side by the `check-in`
 * Edge Function — matching client-side against the roster's ticket_token would
 * accept a screenshot of someone else's QR.
 */
export function isTicketTokenShape(s: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s);
}

/** One roster query feeds both tables: split on whether the runner is in yet. */
export function splitRoster(rows: RosterRow[]): { pending: RosterRow[]; done: RosterRow[] } {
  const pending = rows.filter((r) => !r.checked_in_at);
  const done = rows.filter((r) => r.checked_in_at)
    .sort((a, b) => (b.checked_in_at ?? "").localeCompare(a.checked_in_at ?? ""));
  return { pending, done };
}

/** Client-side over rows already in memory — instant, and no round trip on a
 *  connection that may be barely alive at a mountain start line. */
export function filterRoster(rows: RosterRow[], q: string, category: string): RosterRow[] {
  const term = q.trim().toLowerCase();
  return rows.filter((r) => {
    if (category !== "all" && r.category !== category) return false;
    if (!term) return true;
    return r.runner.toLowerCase().includes(term) || (r.bib ?? "").toLowerCase().includes(term);
  });
}
