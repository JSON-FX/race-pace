import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), refund: vi.fn(), success: vi.fn(), info: vi.fn() }));
vi.mock("@/lib/actions/registrations", () => ({ previewRefundAction: mocks.preview, refundRegistrationAction: mocks.refund }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, info: mocks.info } }));
import { RefundModal } from "./RefundModal";
beforeEach(() => { vi.resetAllMocks(); mocks.preview.mockResolvedValue({ ok: true, total_paid: 100000, retained_fees: 4500, refund_amount: 95500 }); });
const setup = () => render(<RefundModal registration={{ id: "r", full_name: "QA", total_amount: 100000 }} onClose={vi.fn()} onDone={vi.fn()} />);
it("shows server fees and sends the reviewed amount", async () => {
  mocks.refund.mockResolvedValue({ ok: true, refund_amount: 95500 }); setup();
  expect(await screen.findByText("Refund ₱955?")).toBeInTheDocument();
  expect(screen.getByText("Retained fees: ₱45")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Confirm refund" }));
  expect(mocks.refund).toHaveBeenCalledWith("r", undefined, 95500);
  expect(mocks.success).toHaveBeenCalledWith("Refunded ₱955");
});
it.each([{ pending: true }, { already: true }])("does not announce success for %j", async outcome => {
  mocks.refund.mockResolvedValue({ ok: true, ...outcome }); setup();
  await screen.findByText("Refund ₱955?"); await userEvent.click(screen.getByRole("button", { name: "Confirm refund" }));
  expect(mocks.success).not.toHaveBeenCalled(); expect(mocks.info).toHaveBeenCalled();
});
it("keeps confirmation disabled when preview fails", async () => {
  mocks.preview.mockResolvedValue({ ok: false, error: "No permission" }); setup();
  await screen.findByText("No permission"); expect(screen.getByRole("button", { name: "Confirm refund" })).toBeDisabled();
});
it("preserves the dialog on execution failure", async () => {
  mocks.refund.mockResolvedValue({ ok: false, error: "Refund failed" }); setup();
  await screen.findByText("Refund ₱955?"); await userEvent.click(screen.getByRole("button", { name: "Confirm refund" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Refund failed")); expect(mocks.success).not.toHaveBeenCalled();
});
it("lets an admin check a pending refund without changing its note or amount", async () => {
  mocks.preview.mockResolvedValue({ ok: true, pending: true, already: true, refund_amount: 95500 });
  mocks.refund.mockResolvedValue({ ok: true, pending: true }); setup();
  const check = await screen.findByRole("button", { name: "Check refund status" });
  expect(screen.getByLabelText("Refund note")).toBeDisabled();
  await userEvent.click(check);
  expect(mocks.refund).toHaveBeenCalledWith("r", undefined, 95500);
  expect(mocks.success).not.toHaveBeenCalled();
});
