import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useRegistration } from "../lib/registration";

const mockMaybeSingle = jest.fn().mockResolvedValue({
  data: {
    id: "r1", status: "paid", total_amount: 210000, ticket_token: "a.b", org_id: "o1",
    events: { name: "Apo Sky Ultra 2026" }, categories: { label: "21K", distance_km: 21 },
    payments: [{
      checkout_url: "http://x/functions/v1/fake-checkout?rid=r1",
      created_at: "2026-03-06T02:15:00Z", method: "gcash", amount: 120000,
      platform_fee: 6000, net_to_org: 114000, provider: "paymongo",
      provider_ref: "cs_abc123", status: "paid",
    }],
  },
  error: null,
});
const mockEq = jest.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));
jest.mock("../lib/supabase", () => ({ supabase: { from: jest.fn(() => ({ select: mockSelect })) } }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useRegistration", () => {
  it("maps nested event/category/payment into a flat row", async () => {
    const { result } = renderHook(() => useRegistration("r1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      id: "r1", status: "paid", ticket_token: "a.b",
      eventName: "Apo Sky Ultra 2026", categoryLabel: "21K",
      checkoutUrl: "http://x/functions/v1/fake-checkout?rid=r1",
    });
    expect(result.current.data?.payment).toMatchObject({
      createdAt: "2026-03-06T02:15:00Z", method: "gcash", amount: 120000,
      platformFee: 6000, netToOrg: 114000, provider: "paymongo", providerRef: "cs_abc123", status: "paid",
    });
  });
});
