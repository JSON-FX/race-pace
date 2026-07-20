import { render, screen, fireEvent } from "@testing-library/react-native";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../lib/ticketCache", () => ({ cacheMyRaces: jest.fn(), getCachedMyRaces: jest.fn().mockResolvedValue([]) }));

// mock-prefixed per babel-plugin-jest-hoist.
let mockMyRegResult: any = { data: [], isLoading: false, isError: false, refetch: jest.fn() };
jest.mock("../lib/registration", () => ({ useMyRegistrations: () => mockMyRegResult }));

import MyRaces from "../app/(tabs)/races";
import { getCachedMyRaces } from "../lib/ticketCache";

describe("My Races", () => {
  it("lists races across orgs with status and routes to ticket (paid) / pay (pending)", async () => {
    mockMyRegResult = {
      data: [
        { id: "r1", status: "paid", ticket_token: "a.b", eventName: "Mt. Apo Sky Ultra", categoryLabel: "100K Ultra", categoryDistance: 100, eventDate: "2026-10-18", org_id: "o1" },
        { id: "r2", status: "pending", ticket_token: null, eventName: "Bukidnon Highland 50", categoryLabel: "50K", categoryDistance: 50, eventDate: "2026-09-27", org_id: "o2" },
      ],
      isLoading: false, isError: false, refetch: jest.fn(),
    };
    render(<MyRaces />);
    expect(await screen.findByText("Paid")).toBeOnTheScreen();
    expect(screen.getByText("Pending")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("Mt. Apo Sky Ultra"));
    expect(mockPush).toHaveBeenCalledWith("/ticket/r1");
    fireEvent.press(screen.getByText("Bukidnon Highland 50"));
    expect(mockPush).toHaveBeenCalledWith("/pay/r2");
  });

  it("falls back to cached races when offline (network error)", async () => {
    mockMyRegResult = { data: undefined, isLoading: false, isError: true, refetch: jest.fn() };
    (getCachedMyRaces as jest.Mock).mockResolvedValueOnce([
      { rid: "rc1", token: "a.b", eventName: "Cotabato Skyrace 42", categoryLabel: "42K", runnerName: "", status: "paid", orgId: "o1" },
    ]);
    render(<MyRaces />);
    expect(await screen.findByText("Cotabato Skyrace 42")).toBeOnTheScreen();
    expect(screen.getByText("Paid")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("Cotabato Skyrace 42"));
    expect(mockPush).toHaveBeenCalledWith("/ticket/rc1"); // routes by the cached rid → id
  });
});
