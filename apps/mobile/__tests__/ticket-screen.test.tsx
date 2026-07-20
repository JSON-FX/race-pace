import { render, screen } from "@testing-library/react-native";

jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ registrationId: "r1abc999" }), useRouter: () => ({ back: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../lib/auth", () => ({ useAuth: () => ({ session: { user: { id: "u1" } } }) }));
jest.mock("../lib/profile", () => ({ getProfile: jest.fn().mockResolvedValue({ full_name: "JR Dela Cruz", bib_name: "JR" }) }));
jest.mock("react-native-qrcode-svg", () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => { const { Text } = require("react-native"); return <Text>QR:{value}</Text>; },
}));
jest.mock("../lib/ticketCache", () => ({ getCachedTicket: jest.fn().mockResolvedValue(null), cacheTicket: jest.fn() }));

let mockRegData: any = { id: "r1abc999", status: "paid", ticket_token: "tok.sig", eventName: "Apo Sky Ultra 2026", categoryLabel: "21K", org_id: "o1", eventStatus: "open", eventDate: "2026-11-14", originalDate: null, statusNote: null, categoryDistance: 21 };
jest.mock("../lib/registration", () => ({ useRegistration: () => ({ data: mockRegData, isLoading: false }) }));

import Ticket from "../app/ticket/[registrationId]";
import { getCachedTicket } from "../lib/ticketCache";

describe("Ticket screen", () => {
  it("renders the event, category, and a QR of the ticket token", async () => {
    render(<Ticket />);
    expect(await screen.findByText("Apo Sky Ultra 2026")).toBeOnTheScreen();
    expect(screen.getByText("21K")).toBeOnTheScreen();
    expect(screen.getByText("QR:tok.sig")).toBeOnTheScreen();
  });

  it("renders from cache when offline (no live server data)", async () => {
    mockRegData = undefined;
    (getCachedTicket as jest.Mock).mockResolvedValueOnce({
      rid: "r1abc999", token: "cached.tok", eventName: "Apo Sky Ultra 2026",
      categoryLabel: "50K", runnerName: "", status: "paid", orgId: "o1",
    });
    render(<Ticket />);
    expect(await screen.findByText("50K")).toBeOnTheScreen();
    expect(screen.getByText("QR:cached.tok")).toBeOnTheScreen();
  });
});
