import { vi } from "vitest";

/**
 * Shared spies + mock-return value for `@/lib/use-table-params`, for any
 * test that renders `<DataTable>` (or anything else that calls
 * `useTableParams()`) outside a real Next router.
 *
 * IMPORTANT — copy this exact two-line pattern into every consuming test
 * file, at true top level, right after your imports:
 *
 *   import { tableParamsMockReturn, resetTableParamsSpies } from "@/lib/test-utils/mock-table-params";
 *
 *   vi.mock("@/lib/use-table-params", () => ({ useTableParams: () => tableParamsMockReturn }));
 *
 * Do NOT wrap that `vi.mock` call in a helper function and call the helper
 * instead (an earlier version of this module did that). It happened to work
 * only because the helper's import was written first in the test file —
 * vitest hoists `vi.mock` calls that are written directly in a test file
 * above that file's other imports, but it does NOT hoist a `vi.mock` call
 * that lives inside an imported module one level away; that one only takes
 * effect in plain import-evaluation order, which any import-sorting
 * formatter or lint autofix in Tasks 6-9 can silently reorder and break —
 * surfacing as "invariant expected app router to be mounted" once
 * `./data-table` (or whichever page) ends up importing the real
 * `use-table-params.ts` before this module's side effect runs.
 *
 * This module intentionally does NOT call `vi.mock` itself, for the same
 * reason: `lib/use-table-params.test.ts` needs the REAL hook, and a global
 * auto-mock (e.g. via `vitest.config.ts`'s `setupFiles`) would shadow it
 * there too.
 *
 * Call `resetTableParamsSpies()` in `beforeEach` so assertions don't leak
 * state across test cases.
 */
// Declared then exported separately: vitest's hoisting transform rejects
// `export const x = vi.hoisted(...)` written as a single statement.
const tableParamsSpies = vi.hoisted(() => ({
  patch: vi.fn(),
  setPage: vi.fn(),
  setPer: vi.fn(),
  setSort: vi.fn(),
  setFilter: vi.fn((key: string, value: string) =>
    tableParamsSpies.patch({ [key]: value === "all" ? null : value, page: null }),
  ),
  setQ: vi.fn(),
  clearFilters: vi.fn((keep?: string[]) => {
    void keep;
  }),
}));

export { tableParamsSpies };

export const tableParamsMockReturn = { isPending: false as const, ...tableParamsSpies };

export function resetTableParamsSpies() {
  for (const spy of Object.values(tableParamsSpies)) spy.mockClear();
}
