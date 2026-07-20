import { render, screen, fireEvent } from "@testing-library/react-native";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../components/EventCard", () => ({
  EventCard: ({ event, onPress }: any) => { const { Text, Pressable } = require("react-native"); return <Pressable onPress={onPress}><Text>{event.name}</Text></Pressable>; },
}));

const mockEvent: any = {
  id: "e1", org_id: "o1", name: "Highland Trail Run", place: null, region: null,
  event_date: "2026-11-14", elevation_gain_m: null, cutoff_hours: null,
  status: "open", hero_image_url: null, description: null,
  gallery: [], original_date: null, status_note: null,
  city_psgc_code: "112603", region_name: "Region XI (Davao Region)", province_name: "Davao del Sur", city_name: "City of Digos", venue: null,
  org_name: "Run With Point", org_color: "#159A55",
};
jest.mock("../lib/events", () => ({
  useMarketplaceEvents: () => ({ data: [mockEvent], isLoading: false, isError: false, refetch: jest.fn() }),
}));

import Marketplace from "../app/(tabs)/events";

describe("Marketplace search", () => {
  it("matches on standardized PSGC city/province fields, not just legacy place/region", () => {
    render(<Marketplace />);
    const input = screen.getByPlaceholderText("Search by name or place");
    fireEvent.changeText(input, "Davao del Sur");
    expect(screen.getByText("Highland Trail Run")).toBeOnTheScreen();
  });

  it("hides the event when the search term matches nothing", () => {
    render(<Marketplace />);
    const input = screen.getByPlaceholderText("Search by name or place");
    fireEvent.changeText(input, "Zzzznomatch");
    expect(screen.queryByText("Highland Trail Run")).not.toBeOnTheScreen();
  });
});
