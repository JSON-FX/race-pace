import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../functions/_shared/supabase.ts", () => ({ serviceClient: () => ({ rpc: mocks.rpc, from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: {
  id: "registration", status: "pending", total_amount: 10000,
  payments: { provider: "paymongo", provider_ref: "cs_bound", amount: 10000, checkout_platform_fee: 0, checkout_fee_mode: "absorb" },
} }) }) }) }) }) }));
import { confirmPayment } from "../functions/_shared/confirm";
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("Deno", { env: { get: () => "sk_test_mock" } }); });
afterEach(() => vi.unstubAllGlobals());
const attributes = { status: "paid", currency: "PHP", livemode: false, amount: 10000, fee: 250, net_amount: 9750 };
const raw = (overrides = {}) => ({ session: { data: { id: "cs_bound", attributes: { payments: [{ id: "pay_capture", attributes: { ...attributes, ...overrides } }] } } } });
it("returns a retryable failure when capture evidence was not stored", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "connection lost" } });
  expect(await confirmPayment("registration", "gcash", raw())).toEqual({ ok: false, error: "capture_write_failed", status: 503 });
});
it.each([
  [{ livemode: true }, "environment_mismatch"],
  [{ currency: "USD" }, "capture_metadata_invalid"],
  [{ net_amount: 9900 }, "fee_integrity"],
])("retains invalid signed evidence for review without settling it", async (override, reason) => {
  mocks.rpc.mockResolvedValue({ data: "reconciliation_required", error: null });
  expect(await confirmPayment("registration", "gcash", raw(override))).toMatchObject({ ok: false, error: "capture_review_required" });
  expect(mocks.rpc).toHaveBeenCalledOnce();
  expect(mocks.rpc).toHaveBeenCalledWith("single_capture_observe", expect.objectContaining({ p_invalid_reason: reason }));
});
