import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const eq = vi.fn();
vi.mock("../lib/supabase", () => {
  const b: Record<string, unknown> = {};
  b.select = vi.fn(() => b);
  b.eq = (...a: unknown[]) => { eq(...a); return b; };
  b.order = () => Promise.resolve({ data: [{ code: "x", name: "X" }], error: null });
  b.maybeSingle = () => Promise.resolve({ data: { code: "c", name: "C", province_code: "p", region_code: "r" }, error: null });
  return { supabase: { from: vi.fn(() => b) } };
});

import { usePsgcProvinces, usePsgcCities, usePsgcCity } from "../lib/psgc";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
beforeEach(() => eq.mockClear());

it("usePsgcProvinces filters by region_code", async () => {
  const { result } = renderHook(() => usePsgcProvinces("130000000"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toEqual([{ code: "x", name: "X" }]));
  expect(eq).toHaveBeenCalledWith("region_code", "130000000");
});

it("usePsgcCities prefers province_code over region_code", async () => {
  const { result } = renderHook(() => usePsgcCities({ provinceCode: "1324", regionCode: "13" }), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toEqual([{ code: "x", name: "X" }]));
  expect(eq).toHaveBeenCalledWith("province_code", "1324");
  expect(eq).not.toHaveBeenCalledWith("region_code", "13");
});

it("usePsgcCity fetches the single city row for edit-seed", async () => {
  const { result } = renderHook(() => usePsgcCity("112603"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toEqual({ code: "c", name: "C", province_code: "p", region_code: "r" }));
});
