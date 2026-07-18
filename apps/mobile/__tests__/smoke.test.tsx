import { render } from "@testing-library/react-native";
import { Text } from "react-native";

describe("harness", () => {
  it("renders", () => {
    const { getByText } = render(<Text>hello trail-ultra</Text>);
    expect(getByText("hello trail-ultra")).toBeOnTheScreen();
  });
});
