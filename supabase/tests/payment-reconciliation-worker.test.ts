import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), get: vi.fn(), confirm: vi.fn(), reservation: vi.fn(), group: vi.fn(), health: vi.fn() }));
vi.mock("../functions/_shared/supabase.ts", () => ({ serviceClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("../functions/_shared/confirm.ts", () => ({ confirmPayment: mocks.confirm }));
vi.mock("../functions/_shared/reservationPayment.ts", () => ({ verifyReservationPayment: mocks.reservation }));
vi.mock("../functions/_shared/groupPaymentService.ts", () => ({ verifyGroupPayment: mocks.group }));
vi.mock("../functions/_shared/paymongo.ts", () => ({ pmGetCheckoutSession: mocks.get, pmMethodFromSession: () => "gcash", pmPaymentWebhookIssue: mocks.health }));
let handler: (req: Request) => Promise<Response>;
const rows = ["reservation", "single", "group"].map(kind => ({ kind, subject_id: `${kind}-id`, session_id: `cs_${kind}`, lease: "lease-id" }));
beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: () => "worker-secret" }, serve: (fn: typeof handler) => { handler = fn; } });
  await import("../functions/reconcile-payments/index.ts");
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "payment_reconciliation_claim" ? rows : true, error: null }));
  mocks.get.mockResolvedValue({ id: "cs_single", paid: true, raw: { provider: "evidence" } });
  mocks.confirm.mockResolvedValue({ ok: true }); mocks.reservation.mockResolvedValue({ status: "paid" }); mocks.group.mockResolvedValue({ status: "paid" }); mocks.health.mockResolvedValue(null);
});
const request = (token = "worker-secret") => handler(new Request("http://local/reconcile", { method: "POST", headers: { Authorization: `Bearer ${token}` } }));
it("reconciles all three payment paths through their existing settlement guards", async () => {
  expect(await (await request()).json()).toEqual({ processed: 3, outcomes: { paid: 3 }, provider_issue: null });
  expect(mocks.reservation).toHaveBeenCalledWith("reservation-id", undefined, "cs_reservation");
  expect(mocks.group).toHaveBeenCalledWith("group-id");
  expect(mocks.confirm).toHaveBeenCalledWith("single-id", "gcash", { source: "reconciliation-worker", session: { provider: "evidence" } });
});
it("leaves unpaid and uncertain rows unpaid while recording retryable outcomes", async () => {
  mocks.get.mockResolvedValue({ id: "cs_single", paid: false }); mocks.reservation.mockResolvedValue({ status: "pending" }); mocks.group.mockRejectedValue(new Error("provider unavailable"));
  expect(await (await request()).json()).toMatchObject({ outcomes: { pending: 2, retry_required: 1 } });
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it("records disabled webhook health without preventing recovery", async () => {
  mocks.health.mockResolvedValue("payment_webhook_disabled_or_missing");
  expect((await request()).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("payment_reconciliation_heartbeat", { p_provider_issue: "payment_webhook_disabled_or_missing" });
});
it("requires the worker secret and POST before database or provider access", async () => {
  expect((await request("wrong")).status).toBe(401);
  expect((await handler(new Request("http://local/reconcile"))).status).toBe(405);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("fails visibly when a lease result cannot be persisted", async () => {
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "payment_reconciliation_claim" ? rows : false, error: null }));
  expect((await request()).status).toBe(503);
});
it("does not settle a provider response for a different session", async () => {
  mocks.get.mockResolvedValue({ id: "cs_wrong", paid: true });
  expect(await (await request()).json()).toMatchObject({ outcomes: { paid: 2, retry_required: 1 } });
  expect(mocks.confirm).not.toHaveBeenCalled();
});
