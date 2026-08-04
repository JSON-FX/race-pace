import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";

const calls: Record<string, unknown[]> = { range: [], order: [], eq: [], or: [] };
const builder: Record<string, unknown> = {};
["select", "eq", "order", "range", "or"].forEach((m) => {
  builder[m] = (...args: unknown[]) => { calls[m]?.push(args); return builder; };
});
let resolved: unknown = { data: [], count: 97, error: null };
(builder as { then: unknown }).then = (resolve: (v: unknown) => unknown) => resolve(resolved);

vi.mock("../lib/supabase", () => {
  const invoke = vi.fn(() => Promise.resolve({ data: { ok: true }, error: null }));
  return {
    supabase: {
      from: (t: string) => { calls.from = [[t]]; return builder; },
      functions: { invoke },
    },
  };
});

import { supabase } from "../lib/supabase";
import { useEventRegistrations, useEventRegistrationCounts, refundRegistration, PAGE_SIZE } from "../lib/registrations";

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, children);

beforeEach(() => {
  resolved = { data: [], count: 97, error: null };
  (supabase.functions.invoke as unknown as { mockClear: () => void }).mockClear();
  (supabase.functions.invoke as unknown as { mockImplementation: (fn: () => Promise<unknown>) => void }).mockImplementation(() =>
    Promise.resolve({ data: { ok: true }, error: null })
  );
});

it("queries the flattened registrations view with filters, range and an exact count", async () => {
  const { result } = renderHook(
    () => useEventRegistrations("e1", { page: 1, sort: [], status: "paid", categoryId: "c1", q: "" }),
    { wrapper }
  );
  await waitFor(() => expect(result.current.isSuccess).toBe(true));

  expect(calls.from).toEqual([["admin_registrations_v"]]);
  expect(calls.eq).toContainEqual(["event_id", "e1"]);
  expect(calls.eq).toContainEqual(["payment_status", "paid"]);
  expect(calls.eq).toContainEqual(["category_id", "c1"]);
  expect(calls.range).toContainEqual([0, PAGE_SIZE - 1]);
  expect(result.current.data!.total).toBe(97);
});

it("quotes a search term containing commas and double quotes into a well-formed or() argument", async () => {
  calls.or = [];
  const { result } = renderHook(
    () => useEventRegistrations("e1", { page: 1, sort: [], status: "all", categoryId: "all", q: 'Dela Cruz, "Ana"' }),
    { wrapper }
  );
  await waitFor(() => expect(result.current.isSuccess).toBe(true));

  const orCalls = calls.or as unknown[][];
  const arg = orCalls[0]![0] as string;
  expect(arg).toBe(
    'full_name.ilike."%Dela Cruz, \\"Ana\\"%",bib_name.ilike."%Dela Cruz, \\"Ana\\"%"'
  );
});

it("queries the reg-count view and returns a per-event map", async () => {
  resolved = { data: [{ event_id: "e1", reg_count: 4 }], count: null, error: null };
  const { result } = renderHook(() => useEventRegistrationCounts("a1"), { wrapper });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));

  expect(calls.from).toEqual([["admin_event_reg_counts_v"]]);
  expect(result.current.data).toEqual({ e1: 4 });
});

it("refundRegistration invokes the admin-refund function with the registration id", async () => {
  const res = await refundRegistration("r1");
  expect(res.ok).toBe(true);
  expect(supabase.functions.invoke).toHaveBeenCalledWith("admin-refund", { body: { registration_id: "r1", note: null } });
});

it("maps a 409 refund error to a can't-be-refunded message", async () => {
  (supabase.functions.invoke as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({ data: null, error: { context: { status: 409 } } });
  const res = await refundRegistration("r1");
  expect(res.ok).toBe(false);
  expect(res.error).toMatch(/can't be refunded/);
});
