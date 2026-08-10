import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RegistrationRow } from "@/lib/queries/registrations";
import { RegistrationDetail } from "./RegistrationDetail";

// RegistrationDetail fetches add-ons via the browser Supabase client on
// mount, and refunds through RefundModal -> refundRegistrationAction (a
// server action). Stub both so the modal renders without a real network
// call or NEXT_PUBLIC_SUPABASE_* env vars.
const addonResult: { data: unknown; error: unknown } = {
  data: [{ price: 60000, addons: { name: "Singlet" } }],
  error: null,
};
const selectMock = vi.fn(() => ({ eq: () => Promise.resolve(addonResult) }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from: () => ({ select: selectMock }) }),
}));

const refundRegistrationAction = vi.fn((..._args: unknown[]) => Promise.resolve({ ok: true }));
vi.mock("@/lib/actions/registrations", () => ({
  refundRegistrationAction: (...a: unknown[]) => refundRegistrationAction(...a),
}));

const paidRow: RegistrationRow = {
  id: "r1", user_id: "u1", category_id: "c4", category_label: "10K",
  full_name: "Ana Cruz", bib_name: "ANA", email: "ana@example.com",
  total_amount: 100000, payment_status: "paid", payment_method: "gcash", registration_status: "paid",
  created_at: "2026-07-01T00:00:00Z", custom_data: { blood_type: "O", first_ultra: true },
};
const pendingRow: RegistrationRow = { ...paidRow, payment_status: "pending", payment_method: null, registration_status: "pending" };

/** The refund button's label carries the amount, so every lookup has to be a
 *  prefix match — an exact "Refund" would silently stop matching the moment
 *  the amount changes. */
const refundButton = () => screen.getByRole("button", { name: /^Refund ₱/ });

beforeEach(() => {
  refundRegistrationAction.mockClear();
  selectMock.mockClear();
  addonResult.data = [{ price: 60000, addons: { name: "Singlet" } }];
  addonResult.error = null;
});

describe("RegistrationDetail", () => {
  it("shows the registration and enables Refund only when paid", async () => {
    const { rerender } = render(<RegistrationDetail row={pendingRow} onClose={vi.fn()} onRefunded={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Ana Cruz")).toBeInTheDocument();
    expect(screen.getByText("10K")).toBeInTheDocument();
    expect(refundButton()).toBeDisabled();

    await waitFor(() => expect(screen.getByText("Singlet")).toBeInTheDocument());

    rerender(<RegistrationDetail row={paidRow} onClose={vi.fn()} onRefunded={vi.fn()} />);
    expect(refundButton()).not.toBeDisabled();
  });

  it("says WHY refund is unavailable rather than only greying the button out", () => {
    const { rerender } = render(<RegistrationDetail row={pendingRow} onClose={vi.fn()} onRefunded={vi.fn()} />);
    expect(screen.getByText(/only a completed payment can be refunded/i)).toBeInTheDocument();

    rerender(<RegistrationDetail row={{ ...paidRow, payment_status: "refunded" }} onClose={vi.fn()} onRefunded={vi.fn()} />);
    expect(screen.getByText(/already refunded/i)).toBeInTheDocument();
  });

  it("labels the money band by payment status, not by colour alone", () => {
    const { rerender } = render(<RegistrationDetail row={paidRow} onClose={vi.fn()} onRefunded={vi.fn()} />);
    expect(screen.getByText("Total paid")).toBeInTheDocument();

    rerender(<RegistrationDetail row={pendingRow} onClose={vi.fn()} onRefunded={vi.fn()} />);
    expect(screen.getByText("Awaiting payment")).toBeInTheDocument();
  });

  // Task 9: the header badge must show the registration's own lifecycle
  // state for expired/cancelled, same swap as the table's Status column —
  // an organizer who clicked through from an "Expired" row should not land
  // on a sheet that says "Failed" or "—" instead.
  it("shows Expired instead of the payment status badge for an expired registration", () => {
    const expiredRow: RegistrationRow = { ...paidRow, payment_status: null, registration_status: "expired" };
    render(<RegistrationDetail row={expiredRow} onClose={vi.fn()} onRefunded={vi.fn()} />);
    expect(screen.getByText("Expired")).toBeInTheDocument();
  });

  it("shows Cancelled instead of the payment status badge for a cancelled registration", () => {
    const cancelledRow: RegistrationRow = { ...paidRow, payment_status: "failed", registration_status: "cancelled" };
    render(<RegistrationDetail row={cancelledRow} onClose={vi.fn()} onRefunded={vi.fn()} />);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });

  it("itemises the total into entry fee plus add-ons, which sum back to it", async () => {
    render(<RegistrationDetail row={paidRow} onClose={vi.fn()} onRefunded={vi.fn()} />);

    // ₱1,000 total − ₱600 add-on = ₱400 entry. The three figures have to agree
    // or the breakdown is worse than no breakdown.
    await waitFor(() => expect(screen.getByText("10K entry")).toBeInTheDocument());
    expect(screen.getByText("₱400")).toBeInTheDocument();
    expect(screen.getByText("₱600")).toBeInTheDocument();
    expect(screen.getAllByText("₱1,000").length).toBeGreaterThan(0);
  });

  it("omits the breakdown entirely when the add-on read fails", async () => {
    addonResult.data = null;
    addonResult.error = { message: "nope" };
    render(<RegistrationDetail row={paidRow} onClose={vi.fn()} onRefunded={vi.fn()} />);

    // Never guess: without the add-ons, the entry fee is unknowable, so no
    // line may claim to be it.
    await waitFor(() => expect(selectMock).toHaveBeenCalled());
    expect(screen.queryByText("10K entry")).not.toBeInTheDocument();
    expect(screen.getAllByText("₱1,000").length).toBeGreaterThan(0);
  });

  it("shows custom fields with human labels and readable values", () => {
    render(<RegistrationDetail row={paidRow} onClose={vi.fn()} onRefunded={vi.fn()} />);
    expect(screen.getByText("Blood type")).toBeInTheDocument();
    expect(screen.getByText("O")).toBeInTheDocument();
    // A checkbox answer is a real boolean in custom_data; "true" is not a word
    // an organizer should have to read.
    expect(screen.getByText("First ultra")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.queryByText("blood_type")).not.toBeInTheDocument();
  });

  it("offers the email and the registration id for copying", () => {
    render(<RegistrationDetail row={paidRow} onClose={vi.fn()} onRefunded={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Copy email" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy registration id" })).toBeInTheDocument();
  });

  it("refunds through the confirm modal and calls onRefunded", async () => {
    const user = userEvent.setup();
    const onRefunded = vi.fn();
    render(<RegistrationDetail row={paidRow} onClose={vi.fn()} onRefunded={onRefunded} />);

    await user.click(refundButton());                                            // opens RefundModal
    await user.click(screen.getByRole("button", { name: "Confirm refund" }));     // executes

    await waitFor(() => expect(refundRegistrationAction).toHaveBeenCalledWith("r1", undefined));
    await waitFor(() => expect(onRefunded).toHaveBeenCalled());
  });
});
