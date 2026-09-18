import { beforeEach, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
const revalidate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: revalidate }));
import { markPayoutPaidAction, openPayoutStatementAction, refreshPayoutStatementAction } from "./payouts";
beforeEach(() => { rpc.mockReset(); revalidate.mockClear(); });
it("refuses to report successful settlement for unreconciled group money", async () => {
  rpc.mockResolvedValue({ data: "unreconciled", error: null });
  expect(await markPayoutPaidAction("statement", "transfer", "", 1)).toEqual({
    ok: false, error: "Reconcile unknown processing fees, pending refunds, and payment discrepancies before recording this payout.",
  });
  expect(revalidate).not.toHaveBeenCalled();
});

it("explains that a live event cannot be paid out", async () => {
  rpc.mockResolvedValue({ data: "event_unfinished", error: null });
  expect(await markPayoutPaidAction("statement", "transfer", "", 1)).toEqual({
    ok: false, error: "This event has not finished. Wait until it is complete before recording a payout.",
  });
  expect(revalidate).not.toHaveBeenCalled();
});

it("explains why unreconciled group money blocks opening a statement", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "group_reconciliation_required" } });
  expect(await openPayoutStatementAction("event")).toEqual({
    ok: false, error: "Reconcile unknown processing fees, pending refunds, and payment discrepancies before opening this payout statement.",
  });
  expect(revalidate).not.toHaveBeenCalled();
});
it("explains why unreconciled group money blocks refreshing a statement", async () => {
  rpc.mockResolvedValue({ data: "unreconciled", error: null });
  expect(await refreshPayoutStatementAction("statement")).toEqual({
    ok: false, error: "Reconcile unknown processing fees, pending refunds, and payment discrepancies before refreshing this payout statement.",
  });
  expect(revalidate).not.toHaveBeenCalled();
});
