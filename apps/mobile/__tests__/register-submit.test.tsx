import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";

const mockReplace = jest.fn();
const mockStartCheckout = jest.fn().mockResolvedValue({ registration_id: "r1", checkout_url: "http://x/dev/pay/r1" });
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ categoryId: "c3" }), useRouter: () => ({ replace: mockReplace, back: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../lib/auth", () => ({ useAuth: () => ({ session: { user: { id: "u1" } } }) }));
jest.mock("../lib/profile", () => ({ getProfile: jest.fn().mockResolvedValue(null) }));
jest.mock("../lib/registration", () => ({ startCheckout: (...a: unknown[]) => mockStartCheckout(...a) }));
jest.mock("../lib/events", () => ({
  useCategory: () => ({ data: { id: "c3", event_id: "e1", label: "21K", base_price: 150000 }, isLoading: false }),
  useFormFields: () => ({ data: [
    { id: "f1", key: "blood_type", label: "Blood type", type: "select", required: true, options: ["A", "O"], sort_order: 1 },
  ], isLoading: false }),
  useAddons: () => ({ data: [{ id: "d1", name: "Singlet", price: 60000 }], isLoading: false }),
}));

import Register from "../app/register/[categoryId]";

describe("Register submit", () => {
  it("requires emergency contact + waiver, then submits valid data (core + dynamic) to checkout", async () => {
    render(<Register />);
    fireEvent.press(screen.getByText("O"));                                          // dynamic blood type
    fireEvent.changeText(screen.getByLabelText("Emergency contact"), "Jane · 0917 000 0000");
    fireEvent.press(screen.getByText("Register"));                                   // waiver not accepted yet
    await waitFor(() => expect(screen.getByText("You must accept the waiver.")).toBeOnTheScreen());
    fireEvent.press(screen.getByLabelText("Accept waiver"));
    fireEvent.press(screen.getByText("Register"));
    await waitFor(() => expect(mockStartCheckout).toHaveBeenCalled());
    const arg = mockStartCheckout.mock.calls[0][0];
    expect(arg).toMatchObject({
      event_id: "e1", category_id: "c3", waiver_accepted: true,
      custom_data: { blood_type: "O", emergency_contact: "Jane · 0917 000 0000" },
    });
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: "/pay/[registrationId]",
      params: { registrationId: "r1", checkoutUrl: "http://x/dev/pay/r1" },
    });
  });
});
