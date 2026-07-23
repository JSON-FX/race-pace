import { render, screen, fireEvent } from "@testing-library/react-native";
import { PillMultiSelect } from "../components/PillMultiSelect";

describe("PillMultiSelect", () => {
  it("renders the label and options", () => {
    render(<PillMultiSelect label="DISTANCE" value={[]} options={["5k", "21k"]} labels={{ "5k": "5K", "21k": "21K" }} onChange={jest.fn()} />);
    expect(screen.getByText("DISTANCE")).toBeOnTheScreen();
    expect(screen.getByText("5K")).toBeOnTheScreen();
    expect(screen.getByText("21K")).toBeOnTheScreen();
  });

  it("adds a pill to the selection when pressed", () => {
    const onChange = jest.fn();
    render(<PillMultiSelect label="DISTANCE" value={["21k"]} options={["5k", "21k", "42k"]} labels={{ "5k": "5K", "21k": "21K", "42k": "42K" }} onChange={onChange} />);
    fireEvent.press(screen.getByText("42K"));
    expect(onChange).toHaveBeenCalledWith(["21k", "42k"]);
  });

  it("removes a pill from the selection when its active pill is pressed again", () => {
    const onChange = jest.fn();
    render(<PillMultiSelect label="DISTANCE" value={["21k", "42k"]} options={["5k", "21k", "42k"]} labels={{ "5k": "5K", "21k": "21K", "42k": "42K" }} onChange={onChange} />);
    fireEvent.press(screen.getByText("21K"));
    expect(onChange).toHaveBeenCalledWith(["42k"]);
  });

  it("marks each selected value as checked", () => {
    render(<PillMultiSelect label="DISTANCE" value={["21k"]} options={["5k", "21k"]} labels={{ "5k": "5K", "21k": "21K" }} onChange={jest.fn()} />);
    expect(screen.getByRole("checkbox", { name: "21K", checked: true })).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: "5K", checked: false })).toBeOnTheScreen();
  });
});
