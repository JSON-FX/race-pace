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
const useProcessorRateMock = vi.fn();
const createMethodCheckoutMock = vi.fn();

vi.mock("@/lib/registration", () => ({
  useRegistration: (...args: unknown[]) => useRegistrationMock(...args),
  useProcessorRate: (...args: unknown[]) => useProcessorRateMock(...args),
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

/** The seeded rate card, VAT-inclusive, keyed by the SITE's method key — the
 *  translation to PayMongo's own names lives in RATE_METHOD and is tested there.
 *  Same figures as supabase/migrations/20260811091000_processor_rates.sql. */
const RATES: Record<string, { percent_bps: number; fixed_cents: number }> = {
  card: { percent_bps: 350, fixed_cents: 1500 },
  gcash: { percent_bps: 150, fixed_cents: 0 },
  maya: { percent_bps: 150, fixed_cents: 0 },
};

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
    payment: null,
    ...overrides,
  };
}

/** Renders the panel with `useRegistration` returning `row(overrides)` and the
 *  rate card answering from RATES for whichever method is selected — i.e. the
 *  rate MOVES with the method, which is the whole point of the breakdown. */
function renderWithRegistration(overrides: Partial<RegistrationRow> = {}) {
  useRegistrationMock.mockReturnValue({ isLoading: false, data: row(overrides) });
  return render(<PayPanel registrationId="r1" />);
}

beforeEach(() => {
  useRegistrationMock.mockReset();
  useProcessorRateMock.mockReset();
  useProcessorRateMock.mockImplementation((method: string) => ({ data: RATES[method] ?? null }));
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

  it("still falls back to the stored session when the scoped call merely fails", async () => {
    // The fallback exists for a transport failure and must survive this fix —
    // narrowing it to nothing would strand every runner whose scoped call
    // timed out.
    const user = userEvent.setup();
    useRegistrationMock.mockReturnValue({
      isLoading: false,
      data: row({ checkoutUrl: "https://checkout.paymongo.com/stored" }),
    });
    createMethodCheckoutMock.mockResolvedValue({ url: null, code: null });

    render(<PayPanel registrationId="r1" />);
    await user.click(screen.getByRole("button", { name: /^Pay ₱/ }));

    expect(assign).toHaveBeenCalledWith("https://checkout.paymongo.com/stored");
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
// genuinely chargeable — unlike the lapsed-hold case, where the PayMongo
// session itself has gone stale by the time 24h has passed. `eventClosed`
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

// An org is on `absorb` or `pass_on`. In absorb the runner pays the sticker
// price and the processing cost comes out of the organizer's share — showing
// them a fee they are not paying would be noise about somebody else's money. In
// pass_on the runner is charged a grossed-up total, so every line has to be
// visible, because every line changes what they pay.
//
// The lines are computed HERE, in the client, off the method already in state.
// Passing them down from the server page would freeze the processing line at
// whatever method was current when the page rendered, and the one thing this
// breakdown must do is move when the runner switches method.
//
// DISPLAY ONLY. payment-session recomputes the authoritative charge server-side.
describe("PayPanel — the fee breakdown", () => {
  const PASS_ON = { total_amount: 200000, basePrice: 200000, feeMode: "pass_on" } as const;

  it("shows only the total in absorb mode — the runner pays no fees", () => {
    renderWithRegistration({ total_amount: 200000, basePrice: 200000, feeMode: "absorb" });

    expect(screen.getByRole("button", { name: "Pay ₱2,000.00" })).toBeInTheDocument();
    expect(screen.queryByText(/service fee/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/payment processing/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Total to pay")).not.toBeInTheDocument();
    // The panel absorb mode already had, unchanged: entry fee, and a booking
    // fee that really is free to this runner.
    expect(screen.getByText("Free")).toBeInTheDocument();
  });

  it("does not even ask the rate card in absorb mode", () => {
    renderWithRegistration({ total_amount: 200000, basePrice: 200000, feeMode: "absorb" });
    expect(useProcessorRateMock).toHaveBeenCalledWith("gcash", { enabled: false });
  });

  it("itemises every line in pass-on mode, because each one changes the total", () => {
    renderWithRegistration(PASS_ON);

    // ₱2,000 base, RP 3% = ₱60, GCash 1.5% grossed up = ₱31.38. Each fee line
    // is rendered with a leading "+", like the add-ons line it sits under:
    // these are amounts ADDED to the entry fee, not a restatement of it.
    expect(screen.getByText(/Race Pace service fee/i)).toBeInTheDocument();
    expect(screen.getByText("+₱60.00")).toBeInTheDocument();
    expect(screen.getByText(/Payment processing/i)).toBeInTheDocument();
    expect(screen.getByText("+₱31.38")).toBeInTheDocument();
    expect(screen.getByText("Total to pay")).toBeInTheDocument();
    // The entry fee the organizer priced is still stated, unsurcharged.
    expect(screen.getByText("₱2,000.00")).toBeInTheDocument();
    // Twice: the ticket stub's "Total due" and the breakdown's own total. Both
    // must be the grossed-up figure — a stub still reading ₱2,000.00 over an
    // itemised ₱2,091.38 is the exact confusion this screen exists to remove.
    expect(screen.getAllByText("₱2,091.38")).toHaveLength(2);
    // And the number on the button is the number that will be charged. GCash is
    // the default method.
    expect(screen.getByRole("button", { name: "Pay ₱2,091.38" })).toBeInTheDocument();
  });

  it("updates the processing line when the runner switches to card", async () => {
    const user = userEvent.setup();
    renderWithRegistration(PASS_ON);

    await user.click(screen.getByRole("button", { name: "Card" }));

    // Card is 3.5% + ₱15, so the processing line and the total both move.
    expect(screen.getByText("+₱90.26")).toBeInTheDocument();
    expect(screen.getAllByText("₱2,150.26")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Pay ₱2,150.26" })).toBeInTheDocument();
    // The commission is struck on the BASE the organizer priced, not on the
    // grossed-up total, so it does NOT move with the method. Striking it on the
    // total would compound the two fees against each other.
    expect(screen.getByText("+₱60.00")).toBeInTheDocument();
    expect(screen.getByText("₱2,000.00")).toBeInTheDocument();
    expect(screen.queryByText("+₱31.38")).not.toBeInTheDocument();
  });

  // THE REASON THE PANEL CARRIES ALL THREE COMMISSION COLUMNS. With only
  // fee_mode, a fixed-terms org would fall down feeOn's percent branch and its
  // 10% default: ₱200.00 of "service fee" on a ₱2,000 entry whose real terms are
  // ₱75 flat — a surcharge the runner would actually be shown and asked to pay.
  it("quotes a fixed-commission org its flat fee, not the percent default", () => {
    renderWithRegistration({
      ...PASS_ON,
      feeTerms: { commission_type: "fixed", commission_rate: null, commission_flat_cents: 7500 },
    });

    expect(screen.getByText("+₱75.00")).toBeInTheDocument();
    // What the percent branch's 10% default would have quoted on a ₱2,000 entry.
    expect(screen.queryByText("+₱200.00")).not.toBeInTheDocument();
    expect(screen.getAllByText("₱2,106.60")).toHaveLength(2);
  });

  // THE DEGRADED PATH, WHICH IS NOT AN EXOTIC ONE. The rate query is gated on
  // feeMode, so it cannot start until the registration resolves: every pass-on
  // page load renders once with no rate, as does every first switch to a method
  // whose rate is not cached, and a failed read stays this way. Quoting the
  // sticker price here would put a number nobody will be charged on a live Pay
  // button — the very deception this screen exists to remove — and it would not
  // even be self-correcting, because this screen filters the rate card on
  // `offered` while the server's processor_rate_at does not.
  //
  // So: no amount anywhere, and an explicit "Shown at checkout". The button
  // stays enabled — payment-session may well be able to price the charge, and
  // PayMongo's hosted page itemises the total before the runner confirms.
  it("prints no amount at all while the rate card has not answered", () => {
    useProcessorRateMock.mockReturnValue({ data: undefined });
    renderWithRegistration(PASS_ON);

    expect(screen.queryByText(/Payment processing/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Race Pace service fee/i)).not.toBeInTheDocument();
    // The sticker price must NOT appear as a total: not on the button, and not
    // on the ticket stub, which shows a dash instead.
    expect(screen.queryByRole("button", { name: /^Pay ₱/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pay" })).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("Shown at checkout")).toBeInTheDocument();
    // The entry fee is still known and still stated — it is the TOTAL that is
    // not. Exactly once: the stub is showing a dash, not this figure.
    expect(screen.getAllByText("₱2,000.00")).toHaveLength(1);
    // And no "Booking fee — Free" either: this runner IS being charged fees,
    // so the absorb-mode row would be a claim that is about to be contradicted.
    expect(screen.queryByText("Free")).not.toBeInTheDocument();
  });

  it("prints no amount between methods either, when the new rate is not cached", async () => {
    const user = userEvent.setup();
    // GCash priced, card not yet — the state a first switch to card passes
    // through before its query resolves.
    useProcessorRateMock.mockImplementation((m: string) => ({ data: m === "gcash" ? RATES.gcash : undefined }));
    renderWithRegistration(PASS_ON);
    expect(screen.getByRole("button", { name: "Pay ₱2,091.38" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Card" }));

    // NOT ₱2,000.00 flashing between ₱2,091.38 and ₱2,150.26 — a fast tapper
    // could press that.
    expect(screen.getByRole("button", { name: "Pay" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Pay ₱/ })).not.toBeInTheDocument();
  });

  // A pass-on org whose entry is free has nothing to gross up: a ₱0 charge costs
  // the processor nothing, so every line is zero and the panel must not print a
  // ₱15 card fixed fee against a ₱0 entry. Nor a "Total to pay ₱0.00" under an
  // "Entry fee ₱0.00" — the same number twice — nor the paragraph explaining
  // fees that this runner is not being charged.
  it("adds nothing to a free entry, and explains nothing either", () => {
    renderWithRegistration({ total_amount: 0, basePrice: 0, feeMode: "pass_on" });

    expect(screen.getByRole("button", { name: "Pay ₱0.00" })).toBeInTheDocument();
    expect(screen.queryByText(/Payment processing/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Total to pay")).not.toBeInTheDocument();
    expect(screen.queryByText(/passes the service and payment-processing costs/i)).not.toBeInTheDocument();
  });
});
