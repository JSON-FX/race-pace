import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";

const calls: Record<string, unknown[]> = { range: [], order: [], eq: [], or: [] };
const builder: Record<string, unknown> = {};
["select", "eq", "order", "range", "or"].forEach((m) => {
  builder[m] = (...args: unknown[]) => { calls[m]?.push(args); return builder; };
});
(builder as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
  resolve({ data: [], count: 97, error: null });

vi.mock("../lib/supabase", () => ({ supabase: { from: (t: string) => { calls.from = [[t]]; return builder; } } }));

import { usePayments, PAGE_SIZE } from "../lib/registrations";

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

it("queries the flattened view with range, order and an exact count", async () => {
  const { result } = renderHook(
    () => usePayments("a1", { page: 3, sort: [{ id: "amount", desc: true }], status: "paid", q: "ana" }),
    { wrapper }
  );
  await waitFor(() => expect(result.current.isSuccess).toBe(true));

  expect(calls.from).toEqual([["admin_payments_v"]]);
  expect(calls.range).toContainEqual([2 * PAGE_SIZE, 3 * PAGE_SIZE - 1]);
  expect(calls.order).toContainEqual(["amount", { ascending: false }]);
  expect(calls.eq).toContainEqual(["status", "paid"]);
  const orCalls = calls.or as unknown[][];
  expect(orCalls[0]![0]).toContain("ana");
  expect(result.current.data!.total).toBe(97);
});
