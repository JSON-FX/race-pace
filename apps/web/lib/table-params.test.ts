import { describe, it, expect } from "vitest";
import { parseTableParams, serializeTableParams, serializeSectionKey, rangeLabel, DEFAULT_PER } from "./table-params";

describe("parseTableParams", () => {
  it("returns defaults for an empty query string", () => {
    const p = parseTableParams({});
    expect(p).toEqual({ page: 1, per: DEFAULT_PER, sort: [], filters: {}, q: "" });
  });

  it("parses page, per and q", () => {
    const p = parseTableParams({ page: "3", per: "50", q: "santos" });
    expect(p.page).toBe(3);
    expect(p.per).toBe(50);
    expect(p.q).toBe("santos");
  });

  it("clamps an unlisted per value to the default", () => {
    expect(parseTableParams({ per: "37" }).per).toBe(DEFAULT_PER);
    expect(parseTableParams({ per: "0" }).per).toBe(DEFAULT_PER);
    expect(parseTableParams({ per: "abc" }).per).toBe(DEFAULT_PER);
  });

  it("clamps page below 1 to 1", () => {
    expect(parseTableParams({ page: "0" }).page).toBe(1);
    expect(parseTableParams({ page: "-4" }).page).toBe(1);
    expect(parseTableParams({ page: "nope" }).page).toBe(1);
  });

  it("parses a multi-column sort", () => {
    expect(parseTableParams({ sort: "created_at:desc,full_name:asc" }).sort).toEqual([
      { id: "created_at", desc: true },
      { id: "full_name", desc: false },
    ]);
  });

  it("falls back to the default sort when sort is absent", () => {
    const d = { sort: [{ id: "event_date", desc: false }] };
    expect(parseTableParams({}, d).sort).toEqual(d.sort);
  });

  it("treats unreserved keys as filters, over defaults", () => {
    const p = parseTableParams({ status: "paid", event: "e1" }, { filters: { status: "all", category: "all" } });
    expect(p.filters).toEqual({ status: "paid", category: "all", event: "e1" });
  });

  it("ignores array-valued params by taking the first entry", () => {
    expect(parseTableParams({ status: ["paid", "pending"] }).filters.status).toBe("paid");
  });
});

describe("serializeTableParams", () => {
  it("omits defaults so the clean URL stays clean", () => {
    expect(serializeTableParams({ page: 1, per: DEFAULT_PER, q: "", sort: [], filters: {} }).toString()).toBe("");
  });

  it("emits only non-default values", () => {
    const s = serializeTableParams({ page: 3, per: 50, q: "cruz", filters: { status: "paid", category: "all" } });
    expect(s.get("page")).toBe("3");
    expect(s.get("per")).toBe("50");
    expect(s.get("q")).toBe("cruz");
    expect(s.get("status")).toBe("paid");
    expect(s.get("category")).toBeNull();
  });

  it("round-trips through parse", () => {
    const original = { page: 2, per: 100, q: "dela cruz", sort: [{ id: "amount", desc: true }], filters: { status: "refunded" } };
    const parsed = parseTableParams(Object.fromEntries(serializeTableParams(original)));
    expect(parsed).toEqual(original);
  });
});

describe("serializeSectionKey", () => {
  const DEFAULTS = { sort: [{ id: "created_at", desc: true }], filters: { status: "all", category: "all" } };

  // THE bug this exists to prevent: `reg` addresses a modal, not a subset of
  // rows — no query reads it. While it fed the Suspense key, opening a
  // registration remounted both boundaries, flashed skeletons and re-fetched
  // byte-identical data. A key must describe only what its sections query.
  it("ignores UI-only params so opening a modal cannot change the key", () => {
    const base = parseTableParams({ event: "e1", status: "paid" }, DEFAULTS);
    const withModal = parseTableParams({ event: "e1", status: "paid", reg: "r-123" }, DEFAULTS);
    expect(serializeSectionKey(withModal, DEFAULTS)).toBe(serializeSectionKey(base, DEFAULTS));
  });

  it("still changes when a param the sections actually query changes", () => {
    const a = parseTableParams({ event: "e1", status: "paid" }, DEFAULTS);
    for (const next of [{ event: "e2", status: "paid" }, { event: "e1", status: "pending" },
                        { event: "e1", status: "paid", page: "2" }, { event: "e1", status: "paid", q: "maria" }]) {
      expect(serializeSectionKey(parseTableParams(next, DEFAULTS), DEFAULTS))
        .not.toBe(serializeSectionKey(a, DEFAULTS));
    }
  });
});

describe("rangeLabel", () => {
  it("describes the visible slice", () => {
    expect(rangeLabel(3, 25, 791)).toBe("51–75 of 791");
  });
  it("caps the upper bound at the total on the last page", () => {
    expect(rangeLabel(32, 25, 791)).toBe("776–791 of 791");
  });
  it("reads as zero when there are no rows", () => {
    expect(rangeLabel(1, 25, 0)).toBe("0 of 0");
  });
});
