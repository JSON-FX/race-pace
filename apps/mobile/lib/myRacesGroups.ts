import type { RegistrationRow } from "./registration";

export type SegmentKey = "registered" | "completed" | "unpaid";

export type MyRacesGroups = {
  registered: RegistrationRow[];
  completed: RegistrationRow[];
  unpaid: RegistrationRow[];
  counts: { registered: number; completed: number; unpaid: number };
};

/** Split registrations into the three My Races segments. Pure — `todayIso`
 *  ("YYYY-MM-DD") is injected so the split is deterministic and testable.
 *  ISO dates compare lexically, so no Date parsing is needed. */
export function groupMyRaces(rows: RegistrationRow[], todayIso: string): MyRacesGroups {
  const registered: RegistrationRow[] = [];
  const completed: RegistrationRow[] = [];
  const unpaid: RegistrationRow[] = [];

  for (const r of rows) {
    if (r.status === "pending") {
      unpaid.push(r);
    } else if (r.status === "refunded") {
      completed.push(r);
    } else if (r.status === "paid") {
      const isPast = r.eventStatus === "completed" || (r.eventDate != null && r.eventDate < todayIso);
      (isPast ? completed : registered).push(r);
    }
    // "cancelled" (cancel hard-deletes) and any unknown status are excluded.
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
