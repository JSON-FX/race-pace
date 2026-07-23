import { render, screen, fireEvent } from "@testing-library/react-native";
// ElevationHero renders react-native-svg; stub it so the fallback is assertable by testID.
jest.mock("../components/ElevationHero", () => ({
  ElevationHero: () => { const { View } = require("react-native"); return <View testID="elevation-hero" />; },
}));
import { EventCard } from "../components/EventCard";
import type { EventRow } from "../lib/events";

const base: EventRow = {
  id: "e1", org_id: "o1", name: "Highland Trail Run", place: null, region: null,
  event_date: "2026-11-14", end_date: null, elevation_gain_m: null, cutoff_hours: null, status: "open",
  hero_image_url: null, description: null, gallery: [], original_date: null, status_note: null,
  city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null,
  joined_count: 0, distances: [], org_name: "Race Pace", org_color: "#159A55",
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

it("falls back to the elevation hero if the featured image fails to load", () => {
  render(<EventCard event={{ ...base, hero_image_url: "https://cdn/broken.png" }} onPress={() => {}} />);
  fireEvent(screen.getByTestId("event-card-image"), "error");
  expect(screen.getByTestId("elevation-hero")).toBeOnTheScreen();
  expect(screen.queryByTestId("event-card-image")).toBeNull();
});

it("shows address and date range as separate lines", () => {
  render(<EventCard event={{ ...base, place: "Digos City", event_date: "2026-09-01", end_date: "2026-09-03" }} onPress={() => {}} />);
  expect(screen.getByText("Digos City")).toBeOnTheScreen();
  expect(screen.getByText("Sep 1 – Sep 3")).toBeOnTheScreen();
});

it("prefixes a cancelled event's date range with 'was'", () => {
  render(<EventCard event={{ ...base, status: "cancelled", event_date: "2026-09-01", end_date: "2026-09-03" }} onPress={() => {}} />);
  expect(screen.getByText("was Sep 1 – Sep 3")).toBeOnTheScreen();
});

it("shows the joined count only when greater than zero", () => {
  render(<EventCard event={{ ...base, joined_count: 128 }} onPress={() => {}} />);
  expect(screen.getByText("+128 joined")).toBeOnTheScreen();
});

it("hides the joined line when nobody has joined yet", () => {
  render(<EventCard event={{ ...base, joined_count: 0 }} onPress={() => {}} />);
  expect(screen.queryByText(/joined/)).toBeNull();
});

it("shows a distance pill for each distinct category distance", () => {
  render(<EventCard event={{ ...base, distances: [21, 42, 21] }} onPress={() => {}} />);
  expect(screen.getByText("21K")).toBeOnTheScreen();
  expect(screen.getByText("42K")).toBeOnTheScreen();
});

it("shows no distance pills when the event has no categorized distances", () => {
  render(<EventCard event={{ ...base, distances: [] }} onPress={() => {}} />);
  expect(screen.queryByText(/^\d+K$/)).toBeNull();
});
