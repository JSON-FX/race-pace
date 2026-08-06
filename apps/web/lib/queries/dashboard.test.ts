import { describe, it, expect } from "vitest";
import { buildSparkPath } from "./dashboard";

describe("buildSparkPath", () => {
  it("spans the full width and inverts y so higher values sit higher", () => {
    const { line } = buildSparkPath([{ d: "a", n: 0 }, { d: "b", n: 10 }], 100, 50);
    expect(line).toBe("M0 50 L100 0");
  });

  it("keeps a flat series on a mid-height line rather than dividing by zero", () => {
    const { line } = buildSparkPath([{ d: "a", n: 5 }, { d: "b", n: 5 }], 100, 50);
    expect(line).toBe("M0 25 L100 25");
  });

  it("closes the area path back to the baseline", () => {
    const { area } = buildSparkPath([{ d: "a", n: 0 }, { d: "b", n: 10 }], 100, 50);
    expect(area.endsWith("V50 H0 Z")).toBe(true);
  });

  it("returns empty paths for an empty series", () => {
    expect(buildSparkPath([], 100, 50)).toEqual({ line: "", area: "" });
  });

  it("handles a single point without NaN", () => {
    const { line } = buildSparkPath([{ d: "a", n: 3 }], 100, 50);
    expect(line).not.toContain("NaN");
  });
});
