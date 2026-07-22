import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import SignIn from "../app/(auth)/sign-in";

const mockSignIn = jest.fn().mockResolvedValue({ error: "Invalid login credentials" });
jest.mock("../lib/auth", () => ({ useAuth: () => ({ signIn: mockSignIn }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  Link: ({ children }: { children: React.ReactNode }) => children,
}));

describe("SignIn", () => {
  it("shows the error returned by signIn", async () => {
    render(<SignIn />);
    fireEvent.changeText(screen.getByLabelText("Email"), "jr@test.dev");
    fireEvent.changeText(screen.getByLabelText("Password"), "wrong");
    fireEvent.press(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(screen.getByText("Invalid login credentials")).toBeOnTheScreen());
  });
});
