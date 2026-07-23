import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useNotifications, useUnreadCount, useNotificationsRealtime } from "../lib/notifications";

const rows = [{ id: "n1", type: "paid", title: "Payment received", body: "b", data: { registration_id: "r1" }, read_at: null, created_at: "2026-07-23T00:00:00Z" }];
const mockLimit = jest.fn(async () => ({ data: rows, error: null }));
const mockOrder = jest.fn(() => ({ limit: mockLimit }));
const mockIsNull = jest.fn(async () => ({ count: 3, error: null }));
const mockSelect = jest.fn(() => ({ order: mockOrder, is: mockIsNull }));
const mockChannelObj: any = {};
const mockOn = jest.fn(() => mockChannelObj);
const mockSubscribe = jest.fn(() => mockChannelObj);
mockChannelObj.on = mockOn;
mockChannelObj.subscribe = mockSubscribe;
const mockChannel = jest.fn((_name: string) => mockChannelObj);
const mockRemoveChannel = jest.fn();
jest.mock("../lib/supabase", () => ({ supabase: { from: jest.fn(() => ({ select: mockSelect })), channel: (name: string) => mockChannel(name), removeChannel: (ch: unknown) => mockRemoveChannel(ch) } }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("notifications hooks", () => {
  it("useNotifications returns the list newest-first", async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data![0].type).toBe("paid");
  });
  it("useUnreadCount returns the head count", async () => {
    const { result } = renderHook(() => useUnreadCount(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBe(3);
  });
  it("useNotificationsRealtime subscribes for a user and cleans up on unmount", () => {
    const { unmount } = renderHook(() => useNotificationsRealtime("u1"), { wrapper });
    expect(mockChannel).toHaveBeenCalledWith("notifications:u1");
    expect(mockOn).toHaveBeenCalled();
    expect(mockSubscribe).toHaveBeenCalled();
    unmount();
    expect(mockRemoveChannel).toHaveBeenCalled();
  });
});
