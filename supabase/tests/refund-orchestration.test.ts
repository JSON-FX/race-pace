import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), refund: vi.fn(), getRefund: vi.fn() }));
vi.mock("../functions/_shared/supabase.ts", () => ({ serviceClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("../functions/_shared/payments.ts", () => ({ getPaymentProviderByName: () => ({ refund: mocks.refund, getRefund: mocks.getRefund }) }));
import { refundRegistration } from "../functions/_shared/refund.ts";
const request = { id: "request-id", registration_id: "runner-id", provider: "paymongo", provider_ref: "cs_test", provider_refund_id: null, refund_amount: 97500, retained_net: 0, total_paid: 100000, status: "submitting" };
const claim = { action: "submit", request, refund_amount: 97500, total_paid: 100000, retained_fees: 2500 };
const captureQuery = (rows: unknown[] = [], error: unknown = null) => ({
  select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: rows, error }) }) }) }),
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("Deno", { env: { get: () => "sk_test_unit" } });
  mocks.from.mockImplementation((table: string) => table === "single_payment_captures" ? captureQuery() : undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe("refund request orchestration", () => {
  it("retains uncertain ownership after a timeout and does not resubmit during its lease", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: claim }).mockResolvedValueOnce({ data: "unknown" }).mockResolvedValueOnce({ data: { ...claim, action: "pending" } });
    mocks.refund.mockRejectedValue(new Error("response lost"));
    expect(await refundRegistration("runner-id", "admin-id")).toMatchObject({ ok: false, error: "provider_refund_failed" });
    expect(mocks.rpc).toHaveBeenCalledWith("refund_request_uncertain", { p_request_id: "request-id" });
    expect(await refundRegistration("runner-id", "admin-id")).toMatchObject({ ok: true, pending: true });
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    expect(mocks.refund).toHaveBeenCalledWith(expect.objectContaining({ amount: 97500, requestId: "request-id" }));
  });
  it("does not create provider work for a read-only preview or a review-required request", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...claim, action: "preview" } }).mockResolvedValueOnce({ data: { action: "error", error: "refund_review_required" } });
    expect(await refundRegistration("runner-id", "admin-id", null, { preview: true })).toMatchObject({ ok: true, refund_amount: 97500 });
    expect(await refundRegistration("runner-id", "admin-id")).toMatchObject({ ok: false, status: 409 });
    expect(mocks.refund).not.toHaveBeenCalled(); expect(mocks.getRefund).not.toHaveBeenCalled();
  });
  it("keeps an early succeeded callback authoritative over a late pending POST response", async () => {
    mocks.rpc.mockImplementation(async (name) => ({ data: name === "refund_request_claim" ? claim : name === "refund_request_bind" ? "already" : name === "refund_event_store" ? "stored" : "already" }));
    mocks.refund.mockResolvedValue({ providerRefundId: "ref_test", status: "pending", raw: { data: { id: "ref_test", attributes: { status: "pending", amount: 97500 } } } });
    mocks.from.mockImplementation((table: string) => table === "single_payment_captures" ? captureQuery() :
      { select: () => ({ eq: () => ({ single: async () => ({ data: { status: "succeeded" } }) }) }) });
    expect(await refundRegistration("runner-id", "admin-id")).toMatchObject({ ok: true, refund_amount: 97500 });
    expect(mocks.rpc).toHaveBeenCalledWith("refund_request_apply_event", { p_provider_refund_id: "ref_test" });
  });
  it("reports a second successful provider refund as a discrepancy instead of success", async () => {
    mocks.rpc.mockImplementation(async name => ({ data: name === "refund_request_claim" ? claim : name === "refund_request_bind" ? "already" : name === "refund_event_store" ? "stored" : "review_required" }));
    mocks.refund.mockResolvedValue({ providerRefundId: "ref_second", status: "succeeded", raw: { data: { id: "ref_second", attributes: { status: "succeeded", amount: 97500 } } } });
    expect(await refundRegistration("runner-id", "admin-id")).toMatchObject({ ok: false, error: "refund_review_required", status: 409 });
  });
  it("does not contact the provider when claim persistence fails", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "database unavailable" } });
    expect(await refundRegistration("runner-id", "admin-id")).toMatchObject({ ok: false, status: 500 });
    expect(mocks.refund).not.toHaveBeenCalled();
  });
  it("uses the settled payment ID for refunds without a checkout-session lookup", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: claim }).mockResolvedValueOnce({ data: "unknown" });
    mocks.from.mockImplementation((table: string) => table === "single_payment_captures"
      ? captureQuery([{ provider_payment_id: "pay_captured", session_id: "cs_test" }]) : undefined);
    mocks.refund.mockRejectedValue(new Error("provider timeout"));
    expect(await refundRegistration("runner-id", "admin-id")).toMatchObject({ ok: false, error: "provider_refund_failed" });
    expect(mocks.refund).toHaveBeenCalledWith(expect.objectContaining({ providerPaymentId: "pay_captured" }));
  });
  it("holds a refund when settled capture evidence conflicts with the checkout", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: claim }).mockResolvedValueOnce({ data: "unknown" });
    mocks.from.mockImplementation((table: string) => table === "single_payment_captures"
      ? captureQuery([{ provider_payment_id: "pay_captured", session_id: "cs_other" }]) : undefined);
    expect(await refundRegistration("runner-id", "admin-id")).toMatchObject({ ok: false, error: "provider_refund_failed" });
    expect(mocks.refund).not.toHaveBeenCalled();
  });
});
