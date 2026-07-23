import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useMarketplaceEvents } from "../lib/events";

const mockOrder = jest.fn().mockResolvedValue({
  data: [{ id: "e1", org_id: "o1", name: "Apo Sky Ultra 2026", status: "open", gallery: null, organizations: { name: "Race Pace", brand_color: "#159A55" } }],
  error: null,
});
const mockSelect = jest.fn(() => ({ order: mockOrder }));
jest.mock("../lib/supabase", () => ({ supabase: { from: jest.fn(() => ({ select: mockSelect })) } }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useMarketplaceEvents", () => {
  it("fetches all events and flattens org name + color + gallery default", async () => {
    const { result } = renderHook(() => useMarketplaceEvents(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toMatchObject({ id: "e1", org_name: "Race Pace", org_color: "#159A55", gallery: [] });
  });

  it("passes end_date through and sums slots_taken across categories into joined_count", async () => {
    mockOrder.mockResolvedValueOnce({
      data: [{
        id: "e2", org_id: "o1", name: "Trail Fest", status: "open", gallery: null,
        event_date: "2026-09-01", end_date: "2026-09-03",
        categories: [{ slots_taken: 40 }, { slots_taken: 88 }],
        organizations: { name: "Race Pace", brand_color: "#159A55" },
      }],
      error: null,
    });
    const { result } = renderHook(() => useMarketplaceEvents(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toMatchObject({ id: "e2", end_date: "2026-09-03", joined_count: 128 });
  });

  it("collects each category's distance_km into a distances array, skipping nulls", async () => {
    mockOrder.mockResolvedValueOnce({
      data: [{
        id: "e3", org_id: "o1", name: "Highland Run", status: "open", gallery: null,
        categories: [{ slots_taken: 10, distance_km: 21 }, { slots_taken: 5, distance_km: null }, { slots_taken: 2, distance_km: 42 }],
        organizations: { name: "Race Pace", brand_color: "#159A55" },
      }],
      error: null,
    });
    const { result } = renderHook(() => useMarketplaceEvents(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toMatchObject({ id: "e3", distances: [21, 42] });
  });

  it("defaults distances to an empty array when there are no categories", async () => {
    const { result } = renderHook(() => useMarketplaceEvents(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]).toMatchObject({ id: "e1", distances: [] });
  });
});
