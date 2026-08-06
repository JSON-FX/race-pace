import { vi } from "vitest";

/** Hoisted so vi.mock's factory can close over these without a TDZ error —
 *  vi.mock is lifted above every const in the importing test file.
 *  Declared then exported separately: vitest's hoisting transform rejects
 *  `export const x = vi.hoisted(...)` in the same statement. */
const tableParamsSpies = vi.hoisted(() => ({
  patch: vi.fn(),
  setPage: vi.fn(),
  setPer: vi.fn(),
  setSort: vi.fn(),
  setFilter: vi.fn((key: string, value: string) =>
    tableParamsSpies.patch({ [key]: value === "all" ? null : value, page: null }),
  ),
  setQ: vi.fn(),
  clearFilters: vi.fn(),
}));

export { tableParamsSpies };

// Registered at true module top level (not inside a function) so vitest's
// static hoisting picks it up without the "not at the top level" warning —
// vi.mock calls nested in a function body are still hoisted correctly today,
// but vitest has flagged that as deprecated.
vi.mock("@/lib/use-table-params", () => ({
  useTableParams: () => ({
    isPending: false,
    patch: tableParamsSpies.patch,
    setPage: tableParamsSpies.setPage,
    setPer: tableParamsSpies.setPer,
    setSort: tableParamsSpies.setSort,
    setFilter: tableParamsSpies.setFilter,
    setQ: tableParamsSpies.setQ,
    clearFilters: tableParamsSpies.clearFilters,
  }),
}));

/** Import this module for its side effect of mocking `useTableParams`, then
 *  call this once at module scope in the test file (before any `const` that
 *  needs it) purely to document the intent at the call site — the mock is
 *  already registered by the import above. */
export function mockUseTableParams() {}

export function resetTableParamsSpies() {
  for (const spy of Object.values(tableParamsSpies)) spy.mockClear();
}
