import { beforeEach, expect, it, vi } from "vitest";

const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from, rpc }) }));

import { getEventReservations, getReservationCategoryAvailability } from "./reservations";

function query(data: unknown, error: Error | null = null) {
  return {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(),
    returns: vi.fn().mockResolvedValue({ data, error }),
    in: vi.fn().mockResolvedValue({ data, error }),
    then: (resolve: (value: { data: unknown; error: Error | null }) => unknown) => Promise.resolve({ data, error }).then(resolve),
  };
}

beforeEach(() => { from.mockReset(); rpc.mockReset(); });

it("maps every participant category ID once and keeps one checkout with its complete payment", async () => {
  const place = { id: "place-1", category_id: "category-25", participant_name: "Ana Runner", is_managed: false, status: "paid", entry_payment_deadline_at: null, categories: { code: "25k", label: "Trail", entry_payment_deadline_at: null } };
  const reservations = query([{
    id: "reservation-1", user_id: "user-1", email: "ana@example.test", status: "paid", paid_at: "2026-10-01T00:00:00Z",
    registration_deadline_at: null, checkout_expires_at: null, created_at: "2026-09-30T00:00:00Z",
    event_reservation_places: [
      place,
      { ...place, id: "place-2", category_id: "category-42", participant_name: "Bea Runner", is_managed: true, categories: { ...place.categories, code: "42k" } },
      { ...place, id: "place-3", participant_name: "Cam Runner", is_managed: true },
      { ...place, id: "place-4", category_id: null, participant_name: "Dan Runner", is_managed: true, categories: null },
    ],
    reservation_payments: { status: "paid", amount_cents: 84512, paid_at: "2026-10-01T00:00:00Z" },
  }]);
  const profiles = query([{ id: "user-1", full_name: "Ana Runner", avatar_url: null }]);
  from.mockImplementation(table => table === "event_reservations" ? reservations : profiles);

  const result = await getEventReservations("org-1", "event-1");

  expect(reservations.select).toHaveBeenCalledWith(expect.stringContaining("event_reservation_places(id,category_id,"));
  expect(reservations.eq).toHaveBeenCalledWith("org_id", "org-1");
  expect(reservations.eq).toHaveBeenCalledWith("event_id", "event-1");
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({ categoryIds: ["category-25", "category-42"], categories: ["25k", "42k", "Category unavailable"], amountCents: 84512 });
  expect(result.rows[0].managed).toHaveLength(3);
  expect(result.summary).toEqual({ total: 1, paid: 1, paidAmountCents: 84512, pending: 0 });
});

it("keeps empty event categories available independently of reservation rows", async () => {
  const categories = query([
    { id: "category-25", code: "25k", label: "Trail", slots_total: 100, reservation_enabled: true },
    { id: "category-empty", code: null, label: "100 miles", slots_total: 20, reservation_enabled: false },
  ]);
  from.mockReturnValue(categories);
  rpc.mockResolvedValue({ data: [{ category_id: "category-25", total_available: 99, general_available: 89, reservation_available: 10 }], error: null });

  const result = await getReservationCategoryAvailability("org-1", "event-1");

  expect(result.map(category => category.id)).toEqual(["category-25", "category-empty"]);
  expect(result[1]).toMatchObject({ label: "100 miles", totalAvailable: null, reservationEnabled: false });
  expect(categories.eq).toHaveBeenCalledWith("org_id", "org-1");
  expect(categories.eq).toHaveBeenCalledWith("event_id", "event-1");
});

it("propagates reservation read failures", async () => {
  const error = new Error("permission denied");
  from.mockReturnValue(query(null, error));
  await expect(getEventReservations("org-1", "event-1")).rejects.toBe(error);
});
