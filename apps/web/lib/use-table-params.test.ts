import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Real hook under test — deliberately NOT using the shared DataTable mock
// here, since this is exactly the test that must exercise the actual
// "all"-sentinel and preserve-list logic rather than a mock's
// re-implementation of it.
const pushMock = vi.hoisted(() => vi.fn());
let mockPathname = "/admin/registrations";
let mockSearch = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

import { useTableParams } from "./use-table-params";

beforeEach(() => {
  pushMock.mockClear();
  mockPathname = "/admin/registrations";
  mockSearch = "";
});

/** Pull the query params React Router was actually asked to navigate to,
 *  independent of key order or percent-encoding. */
function pushedParams(): URLSearchParams {
  expect(pushMock).toHaveBeenCalledTimes(1);
  const url = pushMock.mock.calls[0][0] as string;
  const [, qs = ""] = url.split("?");
  return new URLSearchParams(qs);
}

function setupHook() {
  return renderHook(() => useTableParams());
}

describe("useTableParams", () => {
  it("setPage writes ?page=N", () => {
    const { result } = setupHook();
    act(() => result.current.setPage(5));
    expect(pushedParams().get("page")).toBe("5");
  });

  it("setPage(1) omits the param — page 1 is the implicit default", () => {
    mockSearch = "page=3";
    const { result } = setupHook();
    act(() => result.current.setPage(1));
    expect(pushedParams().has("page")).toBe(false);
  });

  it("setPer writes ?per=N and resets to page 1", () => {
    mockSearch = "page=4";
    const { result } = setupHook();
    act(() => result.current.setPer(50));
    const p = pushedParams();
    expect(p.get("per")).toBe("50");
    expect(p.has("page")).toBe(false);
  });

  it("setPer(DEFAULT_PER) omits the param", () => {
    mockSearch = "per=50";
    const { result } = setupHook();
    act(() => result.current.setPer(25));
    expect(pushedParams().has("per")).toBe(false);
  });

  it("setSort writes id:dir and resets to page 1", () => {
    mockSearch = "page=2";
    const { result } = setupHook();
    act(() => result.current.setSort([{ id: "name", desc: true }]));
    const p = pushedParams();
    expect(p.get("sort")).toBe("name:desc");
    expect(p.has("page")).toBe(false);
  });

  it("setSort([]) clears the sort param", () => {
    mockSearch = "sort=name:asc";
    const { result } = setupHook();
    act(() => result.current.setSort([]));
    expect(pushedParams().has("sort")).toBe(false);
  });

  it("setFilter writes the raw value and resets to page 1", () => {
    mockSearch = "page=2";
    const { result } = setupHook();
    act(() => result.current.setFilter("status", "paid"));
    const p = pushedParams();
    expect(p.get("status")).toBe("paid");
    expect(p.has("page")).toBe(false);
  });

  // I1: the "all" sentinel is a FILTER concept — setFilter must translate it
  // to a key removal itself, not rely on a shared `patch` special case.
  it('setFilter("all") removes the filter key', () => {
    mockSearch = "status=paid";
    const { result } = setupHook();
    act(() => result.current.setFilter("status", "all"));
    expect(pushedParams().has("status")).toBe(false);
  });

  // I1, the actual regression: a real search for the word "all" must not be
  // silently dropped by `patch`'s old blanket "all" == remove rule.
  it('setQ("all") keeps the literal search text — patch no longer treats "all" as a delete sentinel', () => {
    const { result } = setupHook();
    act(() => result.current.setQ("all"));
    expect(pushedParams().get("q")).toBe("all");
  });

  it("setQ('') clears the search", () => {
    mockSearch = "q=maria";
    const { result } = setupHook();
    act(() => result.current.setQ(""));
    expect(pushedParams().has("q")).toBe(false);
  });

  it("clearFilters() drops filters and q, keeps sort and per", () => {
    mockSearch = "status=paid&q=maria&sort=name:asc&per=50&page=3";
    const { result } = setupHook();
    act(() => result.current.clearFilters());
    const p = pushedParams();
    expect(p.has("status")).toBe(false);
    expect(p.has("q")).toBe(false);
    expect(p.has("page")).toBe(false);
    expect(p.get("sort")).toBe("name:asc");
    expect(p.get("per")).toBe("50");
  });

  // I4: a page with a structural scoping param (Registrations' `?event=`)
  // must be able to protect it from "Clear all", on top of sort/per.
  it("clearFilters(keep) also preserves the given param keys", () => {
    mockSearch = "event=abc-123&status=paid&q=maria&sort=name:asc&per=50";
    const { result } = setupHook();
    act(() => result.current.clearFilters(["event"]));
    const p = pushedParams();
    expect(p.get("event")).toBe("abc-123");
    expect(p.get("sort")).toBe("name:asc");
    expect(p.get("per")).toBe("50");
    expect(p.has("status")).toBe(false);
    expect(p.has("q")).toBe(false);
  });

  // Regression guard for stabilising the setters with useCallback: every
  // setter (and clearFilters) now depends on `patch`'s deps
  // (pathname/router/searchParams) so callers can safely put them in a
  // memo dependency array without freezing on a stale closure. clearFilters
  // reads `searchParams` directly (not via `patch`) to decide what to
  // *delete*, so it's the one most at risk of silently reading a stale
  // snapshot from mount if the useCallback deps were ever wrong — verify it
  // picks up a URL change that happens AFTER the hook first rendered,
  // rather than the query string captured at mount.
  it("clearFilters reflects a live URL change after mount, not a stale searchParams closure", () => {
    mockSearch = "status=paid&sort=name:asc&per=50";
    const { result, rerender } = setupHook();
    // Simulate the URL moving on after mount (e.g. the event picker fired,
    // or a Back navigation) — a stale closure captured at mount would still
    // only see the OLD query string here and silently drop `event`.
    mockSearch = "status=paid&category=c1&sort=name:asc&per=50&event=e9";
    rerender();
    act(() => result.current.clearFilters(["event"]));
    const p = pushedParams();
    expect(p.get("event")).toBe("e9");
    expect(p.get("sort")).toBe("name:asc");
    expect(p.get("per")).toBe("50");
    expect(p.has("status")).toBe(false);
    expect(p.has("category")).toBe(false);
  });
});
