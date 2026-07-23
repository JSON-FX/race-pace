import { render, screen, fireEvent } from "@testing-library/react-native";
import NotificationsScreen from "../app/notifications";

// NOTE: variables referenced inside a `jest.mock(...)` factory must be
// prefixed with `mock` (case-insensitive) — babel-plugin-jest-hoist hoists
// jest.mock calls above plain `const` declarations and rejects out-of-scope
// references that aren't recognizable as mocks (see notifications-hooks.test.tsx
// for the same convention). This is a test-only rename from the task brief's
// `push`/`markAll`/`markReadMutate` — app/notifications.tsx itself is untouched.
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }));
// Matches the same-shape mock used by every other screen test that calls
// useSafeAreaInsets (e.g. ticket-screen.test.tsx, profile.test.tsx) — without
// it, RN's SafeAreaProvider context is unavailable under the test renderer
// and the hook throws "No safe area value available".
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const mockMarkAll = jest.fn();
const mockMarkReadMutate = jest.fn();
jest.mock("../lib/notifications", () => ({
  useNotifications: () => ({
    data: [
      { id: "n1", type: "paid", title: "Payment received", body: "You're confirmed", data: { registration_id: "r1" }, read_at: null, created_at: new Date().toISOString() },
      { id: "n2", type: "event_created", title: "New event", body: "Sierra Madre", data: { event_id: "e9" }, read_at: "2026-07-20T00:00:00Z", created_at: "2026-07-20T00:00:00Z" },
    ],
    isLoading: false, isError: false, refetch: jest.fn(),
  }),
  useMarkRead: () => ({ mutate: mockMarkReadMutate }),
  useMarkAllRead: () => ({ mutate: mockMarkAll }),
}));

describe("NotificationsScreen", () => {
  it("renders notifications and marks all read", () => {
    render(<NotificationsScreen />);
    expect(screen.getByText("Payment received")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("Mark all read"));
    expect(mockMarkAll).toHaveBeenCalled();
  });
  it("marks read and deep-links on row press", () => {
    render(<NotificationsScreen />);
    fireEvent.press(screen.getByText("Payment received"));
    expect(mockMarkReadMutate).toHaveBeenCalledWith("n1");
    expect(mockPush).toHaveBeenCalledWith("/ticket/r1");
  });
});
