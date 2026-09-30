import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProfileActivityCards, type ProfileActivityProps } from "../ProfileActivityCards";
const props: ProfileActivityProps = { userId: "user", registrations: [], registrationsLoading: false, registrationsError: false,
  screeningBatches: [], screeningLoading: false, screeningError: false };
const batch = { id: "batch", status: "completed" as const, payment_deadline_at: null, events: { name: "Mountain race" },
  prescreening_applications: [{ id: "rejected", participant_name: "Alex Cruz", decision: "rejected" as const, rejection_reason: "A recent trail result is required.", released_at: "2026-09-30T00:00:00Z" }] };
describe("profile activity cards", () => {
  it("retains a rejected participant notice after the remaining group paid", () => {
    render(<ProfileActivityCards {...props} screeningBatches={[batch]} />);
    expect(screen.getByText("Pre-screening rejected")).toBeInTheDocument();
    expect(screen.getByText(/A recent trail result is required/)).toHaveTextContent("Slot released.");
    expect(screen.getByRole("link", { name: "View request" })).toHaveAttribute("href", "/prescreening/batch");
  });
  it("does not present successful zero totals while data is loading or failed", () => {
    const view = render(<ProfileActivityCards {...props} registrationsLoading screeningLoading />);
    expect(screen.getAllByRole("status")).toHaveLength(3);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    view.rerender(<ProfileActivityCards {...props} registrationsError screeningError />);
    expect(screen.getAllByRole("alert")).toHaveLength(3);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
  it("links a payable request to its existing payment details", () => {
    render(<ProfileActivityCards {...props} screeningBatches={[{ ...batch, status: "ready", payment_deadline_at: "2999-01-01T00:00:00Z",
      prescreening_applications: [{ ...batch.prescreening_applications[0], decision: "approved", released_at: null }] }]} />);
    expect(screen.getByRole("link", { name: "Review payment details" })).toHaveAttribute("href", "/prescreening/batch");
  });
  it("does not offer payment after the deadline or while review is pending", () => {
    render(<ProfileActivityCards {...props} screeningBatches={[{ ...batch, status: "ready", payment_deadline_at: "2000-01-01T00:00:00Z",
      prescreening_applications: [{ ...batch.prescreening_applications[0], decision: "approved", released_at: null }] }]} />);
    expect(screen.queryByRole("link", { name: "Review payment details" })).not.toBeInTheDocument();
    expect(screen.getByText("Your payment window has ended")).toBeInTheDocument();
  });
  it("links registered entries to tickets and active group holds to their group order", () => {
    render(<ProfileActivityCards {...props} registrations={[
      { id: "paid", participantUserId: "user", status: "paid", eventStatus: "open", categoryDistance: 13, expiresAt: null, eventName: "Race one", categoryLabel: "13K" },
      { id: "pending", participantUserId: "user", status: "pending", eventStatus: "open", categoryDistance: 7, expiresAt: "2999-01-01T00:00:00Z", eventName: "Race two", categoryLabel: "7K", bookingOrderId: "order" },
    ]} />);
    expect(screen.getByRole("link", { name: "View ticket" })).toHaveAttribute("href", "/ticket/paid");
    expect(screen.getByRole("link", { name: "Complete payment" })).toHaveAttribute("href", "/group/order/order");
    const history = screen.getByRole("heading", { name: "Completed races" }).closest("[data-slot=card]")!;
    expect(within(history as HTMLElement).getAllByText("0")).toHaveLength(2);
  });
});
