import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PaymentsPage from "./page";

const { listOrgPayments, getMyRoles } = vi.hoisted(() => ({
  listOrgPayments: vi.fn(() => {
    throw new Error("must not be called");
  }),
  getMyRoles: vi.fn(),
}));

vi.mock("@/lib/queries/payments", () => ({ listOrgPayments }));

vi.mock("@/lib/queries/roles", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queries/roles")>("@/lib/queries/roles");
  return { ...actual, getMyRoles };
});

describe("PaymentsPage", () => {
  it("renders NoOrgScope and never queries payments when the caller has no org", async () => {
    // A bare super_admin: isAdmin true (clears the (admin) layout guard) but
    // orgId null — there's no organization to scope a payments query to.
    // Querying with a null org id 500s rather than returning an empty list,
    // so the page must branch before calling any query at all.
    getMyRoles.mockResolvedValue({ role: "super_admin", orgId: null, isSuperAdmin: true, isAdmin: true, isOrgAdmin: true });

    const ui = await PaymentsPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByText("No organization on this account")).toBeInTheDocument();
    expect(listOrgPayments).not.toHaveBeenCalled();
  });
});
