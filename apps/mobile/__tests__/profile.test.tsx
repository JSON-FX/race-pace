import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";

const mockUpsert = jest.fn().mockResolvedValue({});
jest.mock("../lib/auth", () => ({ useAuth: () => ({ session: { user: { id: "u1", email: "jr@x.test" } }, signOut: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ replace: jest.fn() }) }));
jest.mock("../lib/profile", () => ({
  getProfile: jest.fn().mockResolvedValue({ id: "u1", full_name: "JR Dela Cruz", bib_name: "JR", date_of_birth: "1990-05-15", gender: "Male", blood_type: "O+", shirt_size: "M", emergency_contact: "Jane 0917", city_name: "Digos City", province_name: "Davao del Sur", city_psgc_code: "c1" }),
  upsertProfile: (...a: unknown[]) => mockUpsert(...a),
}));
// The picker is exercised in its own test; here assert the profile wires its value/onChange.
jest.mock("../components/PsgcAddressPicker", () => ({
  PsgcAddressPicker: ({ value, onChange }: any) => {
    const { Text, Pressable } = require("react-native");
    return (<>
      <Text>picked:{value?.city_name ?? "none"}</Text>
      <Pressable accessibilityLabel="set-city" onPress={() => onChange({ city_psgc_code: "c9", city_name: "Bansalan", province_name: "Davao del Sur", region_name: "Davao Region" })}><Text>set</Text></Pressable>
    </>);
  },
}));

import Profile from "../app/(tabs)/profile";

describe("Profile", () => {
  beforeEach(() => {
    mockUpsert.mockClear();
  });

  it("prefills the picker from the saved PSGC city and saves the address", async () => {
    render(<Profile />);
    await waitFor(() => expect(screen.getByText("picked:Digos City")).toBeOnTheScreen());
    fireEvent.press(screen.getByLabelText("set-city"));       // change city via the picker
    fireEvent.press(screen.getByText("Save changes"));
    await waitFor(() => expect(mockUpsert).toHaveBeenCalled());
    expect(mockUpsert.mock.calls[0][0]).toMatchObject({
      id: "u1", city_psgc_code: "c9", city_name: "Bansalan", province_name: "Davao del Sur",
    });
  });

  it("prefills passport fields (DOB, blood type, emergency contact) and saves the updated payload", async () => {
    render(<Profile />);
    await waitFor(() => expect(screen.getByDisplayValue("1990-05-15")).toBeOnTheScreen());
    expect(screen.getByDisplayValue("Jane 0917")).toBeOnTheScreen();
    // PillSelect options are ToggleGroup radios (native single-select semantics).
    expect(screen.getByRole("radio", { name: "O+", checked: true })).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("radio", { name: "L" }));      // change shirt size
    fireEvent.press(screen.getByText("Save changes"));
    await waitFor(() => expect(mockUpsert).toHaveBeenCalled());
    expect(mockUpsert.mock.calls[0][0]).toMatchObject({
      blood_type: "O+", shirt_size: "L", emergency_contact: "Jane 0917",
    });
  });
});
