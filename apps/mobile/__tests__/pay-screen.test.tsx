import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";

const mockReplace = jest.fn();
const mockOpenAuth = jest.fn().mockResolvedValue({ type: "dismiss" });
const mockVerify = jest.fn().mockResolvedValue({ status: "pending" });
// { url, code } since the final-review fix — `code` is what tells "the server
// declined" apart from "the call did not land", and only the second may fall
// back to the session stored at registration. Null/null here is the
// transport-failure shape, so the default still exercises the fallback.
const mockCreateMethodCheckout = jest.fn().mockResolvedValue({ url: null, code: null });
jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: (...a: unknown[]) => mockOpenAuth(...a) }));
jest.mock("expo-linking", () => ({ createURL: (p: string) => `racepace://${p}` }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../lib/ticketCache", () => ({ cacheTicket: jest.fn() }));

let mockRegData: any = {
  id: "r1", status: "pending", total_amount: 210000, ticket_token: null, org_id: "o1",
  event_id: "ev1", expiresAt: null,
  eventName: "Apo Sky Ultra 2026", categoryLabel: "21K", checkoutUrl: "http://x/functions/v1/fake-checkout?rid=r1",
};
jest.mock("../lib/registration", () => ({ useRegistration: () => ({ data: mockRegData, refetch: jest.fn() }), verifyPayment: (...a: unknown[]) => mockVerify(...a), createMethodCheckout: (...a: unknown[]) => mockCreateMethodCheckout(...a) }));
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ registrationId: "r1" }),
  useRouter: () => ({ replace: mockReplace, back: jest.fn() }),
}));

import Pay from "../app/pay/[registrationId]";

