import { render, screen, fireEvent } from "@testing-library/react-native";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../lib/events", () => ({
  useOrgs: () => ({
    data: [
      { id: "o1", name: "Apo Skyrunners Assoc.", slug: "apo-skyrunners", logo_url: null, banner_url: null, description: "Davao", brand_color: "#159A55", event_count: 8 },
      { id: "o2", name: "Highland Endurance", slug: "highland-endurance", logo_url: null, banner_url: null, description: "Bukidnon", brand_color: "#0F766E", event_count: 4 },
    ],
    isLoading: false, isError: false, refetch: jest.fn(),
  }),
}));
jest.mock("../lib/useGlobalRefresh", () => ({ useGlobalRefresh: () => ({ refreshing: false, onRefresh: jest.fn() }) }));

import Orgs from "../app/(tabs)/orgs";

describe("Orgs", () => {
  it("lists organizations with event counts and routes to an org page", () => {
    render(<Orgs />);
    expect(screen.getByText("Apo Skyrunners Assoc.")).toBeOnTheScreen();
    expect(screen.getByText("8 events")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("Highland Endurance"));
    expect(mockPush).toHaveBeenCalledWith("/org/o2");
  });
});
