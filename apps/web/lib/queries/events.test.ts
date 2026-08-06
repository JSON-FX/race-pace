import { describe, it, expect } from "vitest";
import { toIlikePattern } from "./events";

describe("toIlikePattern", () => {
  it("wraps the term in a %...% substring pattern", () => {
    expect(toIlikePattern("cruz")).toBe("%cruz%");
  });

  it("rewrites a literal '*' to '%' — the same alias PostgREST applies to a raw ilike/like value", () => {
    // This is the crux of IMPORTANT 1: PostgREST auto-rewrites '*' to '%'
    // inside ilike/like (even quoted values), but a raw SQL `ilike` used by
    // an RPC does not. Normalizing '*' -> '%' here, once, before either
    // transport builds its query, is what keeps them in agreement — see
    // getRegistrationAggregates/getPaymentAggregates and their shared
    // `searchPattern()` helpers in registrations.ts/payments.ts.
    expect(toIlikePattern("Dahi*Sky")).toBe("%Dahi%Sky%");
    expect(toIlikePattern("*")).toBe("%%%");
  });

  it("escapes a literal '%' and '_' so they don't act as accidental SQL wildcards", () => {
    expect(toIlikePattern("50%")).toBe("%50\\%%");
    expect(toIlikePattern("D_1042")).toBe("%D\\_1042%");
  });

  it("escapes a literal backslash before applying the other rules", () => {
    expect(toIlikePattern("a\\b")).toBe("%a\\\\b%");
  });

  it("combines '*' and an escaped character in one term", () => {
    expect(toIlikePattern("50%*off")).toBe("%50\\%%off%");
  });
});
