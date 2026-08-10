import { render, screen } from "@testing-library/react";
import { PaymentStatusBadge, EventStatusBadge, RegistrationStatusBadge } from "./StatusBadge";

it("labels each payment status", () => {
  const { rerender } = render(<PaymentStatusBadge status="paid" />);
  expect(screen.getByText("Paid")).toBeInTheDocument();
  expect(screen.getByText("Paid")).not.toHaveClass("capitalize");
  rerender(<PaymentStatusBadge status="refunded" />);
  expect(screen.getByText("Refunded")).toBeInTheDocument();
});

it("falls back to an em dash for a null payment status", () => {
  render(<PaymentStatusBadge status={null} />);
  expect(screen.getByText("—")).toBeInTheDocument();
});

it("humanises event statuses, including unknown ones", () => {
  const { rerender } = render(<EventStatusBadge status="almost_full" />);
  expect(screen.getByText("Almost full")).toBeInTheDocument();
  expect(screen.getByText("Almost full")).toHaveClass("capitalize");
  rerender(<EventStatusBadge status="some_new_state" />);
  expect(screen.getByText("some new state")).toBeInTheDocument();
  expect(screen.getByText("some new state")).toHaveClass("capitalize");
});

// Task 9: expired/cancelled registrations need a tone an organizer can tell
// apart from each other at a glance, not just a label — see REGISTRATION's
// doc comment in StatusBadge.tsx for the reasoning (expired = passive/common,
// cancelled = a deliberate action).
it("gives expired a neutral tone and cancelled a danger tone", () => {
  const { rerender } = render(<RegistrationStatusBadge status="expired" />);
  expect(screen.getByText("Expired")).toHaveClass("bg-muted", "text-muted-foreground");

  rerender(<RegistrationStatusBadge status="cancelled" />);
  expect(screen.getByText("Cancelled")).toHaveClass("bg-destructive-tint", "text-destructive");
});

it("falls back to an em dash for a null registration status", () => {
  render(<RegistrationStatusBadge status={null} />);
  expect(screen.getByText("—")).toBeInTheDocument();
});
