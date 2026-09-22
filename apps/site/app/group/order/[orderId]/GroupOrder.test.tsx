import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { GroupOrder } from "./GroupOrder";

const rows = {
  booking_orders: { data: { status: "paid" }, error: null },
  booking_payment_attempts: { data: [{ id: "attempt-1", status: "paid", base_cents: 20000, platform_fee_cents: 600, gross_cents: 20000 }], error: null },
  registrations: { data: [
    { id: "registration-1", status: "paid", total_amount: 10000, custom_data: { full_name: "Ava Runner" } },
    { id: "registration-2", status: "paid", total_amount: 10000, custom_data: { full_name: "Lola Runner" } },
  ], error: null },
};
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: (name: keyof typeof rows) => ({
  select: () => ({
    eq: () => ({
      single: async () => rows[name],
      order: () => Object.assign(Promise.resolve(rows[name]), { limit: async () => rows[name] }),
    }),
  }),
}) }) }));
vi.mock("@/lib/groupCheckout", () => ({
  prepareGroupPayment: vi.fn(), startGroupPayment: vi.fn(), verifyGroupPayment: vi.fn(),
  GroupCheckoutError: class GroupCheckoutError extends Error { code = "error"; },
}));

beforeEach(() => {
  rows.booking_orders.data.status = "paid";
  rows.booking_payment_attempts.data[0].status = "paid";
});

describe("GroupOrder", () => {
  it("shows one named QR ticket per paid participant without another payment button", async () => {
    render(<GroupOrder orderId="order-1" initialStatus="paid" entryTotal={20000} eventName="QA Race" categoryLabel="14K" participantCount={2} feeMode="absorb" expiresAt={null} />);
    expect(await screen.findByText("Ava Runner")).toBeInTheDocument();
    expect(screen.getByText("Lola Runner")).toBeInTheDocument();
    expect(screen.getByText(/one payment secured 2 individual tickets/i)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "View QR ticket" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Continue to PayMongo" })).not.toBeInTheDocument();
  });

  it("blocks a second checkout while provider creation is uncertain", async () => {
    rows.booking_orders.data.status = "pending";
    rows.booking_payment_attempts.data[0].status = "creation_unknown";
    render(<GroupOrder orderId="order-1" initialStatus="pending" entryTotal={20000} eventName="QA Race" categoryLabel="14K" participantCount={2} feeMode="absorb" expiresAt={new Date(Date.now() + 60000).toISOString()} />);
    expect(await screen.findByText(/This payment needs review/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue to PayMongo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review another payment attempt" })).not.toBeInTheDocument();
  });
});
