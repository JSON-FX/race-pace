import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { EventRow } from "@/lib/events";
import type { ScreeningBatch } from "@/lib/prescreening-status";
import { RequestStatus } from "./request-status";

const { operation, push, refresh } = vi.hoisted(() => ({ operation: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/lib/prescreening", () => ({ screeningOperation: operation }));
vi.mock("@/components/prescreening/ScreeningEmailStatus", () => ({ ScreeningEmailStatus: () => null }));

const event = { id: "event", name: "North Ridge", slug: "north-ridge" } as EventRow;
const batch: ScreeningBatch = { id: "batch", event_id: "event", status: "ready", checkout_intent: "reservation",
  created_at: "2026-09-01T00:00:00Z", payment_deadline_at: "2099-01-01T00:00:00Z", booking_order_id: null,
  event_reservation_id: "existing-reservation", prescreening_applications: [{ id: "application", category_id: "70k",
    participant_passport_id: "passport", participant_name: "Alex Reyes", is_managed: false, decision: "approved",
    screening_required: true, requirement_snapshot: "Complete 50K", proof_upload_id: "proof", explanation: null,
    rejection_reason: null, released_at: null, categories: { label: "70K", base_price: 350000, reservation_fee_cents: 50000 } }] };

beforeEach(() => { vi.clearAllMocks(); });
describe("screening reservation payment retries", () => {
  it("re-enters verified checkout for an existing reservation using the original batch identity", async () => {
    operation.mockResolvedValue({ reservation_id: "existing-reservation", status: "paid" });
    render(<RequestStatus batch={batch} event={event} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue to reservation" }));
    await waitFor(() => expect(operation).toHaveBeenCalledWith("reservation-checkout", expect.objectContaining({
      idempotency_key: batch.id, prescreening_batch_id: batch.id,
      participants: [{ participant_passport_id: "passport", category_id: "70k" }],
    })));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/reservations/existing-reservation"));
  });
  it("displays frozen reservation fees after the category price changes", () => {
    render(<RequestStatus batch={{ ...batch, prescreening_applications: [{ ...batch.prescreening_applications[0],
      categories: { ...batch.prescreening_applications[0].categories, reservation_fee_cents: 90000 },
      event_reservation_places: [{ reservation_fee_cents: 50000 }],
    }] }} event={event} />);
    expect(screen.getAllByText("₱500.00")).toHaveLength(2);
    expect(screen.queryByText("₱900.00")).not.toBeInTheDocument();
  });
  it("keeps existing reservation payment disabled while another required review is pending", () => {
    render(<RequestStatus batch={{ ...batch, status: "reviewing", payment_deadline_at: null,
      prescreening_applications: [{ ...batch.prescreening_applications[0], decision: "pending" }] }} event={event} />);
    expect(screen.getByRole("button", { name: "Waiting for group approval" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Continue to reservation" })).not.toBeInTheDocument();
    expect(operation).not.toHaveBeenCalled();
  });
});

it.each(["infinity", "2098-11-01T16:00:00Z"])("separates approved entry completion from payment with admission cutoff %s", admissionDeadline => {
  render(<RequestStatus batch={{ ...batch, checkout_intent: "entry", event_reservation_id: null, payment_deadline_at: admissionDeadline }}
    event={event} payLater={{ id: "g1", dueAt: "2098-12-01T16:00:00Z" }} />);
  expect(screen.getByRole("heading", { name: "Your category is approved" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Complete entry details" })).toHaveAttribute("href", "/register/70k?prescreening=batch&participant=passport");
  expect(screen.getByText(/Nothing is due today/)).toBeInTheDocument();
  expect(screen.getByText(/After confirmation, pay by December 1, 2098 at 11:59 p.m. Philippine time/)).toHaveTextContent(
    admissionDeadline === "infinity" ? "before the organizer closes registration" : "before the registration deadline shown on this request",
  );
  expect(screen.queryByText(/You can pay until the registration deadline/)).not.toBeInTheDocument();
});

it("retains ordinary group registration for managed screening requests", () => {
  render(<RequestStatus batch={{ ...batch, checkout_intent: "entry", event_reservation_id: null,
    prescreening_applications: [{ ...batch.prescreening_applications[0], is_managed: true }] }}
    event={event} payLater={{ id: "g1", dueAt: "2098-12-01T16:00:00Z" }} />);
  expect(screen.getByRole("link", { name: "Complete entry details" })).toHaveAttribute("href", "/register/70k/group?prescreening=batch");
  expect(screen.queryByText(/Nothing is due today/)).not.toBeInTheDocument();
  expect(screen.getByText(/You can pay until the registration deadline/)).toBeInTheDocument();
});
