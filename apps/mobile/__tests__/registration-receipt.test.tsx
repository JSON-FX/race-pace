import { render, screen, fireEvent } from "@testing-library/react-native";
import { formatPeso } from "@race-pace/shared";

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => ({ registrationId: "r1abcdef99" }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

let mockReg: any;
jest.mock("../lib/registration", () => ({ useRegistration: () => mockReg }));

import RegistrationReceipt from "../app/registration/[registrationId]";

describe("Registration receipt", () => {
  it("shows the payment breakdown, the deferred check-in row, and links to the race pass", () => {
    mockReg = {
      isLoading: false,
      data: {
        id: "r1abcdef99", status: "paid", eventName: "Mt. Apo Sky Race",
        categoryLabel: "Sky Race", categoryDistance: 50,
        payment: { createdAt: "2026-03-06T02:15:00Z", method: "gcash", amount: 120000, platformFee: 6000, netToOrg: 114000, provider: "paymongo", providerRef: "cs_abc123", status: "paid" },
      },
    };
    render(<RegistrationReceipt />);
    expect(screen.getByText("Mt. Apo Sky Race")).toBeOnTheScreen();
    expect(screen.getByText("Completed")).toBeOnTheScreen();
    expect(screen.getByText("GCash")).toBeOnTheScreen();
    expect(screen.getByText("Mar 6, 2026")).toBeOnTheScreen();
    expect(screen.getByText("cs_abc123")).toBeOnTheScreen();
    expect(screen.getByText(formatPeso(120000))).toBeOnTheScreen();
    expect(screen.getByText(formatPeso(6000))).toBeOnTheScreen();
    expect(screen.getByText("Not recorded yet")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("View race pass"));
    expect(mockPush).toHaveBeenCalledWith("/ticket/r1abcdef99");
  });

  it("shows a Refunded badge and hides the race pass link for a refunded registration", () => {
    mockReg = {
      isLoading: false,
      data: {
        id: "r1abcdef99", status: "refunded", eventName: "Cordillera Run",
        categoryLabel: "21K", categoryDistance: 21,
        payment: { createdAt: "2025-11-01T00:00:00Z", method: "card", amount: 90000, platformFee: 4500, netToOrg: 85500, provider: "paymongo", providerRef: null, status: "refunded" },
      },
    };
    render(<RegistrationReceipt />);
    expect(screen.getByText("Refunded")).toBeOnTheScreen();
    expect(screen.getByText("R1ABCDEF")).toBeOnTheScreen();
    expect(screen.queryByText("View race pass")).toBeNull();
  });
});
