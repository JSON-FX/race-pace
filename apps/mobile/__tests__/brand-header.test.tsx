import { render, screen, fireEvent } from "@testing-library/react-native";
import { BrandHeader } from "../components/BrandHeader";

// NOTE: variables referenced inside a `jest.mock(...)` factory must be
// prefixed with `mock` (case-insensitive) — babel-plugin-jest-hoist hoists
// jest.mock calls above plain `const` declarations and rejects out-of-scope
// references that aren't recognizable as mocks (see notifications-screen.test.tsx
// for the same convention). This is a test-only rename from the task brief's
// `push` — components/BrandHeader.tsx itself is untouched.
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
// BrandHeader calls useSafeAreaInsets unconditionally; without this mock the
// hook throws "No safe area value available" under the test renderer (same
// mock every other screen test that touches useSafeAreaInsets uses — see
// e.g. notifications-screen.test.tsx, ticket-screen.test.tsx, profile.test.tsx).
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../lib/notifications", () => ({ useUnreadCount: () => ({ data: 3 }) }));

describe("BrandHeader", () => {
  it("shows the unread count and opens the inbox on bell press", () => {
    render(<BrandHeader />);
    expect(screen.getByText("3")).toBeOnTheScreen();
    fireEvent.press(screen.getByLabelText("Notifications"));
    expect(mockPush).toHaveBeenCalledWith("/notifications");
  });
});
