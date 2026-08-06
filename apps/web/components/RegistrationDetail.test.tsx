import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RegistrationRow } from "@/lib/queries/registrations";
import { RegistrationDetail } from "./RegistrationDetail";

// RegistrationDetail fetches add-ons via the browser Supabase client on
// mount, and refunds through RefundModal -> refundRegistrationAction (a
// server action). Stub both so the sheet renders without a real network
// call or NEXT_PUBLIC_SUPABASE_* env vars.
const selectMock = vi.fn(() => ({ eq: () => Promise.resolve({ data: [{ price: 60000, addons: { name: "Singlet" } }], error: null }) }));
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
  total_amount: 100000, payment_status: "paid", payment_method: "gcash",
  created_at: "2026-07-01T00:00:00Z", custom_data: { blood_type: "O" },
};
const pendingRow: RegistrationRow = { ...paidRow, payment_status: "pending", payment_method: null };

beforeEach(() => {
  refundRegistrationAction.mockClear();
  selectMock.mockClear();
});

describe("RegistrationDetail", () => {
  it("shows the registration and enables Refund only when paid", async () => {
    const { rerender } = render(<RegistrationDetail row={pendingRow} onClose={vi.fn()} onRefunded={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Ana Cruz")).toBeInTheDocument();
    expect(screen.getByText("10K")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refund" })).toBeDisabled();

    await waitFor(() => expect(screen.getByText("Singlet")).toBeInTheDocument());

    rerender(<RegistrationDetail row={paidRow} onClose={vi.fn()} onRefunded={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Refund" })).not.toBeDisabled();
  });

  it("shows the registration's custom fields", async () => {
    render(<RegistrationDetail row={paidRow} onClose={vi.fn()} onRefunded={vi.fn()} />);
    expect(screen.getByText("blood_type")).toBeInTheDocument();
    expect(screen.getByText("O")).toBeInTheDocument();
  });

  it("refunds through the confirm modal and calls onRefunded", async () => {
    const user = userEvent.setup();
    const onRefunded = vi.fn();
    render(<RegistrationDetail row={paidRow} onClose={vi.fn()} onRefunded={onRefunded} />);

    await user.click(screen.getByRole("button", { name: "Refund" }));            // opens RefundModal
    await user.click(screen.getByRole("button", { name: "Confirm refund" }));    // executes

    await waitFor(() => expect(refundRegistrationAction).toHaveBeenCalledWith("r1", undefined));
    await waitFor(() => expect(onRefunded).toHaveBeenCalled());
  });
});
