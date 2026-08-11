import type { RegistrationRow } from "./registration";
import { holdExpired } from "./holdExpiry";

export type SegmentKey = "registered" | "completed" | "unpaid";

export type MyRacesGroups = {
  registered: RegistrationRow[];
  completed: RegistrationRow[];
  unpaid: RegistrationRow[];
  counts: { registered: number; completed: number; unpaid: number };
};

/** Split registrations into the three My Races segments. Pure — `todayIso`
 *  ("YYYY-MM-DD") is injected so the split is deterministic and testable.
 *  ISO dates compare lexically, so no Date parsing is needed.
 *
 *  A `pending` row whose hold has actually run out (holdExpired) is routed to
 *  `completed`, the same bucket a swept `expired` row lands in — not
 *  `unpaid`. `status` stays literally `'pending'` until the 15-minute sweep
 *  flips it, so gating on raw status alone would keep offering a Pay button
 *  the server will refuse the instant it's tapped (registrations-checkout's
 *  own lazy-expiry check). Filtering lapsed holds out of `unpaid` here means
 *  every row that DOES land in `unpaid` is genuinely still payable — callers
 *  don't need to re-check holdExpired per row before rendering a Pay CTA.
 *
 *  `expired` used to fall through every branch below and vanish from all
 *  three segments — a registration that just silently disappeared from the
 *  runner's list. It now joins `completed`, the "this entry's story is over"
 *  bucket, alongside `refunded`. */
export function groupMyRaces(rows: RegistrationRow[], todayIso: string): MyRacesGroups {
  const registered: RegistrationRow[] = [];
  const completed: RegistrationRow[] = [];
  const unpaid: RegistrationRow[] = [];

  for (const r of rows) {
    if (r.status === "pending" && holdExpired(r.status, r.expiresAt)) {
      completed.push(r);
    } else if (r.status === "pending") {
      unpaid.push(r);
    } else if (r.status === "refunded" || r.status === "expired") {
      completed.push(r);
    } else if (r.status === "paid") {
      const isPast = r.eventStatus === "completed" || (r.eventDate != null && r.eventDate < todayIso);
      (isPast ? completed : registered).push(r);
    }
    // "cancelled" (cancel hard-deletes) and any other unknown status are excluded.
  }

  return {
    registered,
    completed,
    unpaid,
    counts: { registered: registered.length, completed: completed.length, unpaid: unpaid.length },
  };
}

/** Initial segment: Registered, unless it's empty and there are unpaid items to act on. */
export function defaultSegment(groups: MyRacesGroups): SegmentKey {
  if (groups.counts.registered === 0 && groups.counts.unpaid > 0) return "unpaid";
  return "registered";
}
