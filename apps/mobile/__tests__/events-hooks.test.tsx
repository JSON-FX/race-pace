import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEvents } from "../lib/events";

const mockOrder = jest.fn().mockResolvedValue({ data: [{ id: "e1", name: "Apo Sky Ultra 2026" }], error: null });
const mockEq = jest.fn(() => ({ order: mockOrder }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
jest.mock("../lib/supabase", () => ({ supabase: { from: jest.fn(() => ({ select: mockSelect })) } }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useEvents", () => {
  it("fetches events for the org and returns them", async () => {
    const { result } = renderHook(() => useEvents("org-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "e1", name: "Apo Sky Ultra 2026" }]);
    expect(mockEq).toHaveBeenCalledWith("org_id", "org-1");
  });
});
