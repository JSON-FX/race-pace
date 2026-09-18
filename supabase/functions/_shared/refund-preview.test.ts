import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ single: vi.fn(), rpc: vi.fn(), refund: vi.fn() }));
vi.mock("./supabase.ts", () => ({ serviceClient: () => ({
  from: () => ({ select: () => ({ eq: () => ({ single: mocks.single }) }) }), rpc: mocks.rpc,
}) }));
vi.mock("./payments.ts", () => ({ getPaymentProviderByName: () => ({ refund: mocks.refund }) }));
import { refundRegistration } from "./refund";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("Deno", { env: { get: () => undefined } });
});
afterEach(() => vi.unstubAllGlobals());
describe("authorized refund calculation", () => {
  // Policy arithmetic is covered by the database suite. Here the boundary must
  // forward the frozen server amount and make preview a read-only claim.
  it.each([95500, 85500, 0])("returns authoritative preview %i without provider mutation", async amount => {
    mocks.rpc.mockResolvedValue({ data: { action: "preview", refund_amount: amount, total_paid: 100000, retained_fees: 100000 - amount } });
    expect(await refundRegistration("r", "a", null, { preview: true })).toMatchObject({ ok: true, refund_amount: amount, retained_fees: 100000 - amount });
    expect(mocks.refund).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("refund_request_claim", expect.objectContaining({ p_preview: true, p_provider_scope: null }));
  });
  it("rejects changed amounts before contacting the provider", async () => {
    mocks.rpc.mockResolvedValue({ data: { action: "error", error: "refund_amount_changed" } });
    expect(await refundRegistration("r", "a", null, { expectedAmount: 100000 })).toMatchObject({ ok: false, error: "refund_amount_changed" });
    expect(mocks.rpc).toHaveBeenCalledWith("refund_request_claim", expect.objectContaining({ p_expected_amount: 100000 }));
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it("does not preview a second refund while one is pending", async () => {
    mocks.rpc.mockResolvedValue({ data: { action: "pending" } });
    expect(await refundRegistration("r", "a", null, { preview: true })).toMatchObject({ ok: true, pending: true, already: true });
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it("returns the frozen refund amount after confirmation", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { action: "submit", refund_amount: 95500, total_paid: 100000, retained_fees: 4500,
      request: { id: "q", provider: "fake", provider_ref: "p", refund_amount: 95500, provider_refund_id: null } } })
      .mockResolvedValueOnce({ data: "bound" }).mockResolvedValueOnce({ data: "stored" }).mockResolvedValueOnce({ data: "applied" });
    mocks.refund.mockResolvedValue({ providerRefundId: "fake_refund_q", status: "succeeded" });
    mocks.single.mockResolvedValue({ data: { status: "succeeded" } });
    expect(await refundRegistration("r", "a", null, { expectedAmount: 95500 })).toMatchObject({ ok: true, refund_amount: 95500 });
    expect(mocks.refund).toHaveBeenCalledWith(expect.objectContaining({ amount: 95500, requestId: "q" }));
  });
  it("refuses preview under no-refund policy", async () => {
    mocks.rpc.mockResolvedValue({ data: { action: "error", error: "policy_forbids" } });
    expect(await refundRegistration("r", "a", null, { preview: true })).toMatchObject({ ok: false, error: "policy_forbids" });
    expect(mocks.refund).not.toHaveBeenCalled();
  });
});
