import { render, screen } from "@testing-library/react-native";
jest.mock("../components/ElevationHero", () => ({
  ElevationHero: () => { const { View } = require("react-native"); return <View testID="elevation-hero" />; },
}));
import { EventGallery } from "../components/EventGallery";

it("renders one slide per unique image and drops falsy entries", () => {
  render(<EventGallery images={["https://cdn/hero.png", "https://cdn/g1.png", null]} height={250} />);
  expect(screen.getAllByTestId("gallery-image")).toHaveLength(2);
  expect(screen.queryByTestId("elevation-hero")).toBeNull();
});

it("de-dupes a url that appears twice (featured also in gallery)", () => {
  render(<EventGallery images={["https://cdn/a.png", "https://cdn/a.png"]} height={250} />);
  expect(screen.getAllByTestId("gallery-image")).toHaveLength(1);
});

it("falls back to the elevation hero when there are no images", () => {
  render(<EventGallery images={[null, undefined]} height={250} />);
  expect(screen.getByTestId("elevation-hero")).toBeOnTheScreen();
  expect(screen.queryByTestId("gallery-image")).toBeNull();
});
