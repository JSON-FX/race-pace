import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RegistrationRow } from "@/lib/registration";
import { PayPanel } from "../PayPanel";

// Fix round: PayPanel used to gate only on `paid` and event-closed, never on
// expires_at — a bookmarked /pay/<rid>, or a hold that lapses while this
// exact page is open (the query polls), rendered a live Pay button that
// payment-session would refuse the instant it was tapped. `status` alone
// can't tell "lapsed" apart from "still live" (it stays 'pending' until the
// 15-minute sweep runs), so this must be driven by expires_at via
// holdExpired, mirroring RacesList's CTA gating. This is the ONLY place that
// renders the lapsed-hold message — the server page (page.tsx) deliberately
// does not redirect on a lapsed hold; see its comment for why a redirect
// there would have bounced the runner to /events/<id> with no explanation.
const useRegistrationMock = vi.fn();
const createMethodCheckoutMock = vi.fn();

vi.mock("@/lib/registration", () => ({
  useRegistration: (...args: unknown[]) => useRegistrationMock(...args),
  createMethodCheckout: (...args: unknown[]) => createMethodCheckoutMock(...args),
}));

// jsdom's own window.location.assign throws "Not implemented", and this panel
// leaves the site with it — so the ONLY way to assert "the runner was, or was
// not, sent to PayMongo" is to replace it. Redefined rather than spied because
// window.location is non-configurable on the real object.
const assign = vi.fn();
Object.defineProperty(window, "location", {
  value: { assign, href: "http://localhost/", origin: "http://localhost" },
  writable: true,
});

function row(overrides: Partial<RegistrationRow> = {}): RegistrationRow {
  return {
    id: "r1", status: "pending", total_amount: 150000, ticket_token: null,
    org_id: "a1", event_id: "e1", expiresAt: null,
    eventName: "Kitanglad Skyline Ultra", categoryLabel: "18K", categoryDistance: 18,
    checkoutUrl: null, eventStatus: "open", eventDate: "2099-01-01", originalDate: null,
    statusNote: null, eventRegistrationClosesAt: null, kitEditClosesAt: null, shirtSize: null,
    orgName: "Race Pace", eventHeroUrl: null, basePrice: 150000,
    inclusions: [], feeMode: "absorb", orgIsActive: true,
    feeTerms: { commission_type: "percent", commission_rate: 0.03, commission_flat_cents: 0 },
    checkoutPlatformFee: null, checkoutProviderManagedFee: false,
    payment: null,
    ...overrides,
  };
}

function renderWithRegistration(overrides: Partial<RegistrationRow> = {}) {
  useRegistrationMock.mockReturnValue({ isLoading: false, data: row(overrides) });
  return render(<PayPanel registrationId="r1" />);
}

beforeEach(() => {
  useRegistrationMock.mockReset();
  createMethodCheckoutMock.mockReset().mockResolvedValue({ url: null, code: null });
  assign.mockReset();
});

/**
 * Final-review Finding A: payment-session's new `org_suspended` refusal was
 * routed around by this very panel. `createMethodCheckout` returns null for any
 * failure, and the fallback below it was gated ONLY on the event being closed
 * — nothing about the organization. registrations-checkout writes
 * `checkout_url` on every registration, so that fallback is ALWAYS populated:
 * a runner with a pending entry in a suspended org tapped Pay, never saw the
 * 409, and reached a live PayMongo page the webhook would then settle.
 *
 * Two guards, and both are load-bearing. The render-time one stops a Pay button
 * existing at all for an org already known to be suspended. The one inside
 * `pay()` catches a suspension that lands between render and tap — this query
 * does not poll on an interval, so `orgIsActive` can be stale by seconds or
 * minutes, and the server's own answer is the only fresh fact available then.
 */
