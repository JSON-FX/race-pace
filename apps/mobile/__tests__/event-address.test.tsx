import { render, screen } from "@testing-library/react-native";
jest.mock("../lib/format", () => ({ shortDate: () => "Nov 14", longDate: () => "November 14, 2026" }));
jest.mock("../components/ElevationHero", () => ({ ElevationHero: () => null }));
jest.mock("../components/StatusBadge", () => ({ StatusBadge: () => null, eventStatusKind: () => "open" }));
import { EventCard } from "../components/EventCard";

const base: any = { id: "e1", org_id: "o1", name: "Apo Sky Ultra 2026", event_date: "2026-11-14", gallery: [], status: "open" };

describe("Event address display", () => {
  it("card shows formatAddress when PSGC present", () => {
    render(<EventCard event={{ ...base, city_name: "Digos City", province_name: "Davao del Sur", place: "Mt Apo" }} onPress={() => {}} />);
    expect(screen.getByText("Digos City, Davao del Sur")).toBeOnTheScreen();
    expect(screen.getByText("Nov 14")).toBeOnTheScreen();
  });
  it("card falls back to legacy place when no PSGC", () => {
    render(<EventCard event={{ ...base, city_name: null, place: "Mt Apo" }} onPress={() => {}} />);
    expect(screen.getByText("Mt Apo")).toBeOnTheScreen();
    expect(screen.getByText("Nov 14")).toBeOnTheScreen();
  });
});
