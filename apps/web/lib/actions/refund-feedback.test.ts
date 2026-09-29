import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ invoke: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ functions: { invoke: m.invoke } }) }));
import { previewRefundAction, refundRegistrationAction } from "./registrations";
beforeEach(() => vi.resetAllMocks());
it("requests preview without revalidating or executing", async () => {
  m.invoke.mockResolvedValue({ data: { ok: true, refund_amount: 95500 } });
  expect(await previewRefundAction("r")).toMatchObject({ refund_amount: 95500 });
  expect(m.invoke).toHaveBeenCalledWith("admin-refund", { body: { registration_id: "r", preview: true } });
  expect(m.revalidate).not.toHaveBeenCalled();
});
it.each([{ pending: true }, { already: true }, { refund_amount: 95500 }])("preserves outcome %j", async outcome => {
  m.invoke.mockResolvedValue({ data: { ok: true, ...outcome } });
  expect(await refundRegistrationAction("r", undefined, 95500)).toEqual({ ok: true, ...outcome });
  expect(m.invoke).toHaveBeenCalledWith("admin-refund", { body: { registration_id: "r", note: null, expected_amount: 95500 } });
});
it("requires review when the amount changed", async () => {
  m.invoke.mockResolvedValue({ error: { context: new Response(JSON.stringify({ error: "refund_amount_changed" }), { status: 409 }) } });
  expect(await refundRegistrationAction("r", undefined, 95500)).toMatchObject({ ok: false, error: expect.stringMatching(/amount changed/) });
  expect(m.revalidate).not.toHaveBeenCalled();
});
it("rejects missing outcome rather than announcing success", async () => {
  m.invoke.mockResolvedValue({ data: null }); expect(await refundRegistrationAction("r")).toMatchObject({ ok: false });
});
it("explains when an uncertain refund requires provider review", async () => {
  m.invoke.mockResolvedValue({ error: { context: new Response(JSON.stringify({ error: "refund_review_required" }), { status: 409 }) } });
  expect(await refundRegistrationAction("r")).toMatchObject({ ok: false, error: expect.stringMatching(/provider review/) });
});
it("previews only the selected group participant through the guarded group endpoint", async () => {
  m.invoke.mockResolvedValue({ data: { status: "preview", refund_amount: 95500, total_paid: 100000, retained_fees: 4500 } });
  expect(await previewRefundAction("r", "order")).toMatchObject({ ok: true, refund_amount: 95500, existing_request: false });
  expect(m.invoke).toHaveBeenCalledWith("admin-group-refund", { body: { order_id: "order", registration_ids: ["r"], idempotency_key: "r", preview: true } });
  expect(m.revalidate).not.toHaveBeenCalled();
});
it("checks existing group requests instead of presenting a fresh refund", async () => {
  m.invoke.mockResolvedValue({ data: { status: "preview", request_id: "request", refund_amount: 95500 } });
  expect(await previewRefundAction("r", "order")).toMatchObject({ ok: true, existing_request: true });
});
it.each(["pending", "succeeded"])("preserves group %s and the same selected participant key on retry", async status => {
  m.invoke.mockResolvedValue({ data: { status, refund_amount: 95500 } });
  for (let attempt = 0; attempt < 2; attempt++) {
    expect(await refundRegistrationAction("r", "unsupported note", 95500, "order")).toMatchObject({ ok: true, ...(status === "pending" ? { pending: true } : {}), refund_amount: 95500 });
  }
  expect(m.invoke).toHaveBeenNthCalledWith(1, "admin-group-refund", { body: { order_id: "order", registration_ids: ["r"], idempotency_key: "r", preview: false, expected_amount: 95500 } });
  expect(m.invoke.mock.calls[1]).toEqual(m.invoke.mock.calls[0]);
});
it.each(["failed", "review_required", "unknown", undefined])("never treats group HTTP success with %s as a completed refund", async status => {
  m.invoke.mockResolvedValue({ data: { status, refund_amount: 95500 } });
  expect(await refundRegistrationAction("r", undefined, 95500, "order")).toMatchObject({ ok: false, error: expect.any(String) });
  expect(m.revalidate).not.toHaveBeenCalled();
});