describe("PayPanel — a suspended organizer", () => {
  it("refuses to render a Pay button, and says why, even with a stored checkout url", () => {
    useRegistrationMock.mockReturnValue({
      isLoading: false,
      data: row({
        orgIsActive: false,
        checkoutUrl: "https://checkout.paymongo.com/still/looks/valid",
      }),
    });

    render(<PayPanel registrationId="r1" />);

    expect(screen.queryByRole("button", { name: /^Pay ₱/ })).not.toBeInTheDocument();
    // The one mapped string, from lib/errors.ts — not a second copy written here.
    expect(screen.getByText(/isn't taking registrations right now/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing was charged/i)).toBeInTheDocument();
  });

  it("does not fall back to the stored session when the server refuses mid-flight", async () => {
    // Still active as far as this render knows — the suspension lands between
    // the render and the tap, which is exactly the case the render-time guard
    // cannot see.
    const user = userEvent.setup();
    useRegistrationMock.mockReturnValue({
      isLoading: false,
      data: row({
        orgIsActive: true,
        checkoutUrl: "https://checkout.paymongo.com/still/looks/valid",
      }),
    });
    createMethodCheckoutMock.mockResolvedValue({ url: null, code: "org_suspended" });

    render(<PayPanel registrationId="r1" />);
    await user.click(screen.getByRole("button", { name: /^Pay ₱/ }));

    expect(assign, "the stored all-methods session must not be opened").not.toHaveBeenCalled();
    expect(await screen.findByText(/isn't taking registrations right now/i)).toBeInTheDocument();
  });

  it("does not open a stored link when PayMongo checkout creation needs reconciliation", async () => {
    const user = userEvent.setup();
    useRegistrationMock.mockReturnValue({
      isLoading: false,
      data: row({ checkoutUrl: "https://checkout.paymongo.com/stale-link" }),
    });
    createMethodCheckoutMock.mockResolvedValue({ url: null, code: "checkout_reconciliation_required" });

    render(<PayPanel registrationId="r1" />);
    await user.click(screen.getByRole("button", { name: /^Pay ₱/ }));

    expect(assign).not.toHaveBeenCalled();
    expect(await screen.findByText(/check this payment with PayMongo/i)).toBeInTheDocument();
    expect(screen.getByText(/Your slot remains held/i)).toBeInTheDocument();
  });

  it("can still use the local fake checkout after a transport failure", async () => {
    const user = userEvent.setup();
    useRegistrationMock.mockReturnValue({
      isLoading: false,
      data: row({ checkoutUrl: "http://localhost/fake-checkout", payment: {
        createdAt: null, method: null, amount: null, platformFee: null, netToOrg: null,
        provider: "fake", providerRef: null, status: "pending",
      } }),
    });
    createMethodCheckoutMock.mockResolvedValue({ url: null, code: null });

    render(<PayPanel registrationId="r1" />);
    await user.click(screen.getByRole("button", { name: /^Pay ₱/ }));

    expect(assign).toHaveBeenCalledWith("http://localhost/fake-checkout");
  });
});

describe("PayPanel — a lapsed pending hold", () => {
  it("refuses to render a Pay button and offers Enter again pointing at the event", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    useRegistrationMock.mockReturnValue({ isLoading: false, data: row({ expiresAt: past }) });

    render(<PayPanel registrationId="r1" />);

    expect(screen.getByText("Payment window closed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Pay ₱/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Enter again" })).toHaveAttribute("href", "/events/e1");
  });

  it("still renders the normal Pay screen when the hold has time left", () => {
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    useRegistrationMock.mockReturnValue({ isLoading: false, data: row({ expiresAt: future }) });

    render(<PayPanel registrationId="r1" />);

    expect(screen.queryByText("Payment window closed")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Pay ₱/ })).toBeInTheDocument();
  });
});

