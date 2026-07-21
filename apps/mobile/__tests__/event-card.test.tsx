import { render, screen } from "@testing-library/react-native";
// ElevationHero renders react-native-svg; stub it so the fallback is assertable by testID.
jest.mock("../components/ElevationHero", () => ({
  ElevationHero: () => { const { View } = require("react-native"); return <View testID="elevation-hero" />; },
}));
import { EventCard } from "../components/EventCard";
import type { EventRow } from "../lib/events";

const base: EventRow = {
  id: "e1", org_id: "o1", name: "Highland Trail Run", place: null, region: null,
  event_date: "2026-11-14", elevation_gain_m: null, cutoff_hours: null, status: "open",
  hero_image_url: null, description: null, gallery: [], original_date: null, status_note: null,
  city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null,
  org_name: "Race Pace", org_color: "#159A55",
};

it("renders the featured image when hero_image_url is set", () => {
  render(<EventCard event={{ ...base, hero_image_url: "https://cdn/hero.png" }} onPress={() => {}} />);
  expect(screen.getByTestId("event-card-image")).toBeOnTheScreen();
  expect(screen.queryByTestId("elevation-hero")).toBeNull();
});

it("falls back to the elevation hero when there is no image", () => {
  render(<EventCard event={base} onPress={() => {}} />);
  expect(screen.getByTestId("elevation-hero")).toBeOnTheScreen();
  expect(screen.queryByTestId("event-card-image")).toBeNull();
});
