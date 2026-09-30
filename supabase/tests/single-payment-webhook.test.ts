import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ known: null as unknown, get: vi.fn(), confirm: vi.fn(), signature: vi.fn(), dbError: null as unknown }));
vi.mock("../functions/_shared/supabase.ts", () => ({ serviceClient: () => ({ from: (table: string) => ({
  select: () => ({ eq: () => ({
    maybeSingle: async () => ({ data: mocks.known, error: mocks.dbError }),
    single: async () => ({ data: { provider_ref: "cs_bound" }, error: mocks.dbError }),
  }) }),
}) }) }));
vi.mock("../functions/_shared/confirm.ts", async original => ({
  ...await original<typeof import("../functions/_shared/confirm.ts")>(), confirmPayment: mocks.confirm,
}));
vi.mock("../functions/_shared/paymongo.ts", async original => ({
  ...await original<typeof import("../functions/_shared/paymongo.ts")>(), pmGetCheckoutSession: mocks.get,
}));
vi.mock("../functions/_shared/paymongo-webhook.ts", () => ({ verifyWebhookSignature: mocks.signature, refundResourcesFromEvent: () => null }));
const rid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const payment = { id: "pay_capture", attributes: { status: "paid", amount: 10000, fee: 250, net_amount: 9750, currency: "PHP", livemode: false, source: { type: "gcash" }, metadata: { registration_id: rid } } };
const raw = { data: { id: "cs_bound", attributes: { metadata: { registration_id: rid }, payments: [payment] } } };
let handler: (req: Request) => Promise<Response>;
beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: () => "test-secret" }, serve: (fn: typeof handler) => { handler = fn; } });
  await import("../functions/payments-webhook/index.ts");
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.clearAllMocks(); mocks.known = null; mocks.dbError = null;
  mocks.signature.mockResolvedValue(true); mocks.get.mockResolvedValue({ id: "cs_bound", paid: true, raw });
  mocks.confirm.mockResolvedValue({ ok: true, registration_id: rid });
});
const request = (type = "payment.paid", resource: unknown = payment) => handler(new Request("https://local/webhook", {
  method: "POST", body: JSON.stringify({ data: { attributes: { type, data: resource } } }),
}));
it("settles a bare paid notification using the provider-verified checkout and actual instrument", async () => {
  expect((await request()).status).toBe(200);
  expect(mocks.get).toHaveBeenCalledWith("cs_bound");
  expect(mocks.confirm).toHaveBeenCalledWith(rid, "gcash", expect.objectContaining({ session: raw }));
});
it("retains canonical checkout routing", async () => {
  expect((await request("checkout_session.payment.paid", raw.data)).status).toBe(200);
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.confirm).toHaveBeenCalledWith(rid, "gcash", expect.objectContaining({ source: "webhook", event: expect.anything() }));
});
it("retries early notification without poisoning the capture ledger", async () => {
  mocks.get.mockResolvedValue({ id: "cs_bound", paid: false, raw: { data: { attributes: { payments: [] } } } });
  expect((await request()).status).toBe(503); expect(mocks.confirm).not.toHaveBeenCalled();
  mocks.get.mockResolvedValue({ id: "cs_bound", paid: true, raw });
  expect((await request()).status).toBe(200);
});
it("rechecks signed replay values against the durable capture after provider retention ends", async () => {
  mocks.known = { registration_id: rid, session_id: "cs_bound" };
  expect((await request()).status).toBe(200); expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.confirm).toHaveBeenCalledWith(rid, "gcash", expect.objectContaining({ session: { data: { id: "cs_bound", attributes: { payments: [payment] } } } }));
});
it("does not assign another captured payment to this checkout", async () => {
  mocks.get.mockResolvedValue({ id: "cs_bound", paid: true, raw: { data: { id: "cs_bound", attributes: { payments: [{ ...payment, id: "pay_other" }] } } } });
  mocks.confirm.mockResolvedValue({ ok: false, error: "capture_review_required", status: 503 });
  expect(await (await request()).json()).toEqual({ ok: true, review_required: true });
  expect(mocks.confirm).toHaveBeenCalledWith(rid, "gcash", expect.objectContaining({ session: { data: { id: null, attributes: { payments: [payment] } } } }));
});
it("retries failed durable writes instead of acknowledging lost money evidence", async () => {
  mocks.confirm.mockResolvedValue({ ok: false, error: "capture_write_failed", status: 503 });
  expect((await request()).status).toBe(503);
});
it("rejects unsigned events before provider access", async () => {
  mocks.signature.mockResolvedValue(false); expect((await request()).status).toBe(401);
  expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.confirm).not.toHaveBeenCalled();
});
it("refuses a wrong checkout identity", async () => {
  mocks.get.mockResolvedValue({ id: "cs_other", paid: true, raw });
  expect((await request()).status).toBe(500); expect(mocks.confirm).not.toHaveBeenCalled();
});
it("keeps previously verified fees when a duplicate bare event omits them", async () => {
  mocks.known = { registration_id: rid, session_id: "cs_bound", fee_cents: 250, net_cents: 9750 };
  const { fee: _fee, net_amount: _net, ...withoutFees } = payment.attributes;
  expect((await request("payment.paid", { ...payment, attributes: withoutFees })).status).toBe(200);
  expect(mocks.confirm).toHaveBeenCalledWith(rid, "gcash", expect.objectContaining({ session: { data: { id: "cs_bound", attributes: { payments: [payment] } } } }));
});
it("retries a succeeded intent until detailed captures become visible", async () => {
  mocks.get.mockResolvedValue({ id: "cs_bound", paid: true, raw: { data: { id: "cs_bound", attributes: { payment_intent: { id: "pi_current", attributes: { status: "succeeded" } }, payments: [] } } } });
  expect((await request()).status).toBe(503); expect(mocks.confirm).not.toHaveBeenCalled();
});
it("records a superseded intent capture for review even while the current checkout is unpaid", async () => {
  mocks.get.mockResolvedValue({ id: "cs_bound", paid: false, raw: { data: { id: "cs_bound", attributes: { payment_intent: { id: "pi_current" }, payments: [] } } } });
  mocks.confirm.mockResolvedValue({ ok: false, error: "capture_review_required", status: 503 });
  expect(await (await request("payment.paid", { ...payment, attributes: { ...payment.attributes, payment_intent_id: "pi_previous" } })).json()).toEqual({ ok: true, review_required: true });
  expect(mocks.confirm).toHaveBeenCalledWith(rid, "gcash", expect.objectContaining({ session: expect.objectContaining({ data: expect.objectContaining({ id: null }) }) }));
});