// Fix round: a registration also reaches status 'expired' when the organizer
// closes/cancels/completes the event early (events_close_expires_pending),
// which can fire well within 24h while the stored checkout_url is still
// genuinely chargeable — PayMongo does not automatically expire a session.
// `eventClosed`
// (above) catches the common case since the event flips status in the same
// transaction, but not an organizer reopening the event afterward: eventStatus
// goes back to something registerable while this specific registration stays
// 'expired' forever. So `status` must gate the Pay button directly, with copy
// distinct from "Payment window closed" (that's for a runner-abandoned hold,
// not an organizer-closed one) — conflating the two would mislead the runner.
describe("PayPanel — a registration expired by the organizer", () => {
  it("refuses to render a Pay button even with a still-valid-looking checkout url, distinct from the lapsed-hold message", () => {
    useRegistrationMock.mockReturnValue({
      isLoading: false,
      data: row({
        status: "expired",
        expiresAt: null,
        eventStatus: "open", // organizer reopened the event; this entry never got resurrected
        checkoutUrl: "https://checkout.paymongo.com/still/looks/valid",
      }),
    });

    render(<PayPanel registrationId="r1" />);

    expect(screen.getByText("This entry was closed")).toBeInTheDocument();
    expect(screen.queryByText("Payment window closed")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Pay ₱/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Enter again" })).toHaveAttribute("href", "/events/e1");
  });
});

// The provider calculates the method-specific fee on its own checkout page.
// Race Pace only displays the commission frozen when the reservation was made.
describe("PayPanel — provider-managed fees", () => {
  const PASS_ON = {
    total_amount: 200000, basePrice: 200000, feeMode: "pass_on",
    checkoutPlatformFee: 6000, checkoutProviderManagedFee: true,
    payment: { provider: "paymongo" },
  } as unknown as Partial<RegistrationRow>;

  it("keeps absorb mode at the sticker price", () => {
    renderWithRegistration({ total_amount: 200000, basePrice: 200000, checkoutPlatformFee: 6000 });
    expect(screen.getByRole("button", { name: "Pay ₱2,000.00" })).toBeInTheDocument();
    expect(screen.queryByText("Taxes and fees")).not.toBeInTheDocument();
    expect(screen.getByText(/₱60.00 in Taxes and fees is included in this price/)).toBeInTheDocument();
    expect(screen.getByText(/Neither fee increases your total/)).toBeInTheDocument();
  });

  it("keeps PayMongo absorb checkout at one hosted session and never reopens a stored URL after a failed check", async () => {
    renderWithRegistration({ total_amount: 10000, basePrice: 10000,
      checkoutUrl: "https://checkout.paymongo.com/stored",
      payment: { createdAt: null, method: null, amount: 10000, platformFee: null,
        netToOrg: null, provider: "paymongo", providerRef: "cs_saved", status: "pending" },
    });
    expect(screen.getByText(/The total stays ₱100.00/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "GCash" })).not.toBeInTheDocument();
    createMethodCheckoutMock.mockResolvedValue({ url: null, code: null });
    await userEvent.setup().click(screen.getByRole("button", { name: "Pay ₱100.00" }));
    expect(assign).not.toHaveBeenCalled();
  });

  it("shows the frozen platform fee and defers exact processing to PayMongo", async () => {
    renderWithRegistration(PASS_ON);
    expect(screen.getByText("Taxes and fees")).toBeInTheDocument();
    expect(screen.getByText("+₱60.00")).toBeInTheDocument();
    expect(screen.getByText("Calculated by PayMongo")).toBeInTheDocument();
    expect(screen.getByText("Shown on PayMongo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to checkout" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Card" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Pay ₱/ })).not.toBeInTheDocument();
    createMethodCheckoutMock.mockResolvedValue({ url: "https://checkout.paymongo.com/v2", code: null });
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue to checkout" }));
    expect(assign).toHaveBeenCalledWith("https://checkout.paymongo.com/v2");
  });

  it("blocks older pass-on reservations with locally calculated sessions", () => {
    renderWithRegistration({ ...PASS_ON, checkoutProviderManagedFee: false });
    expect(screen.getByText("Checkout needs updating")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue to checkout" })).not.toBeInTheDocument();
  });

  it("never falls back to a stale provider URL after a failed server check", async () => {
    renderWithRegistration({ ...PASS_ON, checkoutUrl: "https://checkout.paymongo.com/stale" });
    createMethodCheckoutMock.mockResolvedValue({ url: null, code: "not_pending" });
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue to checkout" }));
    expect(assign).not.toHaveBeenCalled();
  });
});

// A stored checkout session is historical data, not permission to pay again.
describe("PayPanel — registration payment eligibility", () => {
  it.each(["refunded", "cancelled", "unknown"])("hides checkout for %s bookmarks", (status) => {
    renderWithRegistration({ status, checkoutUrl: "https://checkout.paymongo.com/stored" });
    expect(screen.queryByRole("button", { name: /^Pay/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to My Races" })).toHaveAttribute("href", "/races");
    expect(createMethodCheckoutMock).not.toHaveBeenCalled();
  });

  it("sends paid registrations to their ticket even if the event later closes", () => {
    renderWithRegistration({ status: "paid", eventStatus: "closed", checkoutUrl: "https://checkout.paymongo.com/stored" });
    expect(screen.queryByRole("button", { name: /^Pay/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View ticket" })).toHaveAttribute("href", "/ticket/r1");
  });

  it.each(["not_pending", "hold_expired", "event_closed", "unknown_refusal"])("never routes around server refusal %s", async (code) => {
    renderWithRegistration({ checkoutUrl: "https://checkout.paymongo.com/stored" });
    createMethodCheckoutMock.mockResolvedValue({ url: null, code });
    await userEvent.setup().click(screen.getByRole("button", { name: /^Pay ₱/ }));
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Pay ₱/ })).not.toBeDisabled();
    if (code === "not_pending") {
      expect(screen.getByText("This registration can no longer be paid. Check My Races for its status.")).toBeInTheDocument();
    }
  });
});
