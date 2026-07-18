import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import ChooseOrg from "../app/choose-org";

const mockSelectOrg = jest.fn().mockResolvedValue(undefined);
const mockReplace = jest.fn();
jest.mock("../lib/org", () => ({
  useOrg: () => ({
    orgs: [{ id: "org-1", name: "Run With Point", slug: "run-with-point", brand_color: "#1F6248" }],
    refreshOrgs: jest.fn(),
    selectOrg: mockSelectOrg,
  }),
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ replace: mockReplace }) }));

describe("ChooseOrg", () => {
  it("selects an org and routes to events", async () => {
    render(<ChooseOrg />);
    fireEvent.press(screen.getByText("Run With Point"));
    await waitFor(() => expect(mockSelectOrg).toHaveBeenCalledWith("org-1"));
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/events");
  });
});
