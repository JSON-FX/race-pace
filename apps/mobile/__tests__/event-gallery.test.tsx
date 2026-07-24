import { render, screen, fireEvent } from "@testing-library/react-native";
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

it("replaces a slide that fails to load with the fallback, keeping the others", () => {
  render(<EventGallery images={["https://cdn/a.png", "https://cdn/b.png"]} height={250} />);
  const slides = screen.getAllByTestId("gallery-image");
  expect(slides).toHaveLength(2);
  fireEvent(slides[0], "error");
  expect(screen.getAllByTestId("gallery-image")).toHaveLength(1);
  expect(screen.getByTestId("elevation-hero")).toBeOnTheScreen();
});

it("opens a full-screen viewer when a slide is tapped and closes it", () => {
  render(<EventGallery images={["https://cdn/a.png", "https://cdn/b.png"]} height={250} />);
  expect(screen.queryByTestId("gallery-viewer")).toBeNull();
  fireEvent.press(screen.getAllByLabelText("View image")[0]);
  expect(screen.getByTestId("gallery-viewer")).toBeOnTheScreen();
  expect(screen.getByText("1 / 2")).toBeOnTheScreen();
  fireEvent.press(screen.getByLabelText("Close"));
  expect(screen.queryByTestId("gallery-viewer")).toBeNull();
});
