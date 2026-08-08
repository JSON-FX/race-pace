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
// RegistrationDetail now mounts RegistrationHistory alongside the add-ons fetch, which
// queries a second table (registration_audit) with an extra `.order()` step the add-ons
// query never had. Branch by table name so both fetches get a shape they can call.
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) =>
      table === "registration_audit"
        ? { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }
        : { select: selectMock },
  }),
}));

const refundRegistrationAction = vi.fn((..._args: unknown[]) => Promise.resolve({ ok: true }));
vi.mock("@/lib/actions/registrations", () => ({
  refundRegistrationAction: (...a: unknown[]) => refundRegistrationAction(...a),
}));

const paidRow: RegistrationRow = {
  id: "r1", user_id: "u1", category_id: "c4", category_label: "10K",
  full_name: "Ana Cruz", bib_name: "ANA", email: "ana@example.com",
  total_amount: 100000, payment_status: "paid", payment_method: "gcash",
  created_at: "2026-07-01T00:00:00Z", custom_data: { blood_type: "O", first_ultra: true },
};
const pendingRow: RegistrationRow = { ...paidRow, payment_status: "pending", payment_method: null };

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
