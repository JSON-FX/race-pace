import { afterEach, describe, expect, it, vi } from "vitest";
import { pmCreateRefund, pmGetRefund } from "../functions/_shared/paymongo.ts";
import { PayMongoProvider } from "../functions/_shared/payments.ts";
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
  it("refunds a persisted paid payment without retrieving its checkout session", async () => {
    respond("succeeded");
    await new PayMongoProvider().refund({ providerRef: "cs_test", providerPaymentId: "pay_captured", amount: 97500, requestId: "request_test", registrationId: "registration_test" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("https://api.paymongo.com/v1/refunds", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)).data.attributes.payment_id).toBe("pay_captured");
  });
  it("rejects an invalid persisted payment ID before calling PayMongo", async () => {
    respond("succeeded");
    await expect(new PayMongoProvider().refund({ providerRef: "cs_test", providerPaymentId: "not_a_payment", amount: 97500, requestId: "request_test", registrationId: "registration_test" })).rejects.toThrow("paymongo_refund_payment_id_invalid");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not refund a failed checkout attempt when no payment was captured", async () => {
    vi.stubGlobal("Deno", { env: { get: () => "sk_test_unit_fixture" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: { id: "cs_test", attributes: { payments: [{ id: "pay_failed", attributes: { status: "failed" } }] } } }), { status: 200 })));
    await expect(new PayMongoProvider().refund({ providerRef: "cs_test", amount: 97500, requestId: "request_test", registrationId: "registration_test" })).rejects.toThrow("paymongo_refund_no_payment");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("uses a paid payment from a historical checkout without an inbox record", async () => {
    vi.stubGlobal("Deno", { env: { get: () => "sk_test_unit_fixture" } });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("/checkout_sessions/")
      ? new Response(JSON.stringify({ data: { id: "cs_test", attributes: { payments: [
          { id: "pay_failed", attributes: { status: "failed" } },
          { id: "pay_paid", attributes: { status: "paid" } },
        ] } } }), { status: 200 })
      : new Response(JSON.stringify({ data: { id: "ref_test", attributes: { status: "succeeded" } } }), { status: 200 })));
    await new PayMongoProvider().refund({ providerRef: "cs_test", amount: 97500, requestId: "request_test", registrationId: "registration_test" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]?.[1]?.body)).data.attributes.payment_id).toBe("pay_paid");
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
