import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

let rosterRows: unknown[];
let countRows: unknown[];
let profilesData: unknown[];
vi.mock("../lib/supabase", () => {
  const invoke = vi.fn(() => Promise.resolve({ data: { ok: true }, error: null }));
  const from = vi.fn((table: string) => {
    const b: Record<string, unknown> = { _select: "" };
    b.select = (cols: string) => { b._select = cols; return b; };
    b.eq = () => b;
    b.in = () => Promise.resolve({ data: profilesData, error: null });
    b.order = () => Promise.resolve({ data: table === "profiles" ? profilesData : (b._select === "event_id" ? countRows : rosterRows), error: null });
    return b;
  });
  return { supabase: { from, functions: { invoke } } };
});

import { supabase } from "../lib/supabase";
import { useEventRegistrations, useEventRegistrationCounts, refundRegistration } from "../lib/registrations";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  rosterRows = [{ id: "r1", user_id: "u1", category_id: "c4", total_amount: 100000, created_at: "2026-07-01T00:00:00Z", custom_data: { blood_type: "O" }, categories: { label: "10K" }, payments: { status: "paid", method: "gcash" }, registration_addons: [{ price: 60000, addons: { name: "Singlet" } }] }];
  countRows = [{ event_id: "e1" }, { event_id: "e1" }, { event_id: "e2" }];
  profilesData = [{ id: "u1", full_name: "Ana Cruz", bib_name: "ANA" }];
});

it("useEventRegistrations merges category + payment + profile + addons into a row", async () => {
  const { result } = renderHook(() => useEventRegistrations("e1"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toHaveLength(1));
  expect(result.current.data![0]).toMatchObject({
    id: "r1", full_name: "Ana Cruz", bib_name: "ANA", category_label: "10K",
    payment_status: "paid", payment_method: "gcash", total_amount: 100000,
    addons: [{ name: "Singlet", price: 60000 }],
  });
});

it("useEventRegistrationCounts tallies registrations per event", async () => {
  const { result } = renderHook(() => useEventRegistrationCounts("a1"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toEqual({ e1: 2, e2: 1 }));
});

it("refundRegistration invokes the admin-refund function with the registration id", async () => {
  const res = await refundRegistration("r1");
  expect(res.ok).toBe(true);
  expect(supabase.functions.invoke).toHaveBeenCalledWith("admin-refund", { body: { registration_id: "r1", note: null } });
});
