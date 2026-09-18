import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RefundNotice } from "../RefundNotice";

describe("runner refund disclosure", () => {
  it("does not promise a refund under a no-refund policy", () => {
    render(<RefundNotice policy="none" />);
    expect(screen.getByText(/does not offer refunds/)).toBeInTheDocument();
    expect(screen.queryByText(/Contact the organizer to request/)).not.toBeInTheDocument();
  });
  it("discloses retained fees even for the policy internally named full", () => {
    render(<RefundNotice policy="full" />);
    expect(screen.getByText(/your refund excludes payment processing fees/)).toBeInTheDocument();
    expect(screen.getByText(/even when the organizer covers them/)).toBeInTheDocument();
  });
  it("discloses a capped organizer retention without promising a negative refund", () => {
    render(<RefundNotice policy="flat_fee" retention={10000} />);
    expect(screen.getByText(/up to ₱100/)).toHaveTextContent(/cannot be less than zero/);
  });
  it.each([undefined, "unknown"])("does not infer a full policy from %s", policy => {
    render(<RefundNotice policy={policy} />);
    expect(screen.getByText(/Refund terms are unavailable/)).toBeInTheDocument();
  });
  it("does not invent the organizer fee when the amount is unavailable", () => {
    render(<RefundNotice policy="flat_fee" retention={null} />);
    expect(screen.getByText(/Refund terms are unavailable/)).toBeInTheDocument();
  });
});
