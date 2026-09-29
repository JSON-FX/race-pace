import { describe, expect, it } from "vitest";
import { screeningSummary, type ScreeningBatch, type ScreeningApplication } from "../prescreening-status";
const participant = (decision: ScreeningApplication["decision"]): ScreeningApplication => ({ id: decision, category_id: "cat", participant_passport_id: decision, participant_name: "Runner", is_managed: false, decision, screening_required: decision !== "not_required", requirement_snapshot: null, proof_upload_id: null, explanation: null, rejection_reason: null, released_at: decision === "rejected" ? "2026-01-01" : null, categories: { label: "70K", base_price: 100, reservation_fee_cents: 50 } });
const batch = (patch: Partial<ScreeningBatch> = {}): ScreeningBatch => ({ id: "batch", event_id: "event", status: "reviewing", checkout_intent: "reservation", created_at: "2026-01-01", payment_deadline_at: null, booking_order_id: null, event_reservation_id: null, prescreening_applications: [participant("pending"), participant("not_required")], ...patch });
describe("screening group status", () => {
  it("holds a mixed group without enabling either payment path during review", () => {
    for (const checkout_intent of ["entry", "reservation"] as const) {
      expect(screeningSummary(batch({ checkout_intent }))).toMatchObject({ pending: 1, payable: false, title: "Your group’s slots are held" });
    }
  });
  it("uses the fixed deadline and excludes rejected runners from payment", () => {
    const value = batch({ status: "ready", payment_deadline_at: "2026-01-04T00:00:00Z", prescreening_applications: [participant("approved"), participant("not_required"), participant("rejected")] });
    const before = screeningSummary(value, Date.parse("2026-01-03T23:59:59Z"));
    expect(before.payable).toBe(true); expect(before.remaining).toHaveLength(2);
    const expired = screeningSummary(value, Date.parse("2026-01-04T00:00:00Z"));
    expect(expired.payable).toBe(false); expect(expired.detail).toContain("checking any existing checkout");
    expect(value.payment_deadline_at).toBe("2026-01-04T00:00:00Z");
  });
  it("does not call no-screen participants approved or start an unavailable payment path", () => {
    const value = batch({ prescreening_applications: [participant("approved"), participant("not_required")] });
    expect(screeningSummary(value)).toMatchObject({ payable: false, pending: 0, title: "Waiting for payment to become available" });
  });
});
