import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RegistrationRow } from "@/lib/registration";
import { RacesList, holdRemaining } from "../RacesList";

describe("holdRemaining", () => {
  it("returns null when there is no expiry (paid, or no hold)", () => {
    expect(holdRemaining("paid", null)).toBeNull();
  });

  it("returns null once the hold has lapsed — never shows a countdown the server already killed", () => {
    // The list's own fetch doesn't re-apply the lazy-expiry check the way
    // lib/entry.ts does, so a pending row can still be in the data moments
    // before the 15-minute sweep catches it. The countdown must not claim a
    // live hold in that window.
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(holdRemaining("pending", past)).toBeNull();
  });

  it("reports whole hours, not urgent, for anything an hour or more out", () => {
    const in23h = new Date(Date.now() + 23 * 3_600_000 + 5 * 60_000).toISOString();
    expect(holdRemaining("pending", in23h)).toEqual({ label: "23h left to pay", urgent: false });
  });

  it("floors to the hour rather than rounding up", () => {
    // 1h59m left must read "1h", not "2h" — rounding up would overstate the
    // hold and round down to the wrong bucket right at the urgent threshold.
    const in1h59 = new Date(Date.now() + 1 * 3_600_000 + 59 * 60_000).toISOString();
    expect(holdRemaining("pending", in1h59)).toEqual({ label: "1h left to pay", urgent: false });
  });

  it("switches to minutes and marks urgent once under an hour", () => {
    const in45m = new Date(Date.now() + 45 * 60_000).toISOString();
    expect(holdRemaining("pending", in45m)).toEqual({ label: "45m left to pay", urgent: true });
  });

  it("never reports 0m for a hold that has not actually lapsed", () => {
    // A hold with e.g. 20 seconds left rounds to 0m by plain arithmetic;
    // clamping to a minimum of 1m keeps the copy ("0m left to pay") from
    // reading as already-expired when it technically is not yet.
    const in20s = new Date(Date.now() + 20_000).toISOString();
    expect(holdRemaining("pending", in20s)).toEqual({ label: "1m left to pay", urgent: true });
  });

  it("ignores a stale expires_at on a non-pending row instead of reporting a bogus countdown", () => {
    // expiresAt is documented as meaningful only while status is "pending".
    // holdExpired() only fires for "pending" rows, so without its own ms<=0
    // guard this would compute a negative duration into "1m left to pay" for
    // a paid row carrying a leftover expires_at from before capture.
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(holdRemaining("paid", past)).toBeNull();
  });
});

// --- RacesList component: lapsed-hold CTA gating, and the discard dialog ---

const cancelRegistrationMock = vi.fn();
const useMyRegistrationsMock = vi.fn();

vi.mock("@/lib/registration", () => ({
  useMyRegistrations: () => useMyRegistrationsMock(),
  cancelRegistration: (...args: unknown[]) => cancelRegistrationMock(...args),
}));

function reg(overrides: Partial<RegistrationRow> = {}): RegistrationRow {
  return {
    id: "r1", status: "pending", total_amount: 150000, ticket_token: null,
    org_id: "a1", event_id: "e1", expiresAt: null,
    eventName: "Kitanglad Skyline Ultra", categoryLabel: "18K", categoryDistance: 18,
    checkoutUrl: null, eventStatus: "open", eventDate: "2099-01-01", originalDate: null,
    statusNote: null, eventRegistrationClosesAt: null, kitEditClosesAt: null, shirtSize: null,
    orgName: "Race Pace", eventHeroUrl: null, basePrice: 150000,
    inclusions: [], feeMode: "absorb",
    feeTerms: { commission_type: "percent", commission_rate: 0.03, commission_flat_cents: 0 },
    payment: null,
    ...overrides,
  };
}

function renderList() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <RacesList />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cancelRegistrationMock.mockReset();
  useMyRegistrationsMock.mockReset();
});

describe("RacesList — a pending row whose hold has lapsed", () => {
  it("does not offer Complete payment, and points at re-entering instead", () => {
    // The row is still literally status: "pending" — the sweep hasn't run
    // yet — so this pins that the CTA is derived from expires_at, not status.
    const past = new Date(Date.now() - 2 * 60_000).toISOString();
    useMyRegistrationsMock.mockReturnValue({
      data: [reg({ id: "lapsed1", expiresAt: past })],
      isLoading: false,
    });
    renderList();

    expect(screen.queryByRole("link", { name: "Complete payment" })).not.toBeInTheDocument();
    expect(screen.getByText(/Payment window closed/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Enter again" })).toHaveAttribute("href", "/events/e1");
    // No hold badge either — same "server already considers it gone" rule.
    expect(screen.queryByText(/left to pay/)).not.toBeInTheDocument();
    // Discard is still offered — the row is still a real, deletable pending
    // row until the sweep catches it.
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("still offers Complete payment for a pending row whose hold has not lapsed", () => {
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    useMyRegistrationsMock.mockReturnValue({
      data: [reg({ id: "live1", expiresAt: future })],
      isLoading: false,
    });
    renderList();

    expect(screen.getByRole("link", { name: "Complete payment" })).toHaveAttribute("href", "/pay/live1");
    expect(screen.queryByText(/Payment window closed/)).not.toBeInTheDocument();
  });
});

describe("RacesList — discard confirmation dialog", () => {
  it("does not delete on a bare click — Discard only opens the dialog", async () => {
    useMyRegistrationsMock.mockReturnValue({
      data: [reg({ id: "r1", expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() })],
      isLoading: false,
    });
    renderList();

    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(cancelRegistrationMock).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("Keep entry closes the dialog without deleting anything", async () => {
    useMyRegistrationsMock.mockReturnValue({
      data: [reg({ id: "r1", expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() })],
      isLoading: false,
    });
    renderList();

    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Keep entry" }));

    expect(cancelRegistrationMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard" })).toBeInTheDocument();
  });

  it("confirming discards and closes the dialog on success", async () => {
    cancelRegistrationMock.mockResolvedValue(undefined);
    useMyRegistrationsMock.mockReturnValue({
      data: [reg({ id: "r1", expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() })],
      isLoading: false,
    });
    renderList();

    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Yes, discard entry" }));

    expect(cancelRegistrationMock).toHaveBeenCalledWith("r1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the dialog open and shows the error there when the discard fails", async () => {
    // cancelRegistration throws "not_cancellable" when RLS refuses a
    // zero-row delete — e.g. the row stopped being cancellable between
    // render and click. Closing the dialog here would look exactly like a
    // success that silently didn't happen.
    cancelRegistrationMock.mockRejectedValue(new Error("not_cancellable"));
    useMyRegistrationsMock.mockReturnValue({
      data: [reg({ id: "r1", expiresAt: new Date(Date.now() + 60 * 60_000).toISOString() })],
      isLoading: false,
    });
    renderList();

    await userEvent.click(screen.getByRole("button", { name: "Discard" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Yes, discard entry" }));

    expect(cancelRegistrationMock).toHaveBeenCalledWith("r1");
    // Still open, error inside it, not a page-top banner.
    const stillOpenDialog = await screen.findByRole("dialog");
    expect(within(stillOpenDialog).getByRole("alert")).toHaveTextContent(/can no longer be discarded/);
    // The row itself is untouched — still there, still offering to be discarded.
    expect(within(stillOpenDialog).getByRole("button", { name: "Yes, discard entry" })).toBeInTheDocument();
  });
});
