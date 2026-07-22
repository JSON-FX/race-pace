import { renderHook, act } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useGlobalRefresh } from "../lib/useGlobalRefresh";

it("refetches active queries and toggles refreshing back off", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const spy = jest.spyOn(client, "refetchQueries").mockResolvedValue(undefined as never);
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  const { result } = renderHook(() => useGlobalRefresh(), { wrapper });
  expect(result.current.refreshing).toBe(false);

  await act(async () => {
    await result.current.onRefresh();
  });

  expect(spy).toHaveBeenCalledWith({ type: "active" });
  expect(result.current.refreshing).toBe(false);
});

it("clears refreshing even when the refetch rejects (e.g. offline)", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  jest.spyOn(client, "refetchQueries").mockRejectedValue(new Error("network error"));
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  const { result } = renderHook(() => useGlobalRefresh(), { wrapper });

  await act(async () => {
    await expect(result.current.onRefresh()).rejects.toThrow("network error");
  });

  expect(result.current.refreshing).toBe(false); // finally still clears it — no stuck spinner
});
