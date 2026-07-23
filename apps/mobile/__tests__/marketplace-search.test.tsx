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
  joined_count: 0, distances: [21], org_name: "Race Pace", org_color: "#159A55",
};
const pastMockEvent: any = {
  id: "e2", org_id: "o1", name: "Sunset Trail 10K", place: null, region: null,
  event_date: "2026-01-01", elevation_gain_m: null, cutoff_hours: null,
  status: "completed", hero_image_url: null, description: null,
  gallery: [], original_date: null, status_note: null,
  city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null,
  joined_count: 0, distances: [10], org_name: "Race Pace", org_color: "#159A55",
};
jest.mock("../lib/events", () => ({
  useMarketplaceEvents: () => ({ data: [mockEvent, pastMockEvent], isLoading: false, isError: false, refetch: jest.fn() }),
  useOrgs: () => ({ data: [], isLoading: false, isError: false, refetch: jest.fn() }),
}));
jest.mock("../lib/useGlobalRefresh", () => ({ useGlobalRefresh: () => ({ refreshing: false, onRefresh: jest.fn() }) }));

import Marketplace from "../app/(tabs)/events";

describe("Marketplace search", () => {
  // The screen derives "today" from the real clock (todayIsoNow() -> new
  // Date()), so pin it well before mockEvent's 2026-11-14 date — otherwise
  // this suite silently starts failing once that date passes.
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-23T12:00:00"));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

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

  it("shows the date segment pills and switches the active one", () => {
    render(<Marketplace />);
    expect(screen.getByRole("radio", { name: "All", checked: true })).toBeOnTheScreen();
    fireEvent.press(screen.getByRole("radio", { name: "This month" }));
    expect(screen.getByRole("radio", { name: "This month", checked: true })).toBeOnTheScreen();
  });

  it("keeps the upcoming event visible and appends a Past events section at the end when shown", () => {
    render(<Marketplace />);
    expect(screen.getByText("Highland Trail Run")).toBeOnTheScreen();
    expect(screen.queryByText("Sunset Trail 10K")).toBeNull();

    fireEvent.press(screen.getByText("Show"));
    expect(screen.getByText("Highland Trail Run")).toBeOnTheScreen();
    expect(screen.getByText("Sunset Trail 10K")).toBeOnTheScreen();
  });

  it("hides the past section again when Hide is pressed, without touching the upcoming event", () => {
    render(<Marketplace />);
    fireEvent.press(screen.getByText("Show"));
    expect(screen.getByText("Sunset Trail 10K")).toBeOnTheScreen();

    fireEvent.press(screen.getByText("Hide"));
    expect(screen.queryByText("Sunset Trail 10K")).toBeNull();
    expect(screen.getByText("Highland Trail Run")).toBeOnTheScreen();
  });

  it("shows Clear filters when an active filter matches nothing, and resets on press", () => {
    render(<Marketplace />);
    fireEvent.press(screen.getByRole("radio", { name: "This week" }));
    expect(screen.queryByText("Highland Trail Run")).toBeNull();
    expect(screen.getByText("No events match your filters.")).toBeOnTheScreen();

    fireEvent.press(screen.getByText("Clear filters"));
    expect(screen.getByRole("radio", { name: "All", checked: true })).toBeOnTheScreen();
    expect(screen.getByText("Highland Trail Run")).toBeOnTheScreen();
  });
});
