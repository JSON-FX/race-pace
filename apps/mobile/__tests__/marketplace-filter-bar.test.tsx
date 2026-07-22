import { render, screen, fireEvent } from "@testing-library/react-native";
import { MarketplaceFilterBar } from "../components/MarketplaceFilterBar";

describe("MarketplaceFilterBar", () => {
  it("reports the picked date segment", () => {
    const onDateSegmentChange = jest.fn();
    render(<MarketplaceFilterBar dateSegment="all" onDateSegmentChange={onDateSegmentChange} activeFilterCount={0} onPressMoreFilters={jest.fn()} />);
    fireEvent.press(screen.getByRole("radio", { name: "This month" }));
    expect(onDateSegmentChange).toHaveBeenCalledWith("month");
  });

  it("marks the active segment as checked", () => {
    render(<MarketplaceFilterBar dateSegment="week" onDateSegmentChange={jest.fn()} activeFilterCount={0} onPressMoreFilters={jest.fn()} />);
    expect(screen.getByRole("radio", { name: "This week", checked: true })).toBeOnTheScreen();
    expect(screen.getByRole("radio", { name: "All", checked: false })).toBeOnTheScreen();
  });

  it("shows the active filter count badge only when filters are applied", () => {
    const { rerender } = render(<MarketplaceFilterBar dateSegment="all" onDateSegmentChange={jest.fn()} activeFilterCount={0} onPressMoreFilters={jest.fn()} />);
    expect(screen.queryByText("2")).toBeNull();
    rerender(<MarketplaceFilterBar dateSegment="all" onDateSegmentChange={jest.fn()} activeFilterCount={2} onPressMoreFilters={jest.fn()} />);
    expect(screen.getByText("2")).toBeOnTheScreen();
  });

  it("opens the filter sheet on press", () => {
    const onPressMoreFilters = jest.fn();
    render(<MarketplaceFilterBar dateSegment="all" onDateSegmentChange={jest.fn()} activeFilterCount={0} onPressMoreFilters={onPressMoreFilters} />);
    fireEvent.press(screen.getByLabelText("More filters"));
    expect(onPressMoreFilters).toHaveBeenCalled();
  });
});
