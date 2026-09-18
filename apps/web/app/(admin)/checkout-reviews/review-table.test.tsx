import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ReviewTable } from "./review-table";
import type { UnboundCheckoutReview } from "@/lib/queries/unbound-checkouts";

const row = (registration_id: string, expires_at: string | null): UnboundCheckoutReview => ({
  registration_id, expires_at, event_id: "event-1", event_name: "Trail 40",
  org_id: "org-1", org_name: "Race Club", amount_cents: 10000,
  latest_outcome: null, attempts: 0, last_attempt_at: null, capture_count: 0,
});

it("orders dated holds oldest first and keeps unknown deadlines last in both directions", () => {
  render(<ReviewTable reviews={[
    row("unknown", null), row("newer", "2026-09-19T01:00:00Z"), row("older", "2026-09-18T01:00:00Z"),
  ]} />);
  const references = () => screen.getAllByRole("row").slice(1).map((tr) => within(tr).getByRole("button", { name: /Copy registration reference/ }).getAttribute("aria-label"));
  expect(references()).toEqual([
    "Copy registration reference older", "Copy registration reference newer", "Copy registration reference unknown",
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Hold deadline: oldest first" }));
  expect(references()).toEqual([
    "Copy registration reference newer", "Copy registration reference older", "Copy registration reference unknown",
  ]);
});

it("copies the full internal registration reference", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  render(<ReviewTable reviews={[row("registration-123", "2026-09-18T01:00:00Z")]} />);
  fireEvent.click(screen.getByRole("button", { name: "Copy registration reference registration-123" }));
  expect(writeText).toHaveBeenCalledWith("registration-123");
});
