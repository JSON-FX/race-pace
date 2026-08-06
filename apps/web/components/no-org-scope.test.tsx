import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NoOrgScope } from "./no-org-scope";

describe("NoOrgScope", () => {
  it("renders the explanatory copy without throwing", () => {
    expect(() => render(<NoOrgScope />)).not.toThrow();
    expect(screen.getByText("No organization on this account")).toBeInTheDocument();
    expect(screen.getByText(/isn't attached to an organization/i)).toBeInTheDocument();
  });
});
