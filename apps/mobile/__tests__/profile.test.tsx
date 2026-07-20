import { render, screen, waitFor } from "@testing-library/react-native";
import Profile from "../app/(tabs)/profile";

jest.mock("../lib/auth", () => ({ useAuth: () => ({ session: { user: { id: "u1", email: "jr@x.test" } }, signOut: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ replace: jest.fn() }) }));
jest.mock("../lib/profile", () => ({
  getProfile: jest.fn().mockResolvedValue({ id: "u1", full_name: "JR Dela Cruz", bib_name: "JR", city: "Davao" }),
  upsertProfile: jest.fn(),
}));

describe("Profile", () => {
  it("loads existing profile values", async () => {
    render(<Profile />);
    await waitFor(() => expect(screen.getByDisplayValue("JR Dela Cruz")).toBeOnTheScreen());
    expect(screen.getByDisplayValue("Davao")).toBeOnTheScreen();
  });
});
