import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

vi.mock("@/lib/registration", () => ({
  useRegistration: (...args: unknown[]) => useRegistrationMock(...args),
  createMethodCheckout: vi.fn(),
}));

function row(overrides: Partial<RegistrationRow> = {}): RegistrationRow {
  return {
    id: "r1", status: "pending", total_amount: 150000, ticket_token: null,
    org_id: "a1", event_id: "e1", expiresAt: null,
    eventName: "Kitanglad Skyline Ultra", categoryLabel: "18K", categoryDistance: 18,
    checkoutUrl: null, eventStatus: "open", eventDate: "2099-01-01", originalDate: null,
    statusNote: null, eventRegistrationClosesAt: null, kitEditClosesAt: null, shirtSize: null,
    orgName: "Race Pace", eventHeroUrl: null, basePrice: 150000,
    inclusions: [], payment: null,
    ...overrides,
  };
}

beforeEach(() => {
  useRegistrationMock.mockReset();
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
