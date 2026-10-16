import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GroupOrder } from "./GroupOrder";

const push = vi.fn();
const refresh = vi.fn();
const progressRpc = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const rows: Record<string, { data: unknown; error: null }> = {
  booking_orders: { data: { status: "paid" }, error: null },
  booking_payment_attempts: { data: [{ id: "attempt-1", status: "paid", base_cents: 20000, platform_fee_cents: 600, gross_cents: 20000 }], error: null },
  registrations: { data: [
    { id: "registration-1", status: "paid", total_amount: 10000, custom_data: { full_name: "Ava Runner" } },
    { id: "registration-2", status: "paid", total_amount: 10000, custom_data: { full_name: "Lola Runner" } },
  ], error: null },
};
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: progressRpc, from: (name: keyof typeof rows) => ({
  select: () => ({
    eq: () => ({
      single: async () => rows[name],
      order: () => Object.assign(Promise.resolve(rows[name]), { limit: async () => rows[name] }),
    }),
  }),
}) }) }));
vi.mock("@/lib/groupCheckout", () => ({
  prepareGroupPayment: vi.fn(), startGroupPayment: vi.fn(), verifyGroupPayment: vi.fn(), cancelGroupOrder: vi.fn(async () => ({ order_id: "order-1", status: "cancelled" })),
  GroupCheckoutError: class GroupCheckoutError extends Error { code = "error"; },
}));

const props = { orderId: "order-1", initialStatus: "paid", entryTotal: 20000, eventName: "QA Race", categoryLabel: "14K", categoryCount: 1, participantCount: 2, feeMode: "absorb" as const, expiresAt: null, rosterHref: "/register/category-1/group" };

beforeEach(() => {
  rows.booking_orders.data = { status: "paid" };
  rows.booking_payment_attempts.data = [{ id: "attempt-1", status: "paid", base_cents: 20000, platform_fee_cents: 600, gross_cents: 20000 }];
  push.mockReset(); refresh.mockReset();
  progressRpc.mockReset().mockResolvedValue({ data: [], error: null });
});

describe("GroupOrder", () => {
  it("shows one named QR ticket per paid participant without another payment button", async () => {
    render(<GroupOrder {...props} />);
    expect(await screen.findByText("Ava Runner")).toBeInTheDocument();
    expect(screen.getByText("Lola Runner")).toBeInTheDocument();
    expect(screen.getByText(/one payment secured 2 individual tickets/i)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "View QR ticket" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Continue to PayMongo" })).not.toBeInTheDocument();
  });

  it("blocks a second checkout while provider creation is uncertain", async () => {
    rows.booking_orders.data = { status: "pending" };
    rows.booking_payment_attempts.data = [{ id: "attempt-1", status: "creation_unknown", method: "gcash", base_cents: 20000, platform_fee_cents: 600, gross_cents: 20000 }];
    render(<GroupOrder {...props} initialStatus="pending" expiresAt={new Date(Date.now() + 60000).toISOString()} />);
    expect(await screen.findByText(/This payment needs review/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue to PayMongo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review another payment attempt" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change participants" })).not.toBeInTheDocument();
  });

  it("cancels a safe unpaid booking and returns to the Trail Roster", async () => {
    const { cancelGroupOrder } = await import("@/lib/groupCheckout");
    rows.booking_orders.data = { status: "pending" };
    rows.booking_payment_attempts.data = [];
    render(<GroupOrder {...props} initialStatus="pending" categoryCount={2} categoryLabel="14K · Backyard Ultra" expiresAt={new Date(Date.now() + 60000).toISOString()} />);

    expect(await screen.findByText("2 categories")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Change participants" }));
    expect(screen.getByRole("alertdialog", { name: "Cancel this group booking?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel and edit roster" }));

    await waitFor(() => expect(cancelGroupOrder).toHaveBeenCalledWith("order-1"));
    expect(push).toHaveBeenCalledWith("/register/category-1/group");
    expect(refresh).toHaveBeenCalled();
  });
  it.each(["processing", "review_required"])("keeps a %s receipt from opening another payment or releasing participants", async state => {
    rows.booking_orders.data = { status: "pending" };
    rows.booking_payment_attempts.data = [{ id: "attempt-1", status: "prepared", method: "gcash", gross_cents: 20000 }];
    progressRpc.mockResolvedValue({ data: [{ state }], error: null });
    render(<GroupOrder {...props} initialStatus="pending" expiresAt={new Date(Date.now() + 60000).toISOString()} />);
    expect(await screen.findByText(state === "processing" ? /Payment received. Registration processing/ : /This payment needs review/)).toBeInTheDocument();
    expect(progressRpc).toHaveBeenCalledWith("booking_payment_progress", { p_orders: ["order-1"] });
    expect(screen.queryByRole("button", { name: "Continue to PayMongo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change participants" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /discount/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View QR ticket" })).not.toBeInTheDocument();
  });

  it("never offers pay or cancel before the receipt check completes, or when that check fails", async () => {
    rows.booking_orders.data = { status: "pending" };
    rows.booking_payment_attempts.data = [];
    let resolveProgress!: (result: { data: null; error: { message: string } }) => void;
    progressRpc.mockReturnValue(new Promise(resolve => { resolveProgress = resolve; }));
    render(<GroupOrder {...props} initialStatus="pending" expiresAt={new Date(Date.now() + 60000).toISOString()} />);
    expect(screen.queryByRole("button", { name: "Review one payment" })).not.toBeInTheDocument();
    await act(async () => resolveProgress({ data: null, error: { message: "database unavailable" } }));
    expect(screen.getByText(/Payment status is temporarily unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review one payment" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change participants" })).not.toBeInTheDocument();
  });

  it("closes checkout controls if a later receipt poll fails", async () => {
    vi.useFakeTimers();
    try {
      rows.booking_orders.data = { status: "pending" };
      rows.booking_payment_attempts.data = [{ id: "attempt-1", status: "prepared", method: "gcash", gross_cents: 20000 }];
      render(<GroupOrder {...props} initialStatus="pending" expiresAt={new Date(Date.now() + 60000).toISOString()} />);
      await act(async () => {});
      expect(screen.getByRole("button", { name: "Continue to PayMongo" })).toBeInTheDocument();
      progressRpc.mockResolvedValue({ data: null, error: { message: "database unavailable" } });
      await act(async () => vi.advanceTimersByTimeAsync(3000));
      expect(screen.getByText(/Payment status is temporarily unavailable/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Continue to PayMongo" })).not.toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });

  it("keeps confirmed tickets visible while warning about a further capture needing review", async () => {
    progressRpc.mockResolvedValue({ data: [{ state: "review_required" }], error: null });
    render(<GroupOrder {...props} />);
    expect(await screen.findByText(/A payment for this booking needs review/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "View QR ticket" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Continue to PayMongo" })).not.toBeInTheDocument();
  });

});
