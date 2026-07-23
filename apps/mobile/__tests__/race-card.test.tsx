import { render, screen, fireEvent } from "@testing-library/react-native";
import { RaceCard } from "../components/RaceCard";

describe("RaceCard", () => {
  it("shows title, meta, distance and a status badge", () => {
    render(<RaceCard variant="registered" title="Kalatungan Skyrun" meta="21K · Oct 18" distanceKm={21} />);
    expect(screen.getByText("Kalatungan Skyrun")).toBeOnTheScreen();
    expect(screen.getByText("21K · Oct 18")).toBeOnTheScreen();
    expect(screen.getByText("21")).toBeOnTheScreen();
    expect(screen.getByText("Registered")).toBeOnTheScreen();
  });

  it("fires onPress when the card body is tapped", () => {
    const onPress = jest.fn();
    render(<RaceCard variant="completed" title="Mt. Apo Sky Race" distanceKm={50} onPress={onPress} />);
    expect(screen.getByText("Completed")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("Mt. Apo Sky Race"));
    expect(onPress).toHaveBeenCalled();
  });

  it("renders pay and cancel actions only for the unpaid variant", () => {
    const onPay = jest.fn();
    const onCancel = jest.fn();
    render(<RaceCard variant="unpaid" title="Sierra Madre Challenge" distanceKm={21} onPay={onPay} onCancel={onCancel} />);
    expect(screen.getByText("Unpaid")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("Complete payment"));
    fireEvent.press(screen.getByText("Cancel"));
    expect(onPay).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
  });

  it("shows a Refunded badge and no pay/cancel actions for the refunded variant", () => {
    render(<RaceCard variant="refunded" title="Cordillera Run" distanceKm={21} />);
    expect(screen.getByText("Refunded")).toBeOnTheScreen();
    expect(screen.queryByText("Complete payment")).toBeNull();
    expect(screen.queryByText("Cancel")).toBeNull();
  });
});