describe("Pay screen", () => {
  it("opens the sandbox checkout with the return url appended, without trusting the result", async () => {
    render(<Pay />);
    fireEvent.press(screen.getByText(/^Pay /)); // "Pay ₱2,100.00"
    await waitFor(() => expect(mockOpenAuth).toHaveBeenCalled());
    const [full, redirect] = mockOpenAuth.mock.calls[0];
    expect(full).toContain("http://x/functions/v1/fake-checkout?rid=r1");
    expect(full).toContain("return=");
    expect(redirect).toBe("racepace://pay-callback");
    await waitFor(() => expect(mockVerify).toHaveBeenCalledWith("r1"));
    expect(screen.getByText("Waiting for confirmation…")).toBeOnTheScreen();
  });

  it("shows Confirmed + View ticket when the registration is paid", () => {
    mockRegData = { ...mockRegData, status: "paid", ticket_token: "a.b" };
    render(<Pay />);
    expect(screen.getByText("Payment confirmed")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("View ticket"));
    expect(mockReplace).toHaveBeenCalledWith("/ticket/r1");
  });

  // Fix round: this screen used to gate only on `paid` and event-closed, never
  // on expires_at — a bookmarked /pay/<rid> for a lapsed hold rendered a live
  // Pay button that payment-session would refuse the instant it was tapped.
  // `status` alone can't tell "lapsed" from "still live" (it stays 'pending'
  // until the 15-minute sweep runs), so this must be driven by expiresAt.
  describe("a lapsed pending hold", () => {
    it("refuses to render a Pay button and offers Enter again instead", () => {
      mockRegData = {
        ...mockRegData, status: "pending", event_id: "ev1",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      };
      render(<Pay />);
      expect(screen.getByText("Payment window closed")).toBeOnTheScreen();
      expect(screen.queryByText(/^Pay /)).toBeNull();
      fireEvent.press(screen.getByText("Enter again"));
      expect(mockReplace).toHaveBeenCalledWith("/event/ev1");
    });

    it("still renders the normal Pay screen when the hold has time left", () => {
      mockRegData = {
        ...mockRegData, status: "pending", event_id: "ev1",
        expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      };
      render(<Pay />);
      expect(screen.queryByText("Payment window closed")).toBeNull();
      expect(screen.getByText(/^Pay /)).toBeOnTheScreen();
    });
  });

  // Fix round: this screen had NO event-closed guard at all — unlike
  // apps/site's PayPanel.tsx, which already checks eventStatus. The organizer
  // can close/cancel/complete the event while this screen is open (the query
  // polls), and `url` can hold a PayMongo session created while the event was
  // still open and chargeable.
  describe("an event closed by the organizer", () => {
    it("refuses to render a Pay button and offers Back to My Races", () => {
      mockRegData = {
        ...mockRegData, status: "pending", event_id: "ev1",
        expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), // hold still live
        eventStatus: "cancelled",
      };
      render(<Pay />);
      expect(screen.getByText("This race is no longer accepting entries")).toBeOnTheScreen();
      expect(screen.queryByText(/^Pay /)).toBeNull();
      fireEvent.press(screen.getByText("Back to My Races"));
      expect(mockReplace).toHaveBeenCalledWith("/(tabs)/races");
    });
  });

  // Fix round: a registration also reaches status 'expired' when the
  // organizer closes/cancels/completes the event early
  // (events_close_expires_pending), which can fire well within 24h while the
  // stored checkout url is still genuinely chargeable — unlike the
  // lapsed-hold case, where the PayMongo session itself has gone stale by the
  // time 24h has passed. The eventClosed guard above catches the common case
  // since the event flips status in the same transaction, but not an
  // organizer reopening the event afterward: eventStatus goes back to
  // something registerable while this specific registration stays 'expired'
  // forever. So `status` must gate the Pay button directly, with copy
  // distinct from "Payment window closed" (a runner-abandoned hold is a
  // different fact from an organizer-closed one).
  describe("a registration expired by the organizer", () => {
    it("refuses to render a Pay button even with a still-valid-looking checkout url, distinct from the lapsed-hold message", () => {
      mockRegData = {
        ...mockRegData, status: "expired", event_id: "ev1",
        expiresAt: null,
        eventStatus: "open", // organizer reopened the event; this entry never got resurrected
        checkoutUrl: "http://x/functions/v1/fake-checkout?rid=r1", // still looks valid
      };
      render(<Pay />);
      expect(screen.getByText("This entry was closed")).toBeOnTheScreen();
      expect(screen.queryByText("Payment window closed")).toBeNull();
      expect(screen.queryByText(/^Pay /)).toBeNull();
      fireEvent.press(screen.getByText("Enter again"));
      expect(mockReplace).toHaveBeenCalledWith("/event/ev1");
    });
  });

  // Final-review Finding A, the mobile half. payment-session refuses to mint a
  // scoped session for a suspended org, and this screen routed around it:
  // `payUrl = scoped ?? url`, where `url` is the route's checkoutUrl param or
  // the session stored at registration — neither of which knows anything about
  // the organization. registrations-checkout writes checkout_url on every
  // registration, so that fallback is never empty.
  describe("a suspended organizer", () => {
    it("refuses to render a Pay button and says why", () => {
      mockRegData = {
        ...mockRegData, status: "pending", event_id: "ev1",
        expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        eventStatus: "open",
        orgIsActive: false,
        checkoutUrl: "http://x/functions/v1/fake-checkout?rid=r1", // still looks valid
      };
      render(<Pay />);
      expect(screen.queryByText(/^Pay /)).toBeNull();
      expect(screen.getByText(/isn't taking registrations right now/)).toBeOnTheScreen();
    });

    it("does not open the stored session when the server refuses mid-flight", async () => {
      // Still active as far as this render knows — the suspension lands between
      // the render and the tap, which the render-time guard cannot see.
      mockRegData = {
        ...mockRegData, status: "pending", event_id: "ev1",
        expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
        eventStatus: "open",
        orgIsActive: true,
        checkoutUrl: "http://x/functions/v1/fake-checkout?rid=r1",
      };
      mockOpenAuth.mockClear();
      mockCreateMethodCheckout.mockResolvedValueOnce({ url: null, code: "org_suspended" });

      render(<Pay />);
      fireEvent.press(screen.getByText(/^Pay /));

      await waitFor(() =>
        expect(screen.getByText(/isn't taking registrations right now/)).toBeOnTheScreen());
      expect(mockOpenAuth).not.toHaveBeenCalled();
    });
  });
});
