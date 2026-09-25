import { describe, expect, it } from "vitest";
import { filterReservationPayments } from "./reservation-payment-filters";
import type { ReservationPaymentRow } from "./queries/reservation-payments";

const row = (fields: Partial<ReservationPaymentRow>): ReservationPaymentRow => ({
  id: "payment-1", event_id: "event-1", event_name: "Highland Traverse",
  runner_name: "E2E Runner", runner_email: "runner@example.test", runner_avatar_url: null,
  paid_at: "2026-09-24T17:30:00Z", method: "qrph", amount_cents: 104569,
  platform_fee_cents: 3000, processor_fee_cents: 1569, net_to_org_cents: 100000,
  ...fields,
});

describe("filterReservationPayments", () => {
  const rows = [row({}), row({ id: "payment-2", runner_name: "Maya Cruz", runner_email: "maya@example.test", method: "paymaya", paid_at: "2026-09-26T01:00:00Z" })];

  it("searches runner and event without mixing registration payment data", () => {
    expect(filterReservationPayments(rows, { search: "e2e", method: "all", from: "", to: "" }).map((item) => item.id)).toEqual(["payment-1"]);
    expect(filterReservationPayments(rows, { search: "highland", method: "all", from: "", to: "" })).toHaveLength(2);
  });

  it("filters by method and Philippine paid date, including local day boundaries", () => {
    expect(filterReservationPayments(rows, { search: "", method: "qrph", from: "2026-09-25", to: "2026-09-25" }).map((item) => item.id)).toEqual(["payment-1"]);
    expect(filterReservationPayments(rows, { search: "", method: "paymaya", from: "2026-09-25", to: "2026-09-25" })).toEqual([]);
  });
});
