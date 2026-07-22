import { render, screen, fireEvent } from "@testing-library/react-native";
import { PillSelect } from "../components/PillSelect";

describe("PillSelect", () => {
  it("renders the label + options and reports the pressed value", () => {
    const onChange = jest.fn();
    render(<PillSelect label="BLOOD TYPE" value="O+" options={["A+", "O+", "B+"]} onChange={onChange} />);
    expect(screen.getByText("BLOOD TYPE")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("B+"));
    expect(onChange).toHaveBeenCalledWith("B+");
  });
  it("marks the current value as selected", () => {
    render(<PillSelect label="SHIRT" value="M" options={["S", "M", "L"]} onChange={jest.fn()} />);
    // ToggleGroup type="single" renders each option as a radio in a radiogroup
    // (native single-select semantics), reporting selection via
    // accessibilityState.checked rather than the old ad-hoc
    // accessibilityRole="button" + accessibilityState.selected.
    expect(screen.getByRole("radio", { name: "M", checked: true })).toBeOnTheScreen();
    expect(screen.getByRole("radio", { name: "S", checked: false })).toBeOnTheScreen();
  });
});
