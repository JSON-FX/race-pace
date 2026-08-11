import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";

const mockReplace = jest.fn();
const mockOpenAuth = jest.fn().mockResolvedValue({ type: "dismiss" });
const mockVerify = jest.fn().mockResolvedValue({ status: "pending" });
const mockCreateMethodCheckout = jest.fn().mockResolvedValue(null); // falls back to the pre-created checkout url
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
});
