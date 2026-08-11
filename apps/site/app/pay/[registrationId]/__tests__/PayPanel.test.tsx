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
    statusNote: null, orgName: "Race Pace", eventHeroUrl: null, basePrice: 150000,
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
