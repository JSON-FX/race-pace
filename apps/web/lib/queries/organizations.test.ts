import { describe, it, expect } from "vitest";
import { normalizeSlug, isValidSlug, describeCommission } from "./organizations";

describe("normalizeSlug", () => {
  it("lowercases and kebabs an ordinary name", () => {
    expect(normalizeSlug("Race Pace")).toBe("race-pace");
  });

  it("collapses runs of punctuation and whitespace into one hyphen", () => {
    // "Muspo  --  Trail   Co." must not become "muspo------trail---co-".
    expect(normalizeSlug("Muspo  --  Trail   Co.")).toBe("muspo-trail-co");
  });

  it("trims leading and trailing separators", () => {
    expect(normalizeSlug("  -Run With Point-  ")).toBe("run-with-point");
  });

  it("folds diacritics instead of dropping the letter", () => {
    // Dropping would give "pe-afrancia" — a hole in the middle of a word,
    // which is worse than transliterating.
    expect(normalizeSlug("Peñafrancia Runners")).toBe("penafrancia-runners");
    expect(normalizeSlug("Ñuñoa")).toBe("nunoa");
  });

  it("keeps digits", () => {
    expect(normalizeSlug("50K Series 2026")).toBe("50k-series-2026");
  });

  it("is idempotent — normalising an already-normal slug changes nothing", () => {
    // The dialog normalises for display and the edge function normalises again
    // for storage. If this were not idempotent the two would disagree about
    // what the operator just reserved.
    const once = normalizeSlug("Peñafrancia  Runners!!");
    expect(normalizeSlug(once)).toBe(once);
  });

  it("returns an empty string when nothing survives", () => {
    expect(normalizeSlug("***")).toBe("");
    expect(normalizeSlug("   ")).toBe("");
  });
});

describe("isValidSlug", () => {
  it("accepts what normalizeSlug produces", () => {
    for (const s of ["race-pace", "muspo", "50k-series-2026"]) {
      expect(isValidSlug(normalizeSlug(s))).toBe(true);
    }
  });

  it("rejects the empty string", () => {
    // "***" normalises to "" — that is "this name has no usable slug", which
    // must not be offered as available.
    expect(isValidSlug("")).toBe(false);
  });

  it("rejects leading, trailing and doubled hyphens", () => {
    expect(isValidSlug("-race")).toBe(false);
    expect(isValidSlug("race-")).toBe(false);
    expect(isValidSlug("race--pace")).toBe(false);
  });

  it("rejects uppercase and spaces", () => {
    expect(isValidSlug("Race-Pace")).toBe(false);
    expect(isValidSlug("race pace")).toBe(false);
  });
});

describe("describeCommission", () => {
  it("renders a percentage to one decimal", () => {
    expect(describeCommission({
      commission_type: "percent", commission_rate: 0.1, commission_flat_cents: 0,
    })).toEqual({ label: "10.0%", zero: false });
  });

  it("renders a flat fee in pesos, never bare", () => {
    // "75" in a column of "10.0%" reads as 75%.
    expect(describeCommission({
      commission_type: "fixed", commission_rate: null, commission_flat_cents: 7500,
    })).toEqual({ label: "₱75 flat", zero: false });
  });

  it("flags a zero flat fee — an org the platform earns nothing from", () => {
    expect(describeCommission({
      commission_type: "fixed", commission_rate: null, commission_flat_cents: 0,
    }).zero).toBe(true);
  });

  it("flags a zero percentage on the same grounds", () => {
    expect(describeCommission({
      commission_type: "percent", commission_rate: 0, commission_flat_cents: 0,
    }).zero).toBe(true);
  });

  it("treats a null rate as zero rather than rendering NaN", () => {
    expect(describeCommission({
      commission_type: null, commission_rate: null, commission_flat_cents: null,
    })).toEqual({ label: "0.0%", zero: true });
  });
});
