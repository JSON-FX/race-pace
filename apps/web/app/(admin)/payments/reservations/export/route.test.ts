import { beforeEach, expect, it, vi } from "vitest";

const { roles, payments } = vi.hoisted(() => ({ roles: vi.fn(), payments: vi.fn() }));
vi.mock("@/lib/queries/roles", () => ({
  getMyRoles: roles,
  requireOrgId: (value: { orgId: string | null } | null) => value?.orgId ?? null,
}));
vi.mock("@/lib/queries/reservation-payments", () => ({ listReservationPayments: payments }));
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  roles.mockResolvedValue({ orgId: "own-org", capabilities: ["manage_org"] });
  payments.mockResolvedValue([{
    id: "payment-id", event_id: "event-id", event_name: '=HYPERLINK("bad")',
    runner_email: "runner@example.test", paid_at: "2026-09-25T00:00:00Z", method: "gcash",
    amount_cents: 535, platform_fee_cents: 15, processor_fee_cents: 20, net_to_org_cents: 500,
  }]);
});

it("exports only caller-scoped reservation money and escapes spreadsheet formulas", async () => {
  const response = await GET(new Request("https://admin.test/payments/reservations/export"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(payments).toHaveBeenCalledWith("own-org", undefined);
  const csv = await response.text();
  expect(csv).toContain("'=HYPERLINK");
  expect(csv).toContain("5.35,0.15,0.20,5.00");
});

it("denies staff without organization payment access", async () => {
  roles.mockResolvedValue({ orgId: "own-org", capabilities: ["check_in"] });
  const response = await GET(new Request("https://admin.test/payments/reservations/export"));
  expect(response.status).toBe(403);
  expect(payments).not.toHaveBeenCalled();
});

it("passes a validated event filter while keeping the caller's organization scope", async () => {
  const eventId = "11111111-1111-4111-8111-111111111111";
  const response = await GET(new Request(`https://admin.test/payments/reservations/export?event=${eventId}`));
  expect(response.status).toBe(200);
  expect(payments).toHaveBeenCalledWith("own-org", eventId);
  expect((await GET(new Request("https://admin.test/payments/reservations/export?event=wrong"))).status).toBe(400);
});
