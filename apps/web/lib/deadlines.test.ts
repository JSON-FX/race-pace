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
});
