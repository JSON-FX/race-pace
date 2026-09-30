import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiscountCodeField } from "./DiscountCodeField";
const apply = vi.hoisted(() => vi.fn());
vi.mock("@/lib/discounts", () => ({
  applyDiscount: apply,
  restartDiscountCheckout: vi.fn(),
}));
beforeEach(() => {
  apply.mockReset();
});
it("submits on Enter and announces server validation errors", async () => {
  apply.mockRejectedValue(new Error("All uses of this code are taken."));
  const refreshed = vi.fn();
  render(<DiscountCodeField registrationId="reg" onApplied={refreshed} />);
  await userEvent.type(
    screen.getByLabelText("Discount code"),
    "TRAIL20{Enter}",
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "All uses of this code are taken.",
  );
  expect(apply).toHaveBeenCalledWith("reg", "TRAIL20");
  expect(refreshed).not.toHaveBeenCalled();
});
it("removes an applied code and refreshes the authoritative quote", async () => {
  apply.mockResolvedValue({});
  const refreshed = vi.fn();
  render(
    <DiscountCodeField
      registrationId="reg"
      code="TRAIL20"
      savings={20000}
      absorbed
      onApplied={refreshed}
    />,
  );
  expect(screen.getByText(/Organizer covers all fees/)).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Remove discount code" }),
  );
  await waitFor(() => expect(refreshed).toHaveBeenCalledOnce());
  expect(apply).toHaveBeenCalledWith("reg", "");
});
it("locks editing while a provider payment is unresolved", () => {
  render(
    <DiscountCodeField
      registrationId="reg"
      code="TRAIL20"
      disabled
      onApplied={() => {}}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Remove discount code" }),
  ).toBeDisabled();
  expect(screen.getByText(/locked while payment/)).toBeInTheDocument();
});
