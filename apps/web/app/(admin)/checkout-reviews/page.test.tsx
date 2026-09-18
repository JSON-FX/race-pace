import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const getMyRoles = vi.fn();
const listUnboundCheckoutReviews = vi.fn();
const notFound = vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); });

vi.mock("@/lib/queries/roles", () => ({ getMyRoles: () => getMyRoles() }));
vi.mock("@/lib/queries/unbound-checkouts", () => ({
  listUnboundCheckoutReviews: () => listUnboundCheckoutReviews(),
}));
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));

import CheckoutReviewsPage from "./page";

beforeEach(() => {
  getMyRoles.mockReset();
  listUnboundCheckoutReviews.mockReset().mockResolvedValue([]);
  notFound.mockClear();
});

it("hides the page from an organization admin before querying review data", async () => {
  getMyRoles.mockResolvedValue({ capabilities: ["manage_org", "manage_team"] });
  await expect(CheckoutReviewsPage()).rejects.toThrow("NEXT_NOT_FOUND");
  expect(listUnboundCheckoutReviews).not.toHaveBeenCalled();
});

it("shows a platform super admin the unresolved count and provider warning", async () => {
  getMyRoles.mockResolvedValue({ capabilities: ["manage_platform"] });
  listUnboundCheckoutReviews.mockResolvedValue([{
    registration_id: "reg-1", event_id: "event-1", event_name: "Trail 40",
    org_id: "org-1", org_name: "Race Club", amount_cents: 125050,
    expires_at: "2026-09-18T01:00:00Z", latest_outcome: "missing_session_ref",
    attempts: 1, last_attempt_at: "2026-09-18T01:05:00Z", capture_count: 0,
  }]);

  render(await CheckoutReviewsPage());
  expect(screen.getByText("1 unresolved")).toBeInTheDocument();
  expect(screen.getByText("Provider verification required.")).toBeInTheDocument();
  expect(screen.getByText("Trail 40")).toBeInTheDocument();
  expect(screen.getByText("₱1,250.50")).toBeInTheDocument();
  expect(screen.getByText("reg-1")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /release|retry|bind/i })).not.toBeInTheDocument();
});
