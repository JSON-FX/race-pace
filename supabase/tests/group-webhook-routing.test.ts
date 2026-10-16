import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ verify: vi.fn(), signature: vi.fn(), legacy: vi.fn(), refund: vi.fn(), resources: vi.fn(), rpc: vi.fn() }));
vi.mock("../functions/_shared/groupPaymentService.ts", () => ({ verifyGroupPayment: mocks.verify }));
vi.mock("../functions/_shared/groupRefund.ts", () => ({ applyGroupRefundWebhook: mocks.refund }));
vi.mock("../functions/_shared/confirm.ts", () => ({ confirmPayment: mocks.legacy }));
vi.mock("../functions/_shared/supabase.ts", () => ({ serviceClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("../functions/_shared/paymongo-webhook.ts", () => ({ verifyWebhookSignature: mocks.signature, refundResourcesFromEvent: mocks.resources }));
let handler: (r: Request) => Promise<Response>;
let enabled = "true";
beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: (key: string) => key === "GROUP_PAYMENTS_ENABLED" ? enabled : "test-secret" }, serve: (fn: typeof handler) => { handler = fn; } });
  await import("../functions/payments-webhook/index");
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => { vi.clearAllMocks(); mocks.resources.mockReturnValue(null); mocks.rpc.mockResolvedValue({ data: "stored", error: null }); enabled = "true"; mocks.signature.mockResolvedValue(true); mocks.verify.mockResolvedValue({ status: "paid" }); });
function request() { return new Request("http://localhost/payments-webhook", { method: "POST", body: JSON.stringify({ data: { attributes: { type: "checkout_session.payment.paid", data: { id: "cs_notified", attributes: { payments: [{ id: "pay_notified", attributes: { status: "paid" } }], metadata: { payment_attempt_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } } } } } }) }); }
it("routes a verified group notification through stored-session verification", async () => {
  expect((await handler(request())).status).toBe(200);
  expect(mocks.verify).toHaveBeenCalledWith("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { refreshProvider: true, expectedPaymentIds: ["pay_notified"], expectedSessionId: "cs_notified" }); expect(mocks.legacy).not.toHaveBeenCalled();
});
it("does not dispatch unsigned or disabled group notifications", async () => {
  mocks.signature.mockResolvedValue(false); expect((await handler(request())).status).toBe(401); expect(mocks.verify).not.toHaveBeenCalled();
  mocks.signature.mockResolvedValue(true); enabled = "false"; expect((await handler(request())).status).toBe(503); expect(mocks.verify).not.toHaveBeenCalled();
});
it("does not acknowledge an unbound/failed confirmation so the provider can retry", async () => {
  mocks.verify.mockRejectedValue(new Error("session_not_ready")); expect((await handler(request())).status).toBe(500);
});
it("asks the provider to retry when GET has not exposed the notified capture yet", async () => {
  mocks.verify.mockResolvedValue({ status: "pending" });
  expect((await handler(request())).status).toBe(503);
});
it("acknowledges a durable capture while internal fulfillment retries", async () => {
  mocks.verify.mockResolvedValue({ status: "processing" });
  const response = await handler(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "processing" });
});
it("does not acknowledge when the provider capture could not be persisted", async () => {
  mocks.verify.mockRejectedValue(new Error("payment_capture_write_failed"));
  expect((await handler(request())).status).toBe(500);
});
it("requires the exact bare payment notification to be durably observed", async () => {
  const response = await handler(new Request("http://localhost/payments-webhook", { method: "POST", body: JSON.stringify({ data: { attributes: {
    type: "payment.paid", data: { id: "pay_second", attributes: { status: "paid", metadata: { payment_attempt_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } } },
  } } }) }));
  expect(response.status).toBe(200);
  expect(mocks.verify).toHaveBeenCalledWith("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", { refreshProvider: true, expectedPaymentIds: ["pay_second"] });
});
it("does not acknowledge an expired provider snapshot for a paid notification", async () => {
  mocks.verify.mockResolvedValue({ status: "expired" });
  expect((await handler(request())).status).toBe(503);
});

it("routes signed refunds even when new group payments are disabled", async () => {
  enabled="false";
  const resource={id:"ref_group",attributes:{status:"succeeded"}};
  mocks.resources.mockReturnValue([resource]); mocks.refund.mockResolvedValue(true);
  const req=()=>new Request("http://localhost/payments-webhook",{method:"POST",body:JSON.stringify({data:{attributes:{type:"payment.refund.updated",data:resource}}})});
  expect((await handler(req())).status).toBe(200); expect(mocks.refund).toHaveBeenCalledWith(resource); expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.signature.mockResolvedValue(false); mocks.refund.mockClear();
  expect((await handler(req())).status).toBe(401); expect(mocks.refund).not.toHaveBeenCalled();
});
it("preserves legacy refund routing and retries group reconciliation failures", async () => {
  const resource={id:"ref_legacy",attributes:{status:"succeeded"}};
  mocks.resources.mockReturnValue([resource]); mocks.refund.mockResolvedValue(false);
  const req=()=>new Request("http://localhost/payments-webhook",{method:"POST",body:JSON.stringify({data:{attributes:{type:"payment.refund.updated",data:resource}}})});
  expect((await handler(req())).status).toBe(200); expect(mocks.rpc).toHaveBeenCalledWith("refund_event_store",{p_resource:resource});
  mocks.refund.mockRejectedValue(new Error("group_refund_review_required"));
  expect((await handler(req())).status).toBe(500);
});
