import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBadge } from "../StatusBadge";

describe("StatusBadge", () => {
  it("labels each registration status in plain language", () => {
    const cases: [string, string][] = [
      ["paid", "Confirmed"],
      ["pending", "Awaiting payment"],
      ["refunded", "Refunded"],
      ["cancelled", "Cancelled"],
    ];
    for (const [status, label] of cases) {
      const { unmount } = render(<StatusBadge status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it("falls back to the raw status for an unknown value", () => {
    render(<StatusBadge status="disputed" />);
    expect(screen.getByText("disputed")).toBeInTheDocument();
  });
});
