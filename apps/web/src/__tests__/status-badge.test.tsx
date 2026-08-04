import { render, screen } from "@testing-library/react";
import { PaymentStatusBadge, EventStatusBadge } from "../components/StatusBadge";

it("labels each payment status", () => {
  const { rerender } = render(<PaymentStatusBadge status="paid" />);
  expect(screen.getByText("Paid")).toBeInTheDocument();
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
  rerender(<EventStatusBadge status="some_new_state" />);
  expect(screen.getByText("some new state")).toBeInTheDocument();
});
