import { render, screen } from "@testing-library/react-native";
import { Badge } from "../components/ui/badge";
import { Text } from "../components/ui/text";

describe("Badge new variants", () => {
  it("renders an unpaid badge", () => {
    render(<Badge variant="unpaid"><Text>Unpaid</Text></Badge>);
    expect(screen.getByText("Unpaid")).toBeOnTheScreen();
  });
  it("renders a refunded badge", () => {
    render(<Badge variant="refunded"><Text>Refunded</Text></Badge>);
    expect(screen.getByText("Refunded")).toBeOnTheScreen();
  });
});
