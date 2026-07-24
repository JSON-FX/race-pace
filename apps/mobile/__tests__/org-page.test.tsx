import { render, screen, fireEvent } from "@testing-library/react-native";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ id: "o2" }), useRouter: () => ({ push: mockPush, back: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../lib/useGlobalRefresh", () => ({ useGlobalRefresh: () => ({ refreshing: false, onRefresh: jest.fn() }) }));
jest.mock("../components/OrgHeader", () => ({
  OrgHeader: ({ org }: any) => { const { Text } = require("react-native"); return <Text>{org.name}</Text>; },
}));
jest.mock("../components/EventCard", () => ({
  EventCard: ({ event, onPress }: any) => { const { Text, Pressable } = require("react-native"); return <Pressable onPress={onPress}><Text>{event.name}</Text></Pressable>; },
}));
jest.mock("../lib/events", () => ({
  useOrg: () => ({ data: { id: "o2", name: "Highland Endurance", slug: "highland-endurance", logo_url: null, banner_url: null, description: "Bukidnon", brand_color: "#0F766E" }, isLoading: false }),
  useEventsByOrg: () => ({ data: [{ id: "e3", org_id: "o2", name: "Bukidnon Highland 50", place: "Malaybalay", region: "Bukidnon", event_date: "2026-09-27", status: "open", hero_image_url: null, gallery: [], original_date: "2026-09-14", status_note: null, distances: [50], joined_count: 0 }] }),
}));

import OrgPage from "../app/org/[id]";

describe("OrgPage", () => {
  // The page now hides past events by default (todayIsoNow() -> new Date()), so
  // pin "today" before the event's 2026-09-27 date to keep it upcoming — else
  // this silently starts failing once that date passes.
  beforeEach(() => { jest.useFakeTimers().setSystemTime(new Date("2026-07-23T12:00:00")); });
  afterEach(() => { jest.useRealTimers(); });

  it("shows the org header, a search bar, its events, and routes to an event", () => {
    render(<OrgPage />);
    expect(screen.getByText("Highland Endurance")).toBeOnTheScreen();
    expect(screen.getByPlaceholderText("Search by name or place")).toBeOnTheScreen();
    expect(screen.getByText("Bukidnon Highland 50")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("Bukidnon Highland 50"));
    expect(mockPush).toHaveBeenCalledWith("/event/e3");
  });
});
