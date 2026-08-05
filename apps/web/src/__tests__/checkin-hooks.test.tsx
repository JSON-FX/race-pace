import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rpc = vi.fn();
const getSession = vi.fn(() => Promise.resolve({ data: { session: { access_token: "jwt" } } }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a), auth: { getSession: () => getSession() } } }));

import { useCheckInEvents, useCheckInRoster } from "../lib/checkin";
import { useCheckInSession } from "../lib/useCheckInSession";
import { loadStore } from "../lib/checkinQueue";

const ROSTER = [
  { registration_id: "r1", ticket_token: "tok1", runner: "Ana Cruz", bib: "ANA", category: "10K", status: "paid", checked_in_at: null },
  { registration_id: "r2", ticket_token: "tok2", runner: "Ben Reyes", bib: "BEN", category: "21K", status: "pending", checked_in_at: null },
];

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  localStorage.clear();
  rpc.mockReset();
  vi.stubGlobal("fetch", vi.fn());
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

it("useCheckInEvents calls the RPC with no arguments", async () => {
  rpc.mockResolvedValue({ data: [{ id: "e1", name: "Apo Sky Ultra", event_date: "2026-09-01", end_date: null }], error: null });
  const { result } = renderHook(() => useCheckInEvents(), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toHaveLength(1));
  expect(rpc).toHaveBeenCalledWith("checkin_events");
});

it("useCheckInRoster passes the event id", async () => {
  rpc.mockResolvedValue({ data: ROSTER, error: null });
  const { result } = renderHook(() => useCheckInRoster("e1"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toHaveLength(2));
  expect(rpc).toHaveBeenCalledWith("checkin_roster", { p_event_id: "e1" });
});

it("submitToken online posts to the Edge Function and stamps the roster row", async () => {
  rpc.mockResolvedValue({ data: ROSTER, error: null });
  (globalThis.fetch as any).mockResolvedValue({
    status: 200, json: () => Promise.resolve({ ok: true, registration_id: "r1" }),
  });

  const { result } = renderHook(() => useCheckInSession("e1"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.store.roster).toHaveLength(2));

  await act(async () => { await result.current.submitToken("tok1"); });

  expect(globalThis.fetch).toHaveBeenCalled();
  expect(result.current.banner?.tone).toBe("success");
  expect(result.current.progress).toEqual({ done: 1, total: 1 });
});

it("submitToken offline queues the scan and persists it", async () => {
  rpc.mockResolvedValue({ data: ROSTER, error: null });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

  const { result } = renderHook(() => useCheckInSession("e1"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.store.roster).toHaveLength(2));

  await act(async () => { await result.current.submitToken("tok1"); });

  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(result.current.banner?.tone).toBe("success");
  expect(result.current.store.queue).toHaveLength(1);
  expect(loadStore("e1").queue).toHaveLength(1);
});

it("an offline scan of a pending registration is refused as not paid", async () => {
  rpc.mockResolvedValue({ data: ROSTER, error: null });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

  const { result } = renderHook(() => useCheckInSession("e1"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.store.roster).toHaveLength(2));

  await act(async () => { await result.current.submitToken("tok2"); });

  expect(result.current.banner?.title).toBe("Not paid");
  expect(result.current.store.queue).toHaveLength(0);
});

it("a rejected replay lands in the failed list with the runner's name", async () => {
  rpc.mockResolvedValue({ data: ROSTER, error: null });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

  const { result } = renderHook(() => useCheckInSession("e1"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.store.roster).toHaveLength(2));
  await act(async () => { await result.current.submitToken("tok1"); });

  (globalThis.fetch as any).mockResolvedValue({ status: 409, json: () => Promise.resolve({ error: "not_paid" }) });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });

  await act(async () => { await result.current.retryAll(); });

  expect(result.current.store.queue).toHaveLength(0);
  expect(result.current.store.failed).toHaveLength(1);
  expect(result.current.store.failed[0]).toMatchObject({ runner: "Ana Cruz", reason: "Not paid", httpStatus: 409 });
});

it("a duplicate replay is treated as success, not failure", async () => {
  rpc.mockResolvedValue({ data: ROSTER, error: null });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });

  const { result } = renderHook(() => useCheckInSession("e1"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.store.roster).toHaveLength(2));
  await act(async () => { await result.current.submitToken("tok1"); });

  (globalThis.fetch as any).mockResolvedValue({
    status: 200, json: () => Promise.resolve({ ok: true, already: true, registration_id: "r1" }),
  });
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });

  await act(async () => { await result.current.retryAll(); });

  expect(result.current.store.queue).toHaveLength(0);
  expect(result.current.store.failed).toHaveLength(0);
  expect(result.current.store.roster[0]!.checked_in_at).not.toBeNull();
});
