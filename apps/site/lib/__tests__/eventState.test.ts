import { describe, it, expect } from "vitest";
import { eventState, STATE_BADGE } from "../eventState";

const TODAY = "2026-08-06";
const base = { status: "open", event_date: "2026-12-01", end_date: null, original_date: null };

describe("eventState", () => {
  it("is open for a plain future race", () => {
    expect(eventState(base, TODAY)).toBe("open");
  });

  it("is cancelled even when today falls inside its dates", () => {
    expect(
      eventState({ ...base, status: "cancelled", event_date: "2026-08-05", end_date: "2026-08-07" }, TODAY),
    ).toBe("cancelled");
  });

  it("is ongoing when today is inside a multi-day window", () => {
    expect(eventState({ ...base, status: "closed", event_date: "2026-08-05", end_date: "2026-08-07" }, TODAY)).toBe(
      "ongoing",
    );
  });

  it("is ongoing on the first and last day of the window, inclusive", () => {
    expect(eventState({ ...base, event_date: "2026-08-06", end_date: "2026-08-09" }, TODAY)).toBe("ongoing");
    expect(eventState({ ...base, event_date: "2026-08-01", end_date: "2026-08-06" }, TODAY)).toBe("ongoing");
  });

  it("is ongoing for a single-day race happening today, with no end_date", () => {
    expect(eventState({ ...base, event_date: TODAY, end_date: null }, TODAY)).toBe("ongoing");
  });

  it("is not ongoing the day before or the day after", () => {
    expect(eventState({ ...base, event_date: "2026-08-07", end_date: "2026-08-08" }, TODAY)).toBe("open");
    expect(eventState({ ...base, status: "closed", event_date: "2026-08-04", end_date: "2026-08-05" }, TODAY)).toBe(
      "closed",
    );
  });

  it("is rescheduled when original_date is set", () => {
    expect(eventState({ ...base, original_date: "2026-08-29" }, TODAY)).toBe("rescheduled");
  });

  it("prefers ongoing over rescheduled for a moved race that has started", () => {
    expect(
      eventState({ ...base, original_date: "2026-07-01", event_date: "2026-08-05", end_date: "2026-08-07" }, TODAY),
    ).toBe("ongoing");
  });

  it("prefers rescheduled over almost_full", () => {
    expect(eventState({ ...base, status: "almost_full", original_date: "2026-08-29" }, TODAY)).toBe("rescheduled");
  });

  it("reports completed for a past race, not rescheduled", () => {
    expect(
      eventState({ ...base, status: "completed", event_date: "2026-06-20", original_date: "2026-05-01" }, TODAY),
    ).toBe("completed");
  });

  it("passes through almost_full and closed", () => {
    expect(eventState({ ...base, status: "almost_full" }, TODAY)).toBe("almost_full");
    expect(eventState({ ...base, status: "closed" }, TODAY)).toBe("closed");
  });

  it("handles an event with no dates at all", () => {
    expect(eventState({ ...base, event_date: null, end_date: null }, TODAY)).toBe("open");
  });

  it("has a badge for every state except open", () => {
    for (const s of ["cancelled", "ongoing", "rescheduled", "almost_full", "closed", "completed"] as const) {
      expect(STATE_BADGE[s].label.length).toBeGreaterThan(0);
    }
    expect(STATE_BADGE).not.toHaveProperty("open");
  });
});
