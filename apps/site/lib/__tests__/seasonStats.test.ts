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

const ev = (
  id: string,
  status: string,
  org_id: string,
  registration_closes_at: string | null = null,
) => ({ id, status, org_id, registration_closes_at });
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

  it("excludes an open-status event whose registration_closes_at has passed", async () => {
    // The events select has no generic type param, so this field is `any` —
    // a dropped column or a broken pass-through would not be a compile
    // error. This is the only thing that would catch it at runtime.
    const s = await fetchSeasonStats(db(
      [ev("a", "open", "o1", "2020-01-01T00:00:00Z")],
      [],
    ));
    expect(s.racesOpen).toBe(0);
  });

  it("includes an open-status event whose registration_closes_at is in the future", async () => {
    const s = await fetchSeasonStats(db(
      [ev("a", "open", "o1", "2099-01-01T00:00:00Z")],
      [],
    ));
    expect(s.racesOpen).toBe(1);
  });

  it("includes an open-status event with no registration_closes_at at all", async () => {
    // Must not regress: most events have no deadline, and those must keep
    // counting as open.
    const s = await fetchSeasonStats(db(
      [ev("a", "open", "o1", null)],
      [],
    ));
    expect(s.racesOpen).toBe(1);
  });

  it("fails soft — a query error must not block the sign-in form", async () => {
    const s = await fetchSeasonStats(db([], [], { error: true }));
    expect(s).toEqual({ racesOpen: 0, organizers: 0, longestKm: null });
  });
});
