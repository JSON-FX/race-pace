import { describe, it, expect } from "vitest";
import { toLocalInput, fromLocalInput } from "./deadlines";

describe("deadline input conversion", () => {
  it("round-trips a local datetime through ISO", () => {
    const iso = fromLocalInput("2026-08-25T23:59");
    expect(iso).not.toBeNull();
    expect(toLocalInput(iso)).toBe("2026-08-25T23:59");
  });

  it("treats an empty input as no deadline", () => {
    expect(fromLocalInput("")).toBeNull();
  });

  it("renders an empty string for a null deadline", () => {
    expect(toLocalInput(null)).toBe("");
  });

  // The toLocalInput(fromLocalInput(x)) round trip above passes under any *symmetric* bug
  // (e.g. swapping both functions to UTC accessors) even though the stored instant would then
  // be wrong by the local UTC offset. Pin the absolute instant instead: the epoch ms that
  // fromLocalInput() produces for a given local wall-clock string must equal what `new
  // Date(y, m, d, h, min)` (local-timezone constructor, matching what the datetime-local input
  // actually means) resolves to. This is the only thing standing between a `datetime-local`
  // input and a `timestamptz` column, so it needs to be right in every process timezone, not
  // just the one the round-trip test happens to run under.
  it("preserves the absolute instant of the intended local wall-clock time", () => {
    const iso = fromLocalInput("2026-08-25T23:59");
    expect(iso).not.toBeNull();
    const expectedEpochMs = new Date(2026, 7, 25, 23, 59, 0, 0).getTime(); // month is 0-indexed
    expect(Date.parse(iso!)).toBe(expectedEpochMs);
  });
});
