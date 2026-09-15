import { afterEach, describe, expect, it, vi } from "vitest";
import { pmCreateRefund, pmGetRefund } from "../functions/_shared/paymongo.ts";
import { refundResourcesFromEvent } from "../functions/_shared/paymongo-webhook.ts";

const refund = (id = "ref_test", status = "succeeded") => ({
  id, type: "refund", attributes: { status, amount: 97500, payment_id: "pay_test" },
});

describe("PayMongo refund callback resources", () => {
  it("reads the refund update payload observed in PayMongo test mode", () => {
    expect(refundResourcesFromEvent("payment.refund.updated", refund())).toEqual([refund()]);
  });
  it("reads every refund from a payment.refunded payment, never using its payment ID", () => {
    const refunds = [refund("ref_first"), refund("ref_second", "pending")];
    expect(refundResourcesFromEvent("payment.refunded", {
      id: "pay_test", type: "payment", attributes: { status: "paid", refunds },
    })).toEqual(refunds);
  });
  it("preserves legacy synthetic events", () => {
    expect(refundResourcesFromEvent("refund.updated", refund())).toEqual([refund()]);
  });
  it("does not mistake unrelated or malformed resources for refunds", () => {
    expect(refundResourcesFromEvent("payment.paid", refund())).toBeNull();
    expect(refundResourcesFromEvent("payment.refunded", { id: "pay_test", attributes: {} })).toEqual([]);
    expect(refundResourcesFromEvent("payment.refund.updated", { id: "pay_test", attributes: { status: "paid" } })).toEqual([]);
    expect(refundResourcesFromEvent("payment.refunded", { attributes: { refunds: [null, {}, refund()] } })).toEqual([refund()]);
  });
});

describe("PayMongo refund response status", () => {
  afterEach(() => vi.unstubAllGlobals());
  function respond(status: unknown) {
    vi.stubGlobal("Deno", { env: { get: () => "sk_test_unit_fixture" } });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response(JSON.stringify({ data: {
      id: "ref_test", attributes: { status },
    } }), { status: 200 })));
  }
  it("reuses a stable provider key and supplies callback correlation metadata", async () => {
    respond("pending");
    const input = { paymentId: "pay_test", amount: 97500, requestId: "request_test", registrationId: "registration_test" };
    await pmCreateRefund(input); await pmCreateRefund(input);
    for (const [, options] of vi.mocked(fetch).mock.calls) {
      expect(options?.headers).toMatchObject({ "Idempotency-Key": "refund:request_test" });
      expect(JSON.parse(options?.body as string).data.attributes).toMatchObject({
        amount: 97500, metadata: { refund_request_id: "request_test", registration_id: "registration_test" },
      });
    }
  });
  it("reconciles an existing refund through GET without another creation", async () => {
    respond("succeeded");
    expect((await pmGetRefund("ref_test")).status).toBe("succeeded");
    expect(fetch).toHaveBeenCalledWith("https://api.paymongo.com/v1/refunds/ref_test", expect.not.objectContaining({ method: "POST" }));
  });
  it.each(["pending", "processing"])("keeps %s refunds pending", async (status) => {
    respond(status);
    expect((await pmCreateRefund({ paymentId: "pay_test", amount: 97500, requestId: "request_test" })).status).toBe("pending");
  });
  it.each(["succeeded", "failed"])("preserves terminal %s", async (status) => {
    respond(status);
    expect((await pmCreateRefund({ paymentId: "pay_test", amount: 97500, requestId: "request_test" })).status).toBe(status);
  });
  it.each(["unknown", undefined, null])("rejects an unrecognized status %s", async (status) => {
    respond(status);
    await expect(pmCreateRefund({ paymentId: "pay_test", amount: 97500, requestId: "request_test" })).rejects.toThrow("paymongo_refund_status_invalid");
  });
});
