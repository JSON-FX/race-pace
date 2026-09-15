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
