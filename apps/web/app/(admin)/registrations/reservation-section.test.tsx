import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ReservationRosterSection } from "./reservation-section";

const { from, eq, limit, profileIds } = vi.hoisted(() => ({
  from: vi.fn(), eq: vi.fn(), limit: vi.fn(), profileIds: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }));
vi.mock("@/components/RunnerAvatar", () => ({
  RunnerAvatar: ({ name, email, avatarUrl }: { name: string; email: string; avatarUrl?: string }) =>
    <div><img alt={`${name} avatar`} src={avatarUrl} /><strong>{name}</strong><span>{email}</span></div>,
}));

const reservation = {
  id: "res-1", user_id: "runner-1", email: "runner@example.test", status: "paid", quantity: 2,
  registration_deadline_at: "2027-05-01T02:00:00Z", paid_at: "2026-09-30T01:15:00Z", created_at: "2026-09-29T00:00:00Z",
  event_reservation_places: [
    { id: "p1", participant_name: "My Race Passport", is_managed: false, status: "reserved" },
    { id: "p2", participant_name: "Alex Santos", is_managed: true, status: "reserved" },
  ],
  reservation_payments: [{ amount_cents: 40000, status: "paid" }],
};
beforeEach(() => {
  vi.clearAllMocks();
  const query = { select: vi.fn().mockReturnThis(), eq, order: vi.fn().mockReturnThis(), limit };
  eq.mockReturnValue(query);
  from.mockImplementation((table: string) => table === "profiles" ? { select: () => ({ in: profileIds }) } : query);
  limit.mockResolvedValue({ data: [reservation], error: null });
  profileIds.mockResolvedValue({ data: [{ id: "runner-1", full_name: "Jamie Cruz", avatar_url: "/jamie.png" }], error: null });
});

describe("early reservation identity and payment date", () => {
  it("loads the scoped booker identity once and preserves managed participants", async () => {
    render(await ReservationRosterSection({ eventId: "event-1", orgId: "org-1" }));
    expect(eq).toHaveBeenCalledWith("event_id", "event-1");
    expect(eq).toHaveBeenCalledWith("org_id", "org-1");
    expect(profileIds).toHaveBeenCalledWith("id", ["runner-1"]);
    expect(screen.getByText("Jamie Cruz")).toBeInTheDocument();
    expect(screen.getByAltText("Jamie Cruz avatar")).toHaveAttribute("src", "/jamie.png");
    expect(screen.queryByText("My Race Passport")).not.toBeInTheDocument();
    expect(screen.getByText(/Alex Santos · Managed Passport/)).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Reservation paid date" })).toBeInTheDocument();
    expect(screen.getByText("Sep 30, 2026, 9:15 AM PHT")).toHaveAttribute("datetime", reservation.paid_at);
  });

  it("retains the payment date after a paid reservation converts to an entry", async () => {
    limit.mockResolvedValue({ data: [{ ...reservation, status: "converted" }], error: null });
    render(await ReservationRosterSection({ eventId: "event-1", orgId: "org-1" }));
    expect(screen.getByText("Sep 30, 2026, 9:15 AM PHT")).toHaveAttribute("datetime", reservation.paid_at);
  });

  it("shows the booker identity when the group contains only managed Passports", async () => {
    limit.mockResolvedValue({ data: [{ ...reservation, event_reservation_places: [reservation.event_reservation_places[1]] }], error: null });
    render(await ReservationRosterSection({ eventId: "event-1", orgId: "org-1" }));
    expect(screen.getByText("Jamie Cruz")).toBeInTheDocument();
    expect(screen.getByText(/Alex Santos · Managed Passport/)).toBeInTheDocument();
  });

  it("falls back to a meaningful snapshot when a current profile has no name", async () => {
    profileIds.mockResolvedValue({ data: [], error: null });
    limit.mockResolvedValue({ data: [{ ...reservation, event_reservation_places: [{ ...reservation.event_reservation_places[0], participant_name: "Jordan Reyes" }] }], error: null });
    render(await ReservationRosterSection({ eventId: "event-1", orgId: "org-1" }));
    expect(screen.getByText("Jordan Reyes")).toBeInTheDocument();
  });

  it.each(["pending", "paid"])("does not substitute a creation date for a %s row with no paid timestamp", async (status) => {
    profileIds.mockResolvedValue({ data: [], error: null });
    limit.mockResolvedValue({ data: [{ ...reservation, status, paid_at: null }], error: null });
    render(await ReservationRosterSection({ eventId: "event-1", orgId: "org-1" }));
    const row = screen.getAllByRole("row")[1];
    expect(within(row).getAllByRole("cell")[5]).toHaveTextContent("—");
    expect(within(row).queryByText(/29 Sept 2026/)).not.toBeInTheDocument();
    expect(within(row).queryByText("My Race Passport")).not.toBeInTheDocument();
  });

  it("fails visibly when the authorized profile lookup fails", async () => {
    profileIds.mockResolvedValue({ data: null, error: new Error("Profile read unavailable") });
    await expect(ReservationRosterSection({ eventId: "event-1", orgId: "org-1" })).rejects.toThrow("Profile read unavailable");
  });
});
