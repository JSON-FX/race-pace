import { render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { AuthProvider, useAuth } from "../lib/auth";

jest.mock("../lib/captcha", () => ({ getAuthCaptchaToken: jest.fn() }));

jest.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: jest.fn().mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } }),
    },
  },
}));

function Probe() {
  const { loading, session } = useAuth();
  return <Text>{loading ? "loading" : session ? "in" : "out"}</Text>;
}

describe("AuthProvider", () => {
  it("resolves to signed-out when there is no session", async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText("out")).toBeOnTheScreen());
  });
});
