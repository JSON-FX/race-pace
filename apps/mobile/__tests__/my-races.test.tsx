import { render, screen, fireEvent } from "@testing-library/react-native";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("../lib/org", () => ({ useOrg: () => ({ selectedOrgId: "o1" }) }));
jest.mock("../lib/ticketCache", () => ({
  cacheMyRaces: jest.fn(),
  getCachedMyRaces: jest.fn().mockResolvedValue([]),
}));

// mock-prefixed per babel-plugin-jest-hoist (any out-of-scope const/let a jest.mock
// factory closes over must match /^mock/i) — same idiom as pay-screen.test.tsx's mockRegData.
let mockMyRegResult: any = {
  data: [
    { id: "r1", status: "paid", ticket_token: "a.b", eventName: "Apo Sky Ultra 2026", categoryLabel: "21K", org_id: "o1", total_amount: 150000 },
    { id: "r2", status: "pending", ticket_token: null, eventName: "Apo Sky Ultra 2026", categoryLabel: "10K", org_id: "o1", total_amount: 100000 },
  ],
  isLoading: false, isError: false, refetch: jest.fn(),
};
jest.mock("../lib/registration", () => ({
  useMyRegistrations: () => mockMyRegResult,
}));

import MyRaces from "../app/(tabs)/races";
import { getCachedMyRaces } from "../lib/ticketCache";

describe("My Races", () => {
  it("lists entries with status and routes to ticket (paid) or pay (pending)", async () => {
    mockMyRegResult = {
      data: [
        { id: "r1", status: "paid", ticket_token: "a.b", eventName: "Apo Sky Ultra 2026", categoryLabel: "21K", org_id: "o1", total_amount: 150000 },
        { id: "r2", status: "pending", ticket_token: null, eventName: "Apo Sky Ultra 2026", categoryLabel: "10K", org_id: "o1", total_amount: 100000 },
      ],
      isLoading: false, isError: false, refetch: jest.fn(),
    };
    render(<MyRaces />);
    // Awaited: the cache-load effect (getCachedMyRaces) always fires on mount and
    // resolves asynchronously even when network `data` is already present, so we
    // must let that microtask settle inside act() before the test ends.
    expect(await screen.findByText("Paid")).toBeOnTheScreen();
    expect(screen.getByText("Pending")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("21K"));
    expect(mockPush).toHaveBeenCalledWith("/ticket/r1");
    fireEvent.press(screen.getByText("10K"));
    expect(mockPush).toHaveBeenCalledWith("/pay/r2");
  });

  it("falls back to cached races when offline (network error)", async () => {
    mockMyRegResult = { data: undefined, isLoading: false, isError: true, refetch: jest.fn() };
    (getCachedMyRaces as jest.Mock).mockResolvedValueOnce([
      { rid: "rc1", token: "a.b", eventName: "Apo Sky Ultra 2026", categoryLabel: "21K", runnerName: "", status: "paid", orgId: "o1" },
    ]);
    render(<MyRaces />);
    expect(await screen.findByText("21K")).toBeOnTheScreen();
    expect(screen.getByText("Paid")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("21K"));
    expect(mockPush).toHaveBeenCalledWith("/ticket/rc1"); // routes by the cached rid → id
  });
});
