import { describe, it, expect } from "vitest";
import { fetchSeasonStats } from "../seasonStats";

/** Minimal stub of the two `.from(...).select(...)` calls the query makes. */
function db(events: unknown, categories: unknown, opts: { error?: boolean } = {}) {
  return {
    from(table: string) {
      return {
        select: async () =>
          opts.error
            ? { data: null, error: { message: "boom" } }
            : { data: table === "events" ? events : categories, error: null },
      };
    },
  } as never;
}

const ev = (id: string, status: string, org_id: string) => ({ id, status, org_id });
const cat = (event_id: string, distance_km: number) => ({ event_id, distance_km });

describe("fetchSeasonStats", () => {
  it("counts only races a runner can still enter", async () => {
    // cancelled / closed / completed are not enterable — counting every row
    // would overstate the number next to "RACES OPEN" on the sign-in page.
    const s = await fetchSeasonStats(db(
      [
        ev("a", "open", "o1"),
        ev("b", "almost_full", "o1"),
        ev("c", "cancelled", "o2"),
        ev("d", "completed", "o2"),
        ev("e", "closed", "o2"),
      ],
      [],
    ));
    expect(s.racesOpen).toBe(2);
  });

  it("treats almost_full as open — it is tight on slots, not shut", async () => {
    const s = await fetchSeasonStats(db([ev("a", "almost_full", "o1")], []));
    expect(s.racesOpen).toBe(1);
  });

  it("counts DISTINCT organizers, and only those with an open race", async () => {
    const s = await fetchSeasonStats(db(
      [ev("a", "open", "o1"), ev("b", "open", "o1"), ev("c", "cancelled", "o2")],
      [],
    ));
    expect(s.organizers).toBe(1);
  });

  it("takes the longest distance across OPEN events only", async () => {
    const s = await fetchSeasonStats(db(
      [ev("a", "open", "o1"), ev("b", "cancelled", "o2")],
      [cat("a", 21), cat("a", 65), cat("b", 100)],
    ));
    // 100 belongs to a cancelled race — advertising it would promise a distance
    // nobody can enter.
    expect(s.longestKm).toBe(65);
  });

  it("ignores missing or zero distances rather than reporting 0 km", async () => {
    const s = await fetchSeasonStats(db(
      [ev("a", "open", "o1")],
      [cat("a", 0), { event_id: "a", distance_km: null }, cat("a", 42)],
    ));
    expect(s.longestKm).toBe(42);
  });

  it("returns null for longest when nothing has a distance", async () => {
    const s = await fetchSeasonStats(db([ev("a", "open", "o1")], []));
    expect(s.longestKm).toBeNull();
  });

  it("fails soft — a query error must not block the sign-in form", async () => {
    const s = await fetchSeasonStats(db([], [], { error: true }));
    expect(s).toEqual({ racesOpen: 0, organizers: 0, longestKm: null });
  });
});
