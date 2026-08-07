import { describe, expect, it } from "vitest";
import { fieldLabel, fieldValue } from "./field-labels";

describe("fieldLabel", () => {
  it("de-slugs a snake_case key into sentence case", () => {
    expect(fieldLabel("blood_type")).toBe("Blood type");
    expect(fieldLabel("drop_bag_points")).toBe("Drop bag points");
  });

  it("lowercases the tail, so a key that arrives shouty still reads as a label", () => {
    expect(fieldLabel("SHIRT_SIZE")).toBe("Shirt size");
  });

  it("handles hyphens and a single word", () => {
    expect(fieldLabel("pace-group")).toBe("Pace group");
    expect(fieldLabel("barangay")).toBe("Barangay");
  });

  it("uses the override where de-slugging would mangle an acronym", () => {
    expect(fieldLabel("city_psgc_code")).toBe("City (PSGC)");
  });

  it("returns the key unchanged rather than an empty label", () => {
    expect(fieldLabel("_")).toBe("_");
  });
});

describe("fieldValue", () => {
  it("renders checkbox booleans as words, not 'true'", () => {
    expect(fieldValue(true)).toBe("Yes");
    expect(fieldValue(false)).toBe("No");
  });

  it("renders an absent or blank answer as an em dash", () => {
    expect(fieldValue(null)).toBe("—");
    expect(fieldValue(undefined)).toBe("—");
    expect(fieldValue("   ")).toBe("—");
  });

  it("passes strings and numbers through", () => {
    expect(fieldValue("Malaybalay Runners Club")).toBe("Malaybalay Runners Club");
    expect(fieldValue(42)).toBe("42");
  });

  it("joins arrays and drops the empty entries", () => {
    expect(fieldValue(["S", "M"])).toBe("S, M");
    expect(fieldValue([])).toBe("—");
    expect(fieldValue([null, "M"])).toBe("M");
  });

  it("never renders [object Object]", () => {
    expect(fieldValue({ a: 1 })).toBe('{"a":1}');
  });
});
