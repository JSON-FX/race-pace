import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import { PortalHost } from "@rn-primitives/portal";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../lib/ticketCache", () => ({ cacheMyRaces: jest.fn(), getCachedMyRaces: jest.fn().mockResolvedValue([]) }));
jest.mock("../lib/useGlobalRefresh", () => ({ useGlobalRefresh: () => ({ refreshing: false, onRefresh: jest.fn() }) }));

const mockInvalidate = jest.fn();
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }));

let mockMyRegResult: any;
const mockCancel = jest.fn().mockResolvedValue(undefined);
jest.mock("../lib/registration", () => ({
  useMyRegistrations: () => mockMyRegResult,
  cancelRegistration: (...args: any[]) => mockCancel(...args),
}));

import MyRaces from "../app/(tabs)/races";
import { getCachedMyRaces } from "../lib/ticketCache";

function row(o: any) {
  return {
    id: "r", status: "paid", total_amount: 120000, ticket_token: "a.b", org_id: "o1",
    eventName: "Race", categoryLabel: "21K", categoryDistance: 21, checkoutUrl: null,
    eventStatus: "open", eventDate: "2026-10-18", originalDate: null, statusNote: null, payment: null, ...o,
  };
}

function renderScreen() {
  return render(<><MyRaces /><PortalHost /></>);
}

describe("My Races (segmented)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date("2026-07-23T12:00:00"));
  });
  afterEach(() => jest.useRealTimers());

  it("defaults to Registered and shows segment counts", async () => {
    mockMyRegResult = {
      data: [
        row({ id: "reg1", status: "paid", eventName: "Kalatungan Skyrun", eventDate: "2026-10-18" }),
        row({ id: "done1", status: "paid", eventName: "Mt. Apo Sky Race", eventDate: "2026-01-10" }),
        row({ id: "pay1", status: "pending", eventName: "Sierra Madre Challenge" }),
      ],
      isLoading: false, isError: false, refetch: jest.fn(),
    };
    renderScreen();
    expect(await screen.findByText("Registered 1")).toBeOnTheScreen();
    expect(screen.getByText("Completed 1")).toBeOnTheScreen();
    expect(screen.getByText("Unpaid 1")).toBeOnTheScreen();
    // Registered is active by default.
    expect(screen.getByText("Kalatungan Skyrun")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("Kalatungan Skyrun"));
    expect(mockPush).toHaveBeenCalledWith("/ticket/reg1");
  });

  it("switches to Completed and routes a completed card to its receipt", async () => {
    mockMyRegResult = {
      data: [row({ id: "done1", status: "paid", eventName: "Mt. Apo Sky Race", eventDate: "2026-01-10" })],
      isLoading: false, isError: false, refetch: jest.fn(),
    };
    renderScreen();
    fireEvent.press(await screen.findByLabelText("Completed"));
    fireEvent.press(screen.getByText("Mt. Apo Sky Race"));
    expect(mockPush).toHaveBeenCalledWith("/registration/done1");
  });

  it("cancels an unpaid registration through the confirm dialog", async () => {
    mockMyRegResult = {
      data: [row({ id: "pay1", status: "pending", eventName: "Sierra Madre Challenge" })],
      isLoading: false, isError: false, refetch: jest.fn(),
    };
    renderScreen();
    // Registered empty + unpaid present -> defaults to Unpaid.
    fireEvent.press(await screen.findByText("Cancel"));
    expect(screen.getByText("Cancel this registration?")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("Cancel registration"));
    await waitFor(() => expect(mockCancel).toHaveBeenCalledWith("pay1"));
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ["my-registrations"] });
    await waitFor(() => expect(screen.queryByText("Cancel this registration?")).toBeNull());
  });

  it("keeps the dialog open and shows an error when cancel fails", async () => {
    mockMyRegResult = {
      data: [row({ id: "pay1", status: "pending", eventName: "Sierra Madre Challenge" })],
      isLoading: false, isError: false, refetch: jest.fn(),
    };
    mockCancel.mockRejectedValueOnce(new Error("nope"));
    renderScreen();
    fireEvent.press(await screen.findByText("Cancel"));
    fireEvent.press(screen.getByText("Cancel registration"));
    expect(await screen.findByText("Couldn't cancel. Try again.")).toBeOnTheScreen();
    expect(screen.getByText("Cancel this registration?")).toBeOnTheScreen();
  });

  it("falls back to cached races when offline", async () => {
    mockMyRegResult = { data: undefined, isLoading: false, isError: true, refetch: jest.fn() };
    (getCachedMyRaces as jest.Mock).mockResolvedValueOnce([
      { rid: "rc1", token: "a.b", eventName: "Cotabato Skyrace 42", categoryLabel: "42K", runnerName: "", status: "paid", orgId: "o1" },
    ]);
    renderScreen();
    expect(await screen.findByText("Cotabato Skyrace 42")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("Cotabato Skyrace 42"));
    expect(mockPush).toHaveBeenCalledWith("/ticket/rc1");
  });
});
