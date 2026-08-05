import { describe, it, expect } from "vitest";
import { totalAmount, stepOneErrors, showSaveBack } from "../wizard";
import type { Profile } from "../profile";

const addons = [
  { id: "a1", name: "Finisher shirt", price: 45000 },
  { id: "a2", name: "Drop bag", price: 15000 },
];

describe("totalAmount", () => {
  it("returns the base price when nothing is selected", () => {
    expect(totalAmount(250000, addons, [])).toBe(250000);
  });

  it("adds every selected add-on", () => {
    expect(totalAmount(250000, addons, ["a1", "a2"])).toBe(310000);
  });

  it("ignores an id that is not a real add-on", () => {
    expect(totalAmount(250000, addons, ["ghost"])).toBe(250000);
  });

  // Money is integer centavos end to end — a float here would reach PayMongo.
  it("stays an integer", () => {
    expect(Number.isInteger(totalAmount(250000, addons, ["a1"]))).toBe(true);
  });
});

describe("stepOneErrors", () => {
  it("is empty when every required field is filled", () => {
    expect(stepOneErrors({ bib_name: "JUAN", date_of_birth: "1990-01-01" }, ["bib_name", "date_of_birth"])).toEqual({});
  });

  it("flags a missing required field", () => {
    expect(stepOneErrors({ bib_name: "" }, ["bib_name"])).toEqual({ bib_name: "This is required." });
  });

  it("treats whitespace as missing", () => {
    expect(stepOneErrors({ bib_name: "   " }, ["bib_name"])).toEqual({ bib_name: "This is required." });
  });

  it("ignores fields the organizer did not request", () => {
    expect(stepOneErrors({ bib_name: "JUAN" }, ["bib_name"])).toEqual({});
  });
});

describe("showSaveBack", () => {
  const empty: Profile = { id: "u1", full_name: null, bib_name: null, city: null };

  it("offers save-back when the profile was empty and the runner filled a field", () => {
    expect(showSaveBack(empty, { shirt_size: "M" })).toBe(true);
  });

  it("offers save-back when the runner changed an existing value", () => {
    expect(showSaveBack({ ...empty, shirt_size: "S" }, { shirt_size: "M" })).toBe(true);
  });

  it("stays hidden when nothing changed", () => {
    expect(showSaveBack({ ...empty, shirt_size: "M" }, { shirt_size: "M" })).toBe(false);
  });

  it("stays hidden when the runner cleared a field rather than setting one", () => {
    expect(showSaveBack({ ...empty, shirt_size: "M" }, { shirt_size: "" })).toBe(false);
  });

  it("handles a null profile for a brand-new account", () => {
    expect(showSaveBack(null, { shirt_size: "M" })).toBe(true);
  });

  // gender lives in draft.details, not draft.kit — the wizard passes a merged
  // object, so this key must be honoured too.
  it("offers save-back for gender", () => {
    expect(showSaveBack(empty, { gender: "Male" })).toBe(true);
  });
});
