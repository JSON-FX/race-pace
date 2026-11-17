import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { eligiblePayLaterScreening, fetchPayLaterTerms, payLaterDeadline, paymentClosed } from "../pay-later";

const now = Date.parse("2027-02-21T15:59:59Z");
const application = { participant_passport_id: "p1", category_id: "c1", decision: "approved", released_at: null, is_managed: false };
const batch = {
  id: "b1", status: "ready", checkout_intent: "entry", payment_deadline_at: "infinity",
  booking_order_id: null, event_reservation_id: null, prescreening_applications: [application],
};

describe("Pay Later terms", () => {
  it("shows the inclusive Philippine date before the exclusive midnight cutoff", () => {
    expect(payLaterDeadline("2027-02-21T16:00:00Z")).toBe("February 21, 2027 at 11:59 p.m. Philippine time");
  });
  it("scopes grant reads to the event and account and closes at the exact cutoff", async () => {
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "g1", due_at: "2027-02-21T16:00:00Z" }, error: null }) };
    const db = { from: vi.fn(() => query) } as unknown as SupabaseClient;
    expect(await fetchPayLaterTerms(db, "e1", "u1", now)).toEqual({ id: "g1", dueAt: "2027-02-21T16:00:00Z" });
    expect(query.eq.mock.calls).toEqual([["event_id", "e1"], ["user_id", "u1"]]);
    expect(await fetchPayLaterTerms(db, "e1", "u1", now + 1000)).toBeNull();
    query.maybeSingle.mockResolvedValueOnce({ data: null, error: new Error("network") });
    await expect(fetchPayLaterTerms(db, "e1", "u1", now)).rejects.toThrow("could not check");
  });
  it("allows an existing Pay Later reservation to pay after admission closes, while honoring closed states", () => {
    const closedAt = "2000-01-01T00:00:00Z", due = "2099-01-01T00:00:00Z";
    expect(paymentClosed("open", closedAt, due)).toBe(false);
    expect(paymentClosed("open", closedAt)).toBe(true);
    for (const status of ["coming_soon", "closed", "cancelled", "completed"]) expect(paymentClosed(status, null, due)).toBe(true);
  });
});

describe("self-only screening bridge", () => {
  it("accepts one approved self Passport with the current unlimited deadline", () => {
    expect(eligiblePayLaterScreening(batch, now)).toEqual({ batchId: "b1", passportId: "p1", categoryId: "c1", deadlineAt: "infinity" });
  });
  it("rejects mixed, managed, pending, rejected, consumed and expired requests", () => {
    expect(eligiblePayLaterScreening({ ...batch, prescreening_applications: [application, { ...application, participant_passport_id: "p2" }] }, now)).toBeNull();
    for (const change of [{ is_managed: true }, { decision: "pending" }, { decision: "rejected" }, { released_at: "2027-02-21" }]) {
      expect(eligiblePayLaterScreening({ ...batch, prescreening_applications: [{ ...application, ...change }] }, now)).toBeNull();
    }
    for (const change of [{ status: "expired" }, { checkout_intent: "reservation" }, { booking_order_id: "o1" }, { payment_deadline_at: new Date(now).toISOString() }]) {
      expect(eligiblePayLaterScreening({ ...batch, ...change }, now)).toBeNull();
    }
  });
});
