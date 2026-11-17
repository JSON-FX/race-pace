import { afterEach, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { mapReg } from "@/lib/registration";
import { ReservationCard } from "../ReservationCard";

const due = "2098-12-01T16:00:00Z";
function row(overrides: Record<string, unknown> = {}) {
  return mapReg({ id: "r1", event_id: "e1", status: "pending", total_amount: 180000,
    expires_at: due, pay_later_grant_id: "g1", pay_later_due_at: due,
    events: { name: "Apo Ridge Trail", status: "open", registration_closes_at: "2000-01-01T00:00:00Z" },
    categories: { label: "21 km" }, ...overrides });
}
afterEach(() => vi.useRealTimers());

it("shows a reserved ticket with payment beyond admission close and no check-in code", () => {
  render(<ReservationCard registration={row()} runnerName="Juan Dela Cruz" />);
  expect(screen.getByText("Reserved · unpaid")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Pay now" })).toHaveAttribute("href", "/pay/r1");
  expect(screen.getByText("December 1, 2098 at 11:59 p.m. Philippine time")).toBeInTheDocument();
  expect(screen.queryByText(/DEMO-/)).not.toBeInTheDocument();
});

it("invalidates the visible reservation at the exact deadline before the database sweep", () => {
  vi.useFakeTimers(); vi.setSystemTime(Date.parse(due) - 500);
  render(<ReservationCard registration={row()} />);
  expect(screen.getByRole("link", { name: "Pay now" })).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(501));
  expect(screen.getByText("Expired")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Pay now" })).not.toBeInTheDocument();
});

it.each(["pending", "expired"])("explains cancelled events accurately while registration is %s", status => {
  render(<ReservationCard registration={row({ status, events: { name: "Race", status: "cancelled" } })} />);
  expect(screen.getByText("Entry closed")).toBeInTheDocument();
  expect(screen.getByText(/organizer closed this event/)).toBeInTheDocument();
  expect(screen.queryByText(/deadline passed|Your slot is held/)).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Pay now" })).not.toBeInTheDocument();
});

it("does not blame a missed deadline for an early expired registration", () => {
  render(<ReservationCard registration={row({ status: "expired" })} />);
  expect(screen.getByText(/closed before payment/)).toBeInTheDocument();
  expect(screen.queryByText(/deadline passed/)).not.toBeInTheDocument();
});

it("uses the frozen fee mode and platform fee after organizer settings change", () => {
  render(<ReservationCard registration={row({
    organizations: { fee_mode: "absorb" },
    payments: { checkout_fee_mode: "pass_on", checkout_platform_fee: 18000 },
  })} />);
  expect(screen.getByText("Subtotal due")).toBeInTheDocument();
  expect(screen.getByText("₱1,980.00")).toBeInTheDocument();
  expect(screen.getByText(/processing is calculated at checkout/)).toBeInTheDocument();
});
