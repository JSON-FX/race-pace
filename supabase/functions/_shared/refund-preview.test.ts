import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ single: vi.fn(), rpc: vi.fn(), refund: vi.fn() }));
vi.mock("./supabase.ts", () => ({ serviceClient: () => ({
  from: () => ({ select: () => ({ eq: () => ({ single: mocks.single }) }) }), rpc: mocks.rpc,
}) }));
vi.mock("./payments.ts", () => ({ getPaymentProviderByName: () => ({ refund: mocks.refund }) }));
import { refundRegistration } from "./refund";
function fixture(policy = "full", fee = 0, raw = {}) {
  mocks.single.mockResolvedValueOnce({ data: { id: "r", status: "paid" } });
  mocks.single.mockResolvedValueOnce({ data: { amount: 100000, net_to_org: 95500, raw,
    organizations: { refund_policy: policy, refund_fee_cents: fee } } });
}
beforeEach(() => vi.resetAllMocks());
describe("authorized refund calculation", () => {
  it.each([["full", 0, 95500], ["flat_fee", 10000, 85500], ["flat_fee", 200000, 0]])("previews %s without a provider mutation", async (policy, fee, amount) => {
    fixture(policy, fee);
    expect(await refundRegistration("r", "a", null, { preview: true })).toMatchObject({ ok: true, refund_amount: amount, retained_fees: 100000 - amount });
    expect(mocks.refund).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects changed amounts before contacting the provider", async () => {
    fixture(); expect(await refundRegistration("r", "a", null, { expectedAmount: 100000 })).toMatchObject({ ok: false, error: "refund_amount_changed" });
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it("does not preview a second refund while one is pending", async () => {
    fixture("full", 0, { refund: { status: "pending" } });
    expect(await refundRegistration("r", "a", null, { preview: true })).toMatchObject({ ok: true, pending: true, already: true });
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it("returns the provider refund amount after confirmation", async () => {
    fixture(); mocks.refund.mockResolvedValue({ status: "succeeded", raw: {} }); mocks.rpc.mockResolvedValue({ data: "refunded" });
    expect(await refundRegistration("r", "a", null, { expectedAmount: 95500 })).toMatchObject({ ok: true, refund_amount: 95500 });
    expect(mocks.refund).toHaveBeenCalledWith(expect.objectContaining({ amount: 95500 }));
  });
  it("refuses preview under no-refund policy", async () => {
    fixture("none"); expect(await refundRegistration("r", "a", null, { preview: true })).toMatchObject({ ok: false, error: "policy_forbids" });
  });
});
