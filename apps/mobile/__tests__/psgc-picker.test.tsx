import { render, screen, fireEvent } from "@testing-library/react-native";

let regions: any[] = [{ code: "r1", name: "Davao Region" }];
let mockProvincesResult: any = { data: [{ code: "p1", name: "Davao del Sur" }], isSuccess: true };
let cities: any[] = [{ code: "c1", name: "Digos City" }, { code: "c2", name: "Bansalan" }];
jest.mock("../lib/psgc", () => ({
  usePsgcRegions: () => ({ data: regions }),
  usePsgcProvinces: () => mockProvincesResult,
  usePsgcCities: () => ({ data: cities }),
}));

import { PsgcAddressPicker } from "../components/PsgcAddressPicker";

describe("PsgcAddressPicker", () => {
  beforeEach(() => {
    mockProvincesResult = { data: [{ code: "p1", name: "Davao del Sur" }], isSuccess: true };
  });

  it("cascades region → province → city and emits the address", async () => {
    const onChange = jest.fn();
    render(<PsgcAddressPicker value={null} onChange={onChange} label="LOCATION" />);
    fireEvent.press(screen.getByLabelText("LOCATION"));                 // open
    fireEvent.press(screen.getByText("Davao Region"));                  // region
    fireEvent.press(await screen.findByText("Davao del Sur"));          // province
    fireEvent.press(await screen.findByText("Digos City"));             // city
    expect(onChange).toHaveBeenCalledWith({
      city_psgc_code: "c1", city_name: "Digos City", province_name: "Davao del Sur", region_name: "Davao Region",
    });
  });

  it("shows the current value via formatAddress", () => {
    render(<PsgcAddressPicker label="LOCATION" onChange={jest.fn()}
      value={{ city_psgc_code: "c1", city_name: "Digos City", province_name: "Davao del Sur", region_name: "Davao Region" }} />);
    expect(screen.getByText("Digos City, Davao del Sur")).toBeOnTheScreen();
  });

  it("shows a loading affordance instead of the City step while provinces are still loading", async () => {
    mockProvincesResult = { data: undefined, isSuccess: false, isLoading: true };
    render(<PsgcAddressPicker value={null} onChange={jest.fn()} label="LOCATION" />);
    fireEvent.press(screen.getByLabelText("LOCATION"));                 // open
    fireEvent.press(screen.getByText("Davao Region"));                  // region — provinces still loading
    expect(await screen.findByLabelText("Loading")).toBeOnTheScreen();
    expect(screen.queryByText("Digos City")).toBeNull();
  });

  it("skips the Province step for a region with no provinces (NCR) once resolved", async () => {
    mockProvincesResult = { data: [], isSuccess: true };
    render(<PsgcAddressPicker value={null} onChange={jest.fn()} label="LOCATION" />);
    fireEvent.press(screen.getByLabelText("LOCATION"));                 // open
    fireEvent.press(screen.getByText("Davao Region"));                  // region — resolved empty (NCR)
    expect(await screen.findByText("Digos City")).toBeOnTheScreen();
    expect(screen.queryByText("Province")).toBeNull();
  });
});
