import type { User } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

let buildSnapshots: typeof import("./index").buildSnapshots;
let readRows: typeof import("./index").readRows;

beforeAll(async () => {
  vi.stubGlobal("Deno", { serve: vi.fn() });
  ({ buildSnapshots, readRows } = await import("./index"));
});
afterAll(() => vi.unstubAllGlobals());

const users: User[] = [{
  id: "booker", email: "booker@example.com", app_metadata: {}, user_metadata: {},
  aud: "authenticated", created_at: "2026-09-01T00:00:00Z",
}];
const paidAt = "2026-09-30T07:36:03Z";
function fixture(amounts = [174359, 174359], captured = 348718) {
  return {
    profiles: [], roles: [], managers: [{ user_id: "booker", passport_id: "managed" }],
    passports: [
      { id: "own", claimed_user_id: "booker", first_name: "Account", last_name: "Runner" },
      { id: "managed", first_name: "Managed", last_name: "Runner" },
    ],
    registrations: ["own", "managed"].map((passport, index) => ({
      id: `r${index}`, booked_by_user_id: "booker", participant_passport_id: passport,
      booking_order_id: "order", status: "paid", total_amount: 170000,
      created_at: "2026-09-30T07:33:28Z", events: { name: "Backyard Ultra", event_date: "2026-11-28", status: "open" },
      categories: { label: "6.706" }, payments: [],
    })),
    groupAttempts: [{
      id: "attempt", booking_order_id: "order", booked_by_user_id: "booker", method: "gcash", status: "paid",
      gross_cents: 340000, created_at: "2026-09-30T07:33:50Z",
      booking_payment_captures: [
        { state: "reconciliation_required", created_at: "2026-09-30T07:35:00Z", amount: 999999, booking_payment_allocations: [] },
        { state: "fulfilled", created_at: paidAt, amount: captured,
          booking_payment_allocations: amounts.map((amount, index) => ({ registration_id: `r${index}`, gross_cents: amount })) },
      ],
    }],
  };
}

describe("platform users captured payment amounts", () => {
  it("uses participant allocations including provider fees and keeps the account transaction total", () => {
    const [user] = buildSnapshots(users, fixture());
    expect(user.registrations[0].payment).toMatchObject({ method: "gcash", amountCents: 174359, paidAt });
    expect(user.passports.map(passport => passport.latestPayment?.amountCents)).toEqual([174359, 174359]);
    expect(user.registrations[0].amountCents).toBe(170000);
    expect(user.latestPayment).toMatchObject({ amountCents: 348718, paidAt });
  });

  it("preserves unequal allocations instead of dividing the checkout total", () => {
    const [user] = buildSnapshots(users, fixture([10000, 25000], 35000));
    expect(user.passports.map(passport => passport.registrations[0].payment?.amountCents)).toEqual([10000, 25000]);
    expect(user.latestPayment?.amountCents).toBe(35000);
  });

  it("preserves zero-valued fulfilled free captures", () => {
    const [user] = buildSnapshots(users, fixture([0, 0], 0));
    expect(user.passports.map(passport => passport.latestPayment?.amountCents)).toEqual([0, 0]);
    expect(user.latestPayment?.amountCents).toBe(0);
  });

  it("does not invent participant payments when allocations or fulfillment are missing", () => {
    const rows = fixture();
    rows.groupAttempts[0].booking_payment_captures[1].booking_payment_allocations = [];
    const [user] = buildSnapshots(users, rows);
    expect(user.registrations[0].payment).toBeNull();
    expect(user.passports.every(passport => passport.latestPayment === null)).toBe(true);
    expect(user.latestPayment?.amountCents).toBe(348718);
    rows.groupAttempts[0].booking_payment_captures.splice(1);
    expect(buildSnapshots(users, rows)[0].latestPayment).toBeNull();
  });

  it.each(["paid", "refunded"])("retains legacy %s payment amounts and capture dates", status => {
    const rows = fixture();
    rows.registrations[0] = { ...rows.registrations[0], booking_order_id: "", payments: [] };
    const legacy = {
      ...rows,
      registrations: [{ ...rows.registrations[0], payments: [{ status, method: "card", amount: 180000, paid_at: paidAt, created_at: "2026-09-30T07:30:00Z" }] }],
      groupAttempts: [],
    };
    const [user] = buildSnapshots(users, legacy);
    expect(user.registrations[0].payment).toMatchObject({ method: "card", amountCents: 180000, paidAt });
    expect(user.latestPayment?.amountCents).toBe(180000);
  });

  it("reads capture amounts and allocations in both booker and managed-order queries", async () => {
    const selects: { table: string; columns: string }[] = [];
    const rows = fixture();
    const from = (table: string) => {
      const data = table === "registrations" ? rows.registrations : [];
      const query = {
        select(columns: string) { selects.push({ table, columns }); return query; },
        in() { return query; }, or() { return query; }, eq() { return query; },
        then(resolve: (result: { data: unknown[]; error: null }) => unknown) { return Promise.resolve(resolve({ data, error: null })); },
      };
      return query;
    };
    await readRows({ from } as unknown as Parameters<typeof readRows>[0], ["booker"]);
    const paymentReads = selects.filter(select => select.table === "booking_payment_attempts");
    expect(paymentReads).toHaveLength(2);
    for (const read of paymentReads) {
      expect(read.columns).toContain("amount:capture->amount");
      expect(read.columns).toContain("booking_payment_allocations(registration_id,gross_cents)");
    }
  });
});
