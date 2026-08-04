import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { RegistrationDetail } from "../components/RegistrationDetail";

const refundRegistration = vi.fn((..._args: unknown[]) => Promise.resolve({ ok: true }));
const useRegistrationAddons = vi.fn();
vi.mock("../lib/registrations", () => ({
  refundRegistration: (...a: unknown[]) => refundRegistration(...a),
  useRegistrationAddons: (...a: unknown[]) => useRegistrationAddons(...a),
}));

const paidRow = { id: "r1", user_id: "u1", category_id: "c4", category_label: "10K", full_name: "Ana Cruz", bib_name: "ANA", total_amount: 100000, payment_status: "paid", payment_method: "gcash", created_at: "2026-07-01T00:00:00Z", custom_data: { blood_type: "O" } };
const pendingRow = { ...paidRow, payment_status: "pending", payment_method: null };

beforeEach(() => {
  refundRegistration.mockClear();
  useRegistrationAddons.mockReset();
  useRegistrationAddons.mockReturnValue({ data: [{ name: "Singlet", price: 60000 }] });
});

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

it("shows the registration and enables Refund only when paid", () => {
  const { rerender } = render(wrap(<RegistrationDetail row={pendingRow as never} onClose={vi.fn()} onRefunded={vi.fn()} />));
  const dialog = screen.getByRole("dialog");
  expect(screen.getByText("Ana Cruz")).toBeInTheDocument();
  expect(screen.getByText("10K")).toBeInTheDocument();
  expect(screen.getByText("Singlet")).toBeInTheDocument();
  expect(dialog).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Refund" })).toBeDisabled();
  rerender(wrap(<RegistrationDetail row={paidRow as never} onClose={vi.fn()} onRefunded={vi.fn()} />));
  expect(screen.getByRole("button", { name: "Refund" })).not.toBeDisabled();
});

it("refunds through the confirm modal and calls onRefunded", async () => {
  const user = userEvent.setup();
  const onRefunded = vi.fn();
  render(wrap(<RegistrationDetail row={paidRow as never} onClose={vi.fn()} onRefunded={onRefunded} />));
  await user.click(screen.getByRole("button", { name: "Refund" }));           // opens modal
  await user.click(screen.getByRole("button", { name: "Confirm refund" }));   // executes
  await waitFor(() => expect(refundRegistration).toHaveBeenCalledWith("r1", undefined));
  await waitFor(() => expect(onRefunded).toHaveBeenCalled());
});
