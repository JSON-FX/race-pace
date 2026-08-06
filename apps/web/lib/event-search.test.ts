import { describe, it, expect } from "vitest";
import { searchEvents } from "./event-search";

const ev = (name: string, subtitle?: string) => ({ id: name, name, subtitle });

const EVENTS = [
  ev("Valencia Twin Peaks", "Muspo"),
  ev("Kalatungan Traverse", "Muspo"),
  ev("Kitanglad Skyline Ultra", "Muspo"),
  ev("Malaybalay Highland Trail", "RunWithPoint"),
  ev("Talakag Forest Loop", "Kitanglad Running Club"),
];

describe("searchEvents", () => {
  it("returns everything for an empty query, in the caller's order", () => {
    expect(searchEvents(EVENTS, "").map((e) => e.name)).toEqual(EVENTS.map((e) => e.name));
    expect(searchEvents(EVENTS, "   ").map((e) => e.name)).toEqual(EVENTS.map((e) => e.name));
  });

  it("matches a name prefix", () => {
    expect(searchEvents(EVENTS, "kita").map((e) => e.name)).toEqual([
      "Kitanglad Skyline Ultra",
      "Talakag Forest Loop", // subtitle match, ranked last
    ]);
  });

  it("ranks a name match above a subtitle match", () => {
    // The event actually CALLED Kitanglad must beat the one whose organizer is.
    // At a start line, picking the wrong event checks runners into the wrong race.
    const [first] = searchEvents(EVENTS, "kitanglad");
    expect(first.name).toBe("Kitanglad Skyline Ultra");
  });

  it("ranks a leading word above a mid-word match", () => {
    const names = searchEvents([ev("Trail Blazer 10K"), ev("Highland Trail"), ev("Contrail Run")], "trail")
      .map((e) => e.name);
    expect(names).toEqual(["Trail Blazer 10K", "Highland Trail", "Contrail Run"]);
  });

  it("is case-insensitive", () => {
    expect(searchEvents(EVENTS, "VALENCIA")[0].name).toBe("Valencia Twin Peaks");
  });

  it("ignores accents", () => {
    expect(searchEvents([ev("Peñaranda Trail")], "penaranda")).toHaveLength(1);
    expect(searchEvents([ev("Penaranda Trail")], "peñaranda")).toHaveLength(1);
  });

  it("collapses repeated whitespace in the query", () => {
    expect(searchEvents(EVENTS, "  twin   peaks  ")).toHaveLength(1);
  });

  it("returns nothing when there is no match, rather than everything", () => {
    // An empty result must be distinguishable from "no filter" — otherwise the
    // combobox silently shows all 100 events and the operator picks a wrong one.
    expect(searchEvents(EVENTS, "zzz")).toEqual([]);
  });

  it("does not fuzzy-match across gaps", () => {
    // "kln" must NOT match "Kalatungan" — a wrong event at a start line is worse
    // than one more keystroke.
    expect(searchEvents(EVENTS, "kln")).toEqual([]);
  });

  it("keeps the original order within the same rank", () => {
    const list = [ev("Run A"), ev("Run B"), ev("Run C")];
    expect(searchEvents(list, "run").map((e) => e.name)).toEqual(["Run A", "Run B", "Run C"]);
  });

  it("tolerates a missing subtitle", () => {
    expect(searchEvents([{ id: "1", name: "Solo Race" }], "solo")).toHaveLength(1);
    expect(searchEvents([{ id: "1", name: "Solo Race", subtitle: null }], "muspo")).toEqual([]);
  });
});
