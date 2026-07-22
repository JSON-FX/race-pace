import { render, screen, fireEvent } from "@testing-library/react-native";
import { OrganizerFilterPicker } from "../components/OrganizerFilterPicker";
import type { OrgRow } from "../lib/events";

const orgs: OrgRow[] = [
  { id: "o1", name: "TrailRun PH", slug: "trailrun-ph", logo_url: null, banner_url: null, description: null, brand_color: "#3A7CC7", event_count: 12 },
  { id: "o2", name: "Endure PH", slug: "endure-ph", logo_url: null, banner_url: null, description: null, brand_color: "#C7473A", event_count: 7 },
  { id: "o3", name: "No Events Org", slug: "no-events", logo_url: null, banner_url: null, description: null, brand_color: null, event_count: 0 },
];

describe("OrganizerFilterPicker", () => {
  it("hides organizers with no events and lists the rest", () => {
    render(<OrganizerFilterPicker orgs={orgs} selectedIds={[]} onChangeSelectedIds={jest.fn()} onBack={jest.fn()} />);
    expect(screen.getByText("TrailRun PH")).toBeOnTheScreen();
    expect(screen.getByText("Endure PH")).toBeOnTheScreen();
    expect(screen.queryByText("No Events Org")).toBeNull();
  });

  it("filters the list as you type", () => {
    render(<OrganizerFilterPicker orgs={orgs} selectedIds={[]} onChangeSelectedIds={jest.fn()} onBack={jest.fn()} />);
    fireEvent.changeText(screen.getByPlaceholderText("Search organizers"), "trail");
    expect(screen.getByText("TrailRun PH")).toBeOnTheScreen();
    expect(screen.queryByText("Endure PH")).toBeNull();
  });

  it("adds an org to the selection when pressed", () => {
    const onChangeSelectedIds = jest.fn();
    render(<OrganizerFilterPicker orgs={orgs} selectedIds={["o1"]} onChangeSelectedIds={onChangeSelectedIds} onBack={jest.fn()} />);
    fireEvent.press(screen.getByText("Endure PH"));
    expect(onChangeSelectedIds).toHaveBeenCalledWith(["o1", "o2"]);
  });

  it("removes an org from the selection when its removable tag is pressed", () => {
    const onChangeSelectedIds = jest.fn();
    render(<OrganizerFilterPicker orgs={orgs} selectedIds={["o1", "o2"]} onChangeSelectedIds={onChangeSelectedIds} onBack={jest.fn()} />);
    fireEvent.press(screen.getAllByText("TrailRun PH")[0]);
    expect(onChangeSelectedIds).toHaveBeenCalledWith(["o2"]);
  });

  it("calls onBack when the back arrow is pressed", () => {
    const onBack = jest.fn();
    render(<OrganizerFilterPicker orgs={orgs} selectedIds={[]} onChangeSelectedIds={jest.fn()} onBack={onBack} />);
    fireEvent.press(screen.getByLabelText("Back"));
    expect(onBack).toHaveBeenCalled();
  });
});
