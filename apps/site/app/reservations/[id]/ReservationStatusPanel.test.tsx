import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), router: { refresh: vi.fn() } }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ functions: { invoke: mocks.invoke } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
import { ReservationStatusPanel } from "./ReservationStatusPanel";
const props = { id: "reservation-id", initialStatus: "pending", returned: false, remaining: 1 };
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); mocks.invoke.mockResolvedValue({ data: { status: "pending" } }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
it("checks an ordinary pending visit and recovers delayed provider visibility", async () => {
  mocks.invoke.mockResolvedValueOnce({ data: { status: "pending" } }).mockResolvedValueOnce({ data: { status: "paid" } });
  await act(async () => { render(<ReservationStatusPanel {...props} />); });
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(screen.getByText("paid")).toBeInTheDocument(); expect(mocks.router.refresh).toHaveBeenCalledOnce();
  await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
  expect(mocks.invoke).toHaveBeenCalledTimes(2);
});
it("bounds retries and retains a manual check after exhaustion", async () => {
  await act(async () => { render(<ReservationStatusPanel {...props} />); });
  await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
  expect(mocks.invoke).toHaveBeenCalledTimes(6);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Check payment" })); });
  expect(mocks.invoke).toHaveBeenCalledTimes(7);
});
it("cancels retries on unmount and handles a thrown provider error", async () => {
  mocks.invoke.mockRejectedValue(new Error("offline"));
  let unmount: () => void = () => {};
  await act(async () => { ({ unmount } = render(<ReservationStatusPanel {...props} />)); });
  expect(screen.getByRole("alert")).toHaveTextContent("Payment could not be checked");
  unmount(); await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
  expect(mocks.invoke).toHaveBeenCalledOnce();
});
it("keeps verified paid rows paid without provider calls", async () => {
  await act(async () => { render(<ReservationStatusPanel {...props} initialStatus="paid" />); });
  expect(mocks.invoke).not.toHaveBeenCalled(); expect(screen.getByText("paid")).toBeInTheDocument();
});
