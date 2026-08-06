import { describe, it, expect } from "vitest";
import { isTicketTokenShape, splitRoster, filterRoster } from "./checkin";

const row = (o: Partial<Parameters<typeof splitRoster>[0][0]>) => ({
  registration_id: "r", ticket_token: "t", runner: "Aleth Ramos", bib: "ALETH",
  category: "50K", status: "paid", checked_in_at: null, ...o,
} as Parameters<typeof splitRoster>[0][0]);

describe("isTicketTokenShape", () => {
  it("accepts a base64url payload.signature", () => {
    expect(isTicketTokenShape("eyJyaWQiOiJhYmMifQ.c2ln-X_9")).toBe(true);
  });

  it("rejects a token mangled by a non-US keyboard layout", () => {
    // A wedge scanner on the wrong layout mistranslates the - and _ that
    // base64url uses. Catching it here lets the UI say "check your scanner
    // layout" instead of the useless "invalid ticket".
    expect(isTicketTokenShape("eyJyaWQiOiJhYmMifQ.c2ln/X+9")).toBe(false);
  });

  it("rejects text with no separator", () => {
    expect(isTicketTokenShape("justsometext")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isTicketTokenShape("")).toBe(false);
  });
});

describe("splitRoster", () => {
  it("splits on checked_in_at", () => {
    const { pending, done } = splitRoster([
      row({ registration_id: "a" }),
      row({ registration_id: "b", checked_in_at: "2026-08-24T00:14:00Z" }),
    ]);
    expect(pending.map((r) => r.registration_id)).toEqual(["a"]);
    expect(done.map((r) => r.registration_id)).toEqual(["b"]);
  });

  it("orders the checked-in list most recent first", () => {
    const { done } = splitRoster([
      row({ registration_id: "a", checked_in_at: "2026-08-24T00:10:00Z" }),
      row({ registration_id: "b", checked_in_at: "2026-08-24T00:14:00Z" }),
    ]);
    expect(done.map((r) => r.registration_id)).toEqual(["b", "a"]);
  });
});

describe("filterRoster", () => {
  it("matches on runner name, case-insensitively", () => {
    expect(filterRoster([row({}), row({ runner: "Bea Molina" })], "bea", "all")).toHaveLength(1);
  });

  it("matches on bib", () => {
    expect(filterRoster([row({}), row({ bib: "MIGGY" })], "miggy", "all")).toHaveLength(1);
  });

  it("filters by category", () => {
    expect(filterRoster([row({}), row({ category: "21K" })], "", "21K")).toHaveLength(1);
  });

  it("returns everything for an empty query and 'all'", () => {
    expect(filterRoster([row({}), row({ runner: "X" })], "  ", "all")).toHaveLength(2);
  });
});
