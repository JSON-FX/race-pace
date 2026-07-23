import { render } from "@testing-library/react-native";
import NotificationsBridge from "../components/NotificationsBridge";

// Named with a `mock` prefix: babel-plugin-jest-hoist forbids jest.mock() factories
// from closing over out-of-scope variables unless the identifier starts with "mock".
const mockRealtime = jest.fn();
// Typed with an (unused) string param so the inferred mock signature accepts the
// userId argument registerForPush(userId) is called with — tsc otherwise infers a
// zero-arg signature from the plain `async () => ...` implementation.
const mockRegister = jest.fn(async (id: string) => "ExponentPushToken[test]");
jest.mock("../lib/auth", () => ({ useAuth: () => ({ session: { user: { id: "u1" } } }) }));
jest.mock("../lib/notifications", () => ({ useNotificationsRealtime: (id: string) => mockRealtime(id) }));
jest.mock("../lib/push", () => ({ registerForPush: (id: string) => mockRegister(id) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

describe("NotificationsBridge", () => {
  it("subscribes to realtime and registers push for the signed-in user", () => {
    render(<NotificationsBridge />);
    expect(mockRealtime).toHaveBeenCalledWith("u1");
    expect(mockRegister).toHaveBeenCalledWith("u1");
  });
});
