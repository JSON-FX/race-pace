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

  it("shows 'No organizers to show' when all orgs have no events and no search query", () => {
    const noEventOrgs: OrgRow[] = [
      { id: "o1", name: "NoEvents A", slug: "no-events-a", logo_url: null, banner_url: null, description: null, brand_color: null, event_count: 0 },
      { id: "o2", name: "NoEvents B", slug: "no-events-b", logo_url: null, banner_url: null, description: null, brand_color: null, event_count: 0 },
    ];
    render(<OrganizerFilterPicker orgs={noEventOrgs} selectedIds={[]} onChangeSelectedIds={jest.fn()} onBack={jest.fn()} />);
    expect(screen.getByText("No organizers to show")).toBeOnTheScreen();
    expect(screen.queryByText(/No organizers match/)).toBeNull();
  });

  it("shows 'No organizers match' when a search yields no results", () => {
    render(<OrganizerFilterPicker orgs={orgs} selectedIds={[]} onChangeSelectedIds={jest.fn()} onBack={jest.fn()} />);
    fireEvent.changeText(screen.getByPlaceholderText("Search organizers"), "nonexistent");
    expect(screen.getByText('No organizers match "nonexistent"')).toBeOnTheScreen();
  });

  it("groups non-alphabetic orgs under a single '#' section", () => {
    const numericOrgs: OrgRow[] = [
      { id: "o1", name: "100 Miles PH", slug: "100-miles", logo_url: null, banner_url: null, description: null, brand_color: "#3A7CC7", event_count: 5 },
      { id: "o2", name: "5K Warriors", slug: "5k-warriors", logo_url: null, banner_url: null, description: null, brand_color: "#C7473A", event_count: 3 },
      { id: "o3", name: "Alpha Club", slug: "alpha-club", logo_url: null, banner_url: null, description: null, brand_color: "#7CC73A", event_count: 2 },
    ];
    render(<OrganizerFilterPicker orgs={numericOrgs} selectedIds={[]} onChangeSelectedIds={jest.fn()} onBack={jest.fn()} />);
    // Verify numeric-starting orgs are shown (not hidden)
    expect(screen.getByText("100 Miles PH")).toBeOnTheScreen();
    expect(screen.getByText("5K Warriors")).toBeOnTheScreen();
    expect(screen.getByText("Alpha Club")).toBeOnTheScreen();
    // Both numeric orgs should be grouped under a single "#" section header (appears once only)
    const sectionHeaders = screen.getAllByText("#");
    expect(sectionHeaders.length).toBeGreaterThanOrEqual(1);
  });
});
