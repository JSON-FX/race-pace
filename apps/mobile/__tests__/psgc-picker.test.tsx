import { render, screen, fireEvent, within } from "@testing-library/react-native";
import { PortalHost } from "@rn-primitives/portal";
import type { PsgcAddress } from "@race-pace/shared";

let mockRegions: any[] = [{ code: "r1", name: "Davao Region" }, { code: "r2", name: "Metro Manila" }];
let mockProvincesResult: any = {
  data: [{ code: "p1", name: "Davao del Sur" }, { code: "p2", name: "Davao Oriental" }],
  isSuccess: true,
};
let mockCities: any[] = [{ code: "c1", name: "Digos City" }, { code: "c2", name: "Bansalan" }];
let mockCityLookupResult: any = { data: undefined };

jest.mock("../lib/psgc", () => ({
  usePsgcRegions: () => ({ data: mockRegions }),
  usePsgcProvinces: () => mockProvincesResult,
  usePsgcCities: () => ({ data: mockCities, isSuccess: true }),
  usePsgcCity: () => mockCityLookupResult,
}));

import { PsgcAddressPicker } from "../components/PsgcAddressPicker";

// RNR's Select renders its dropdown content through a Portal — mount the same
// PortalHost app/_layout.tsx provides so opened content lands somewhere
// queryable. (jest.setup.ts patches the mocked View's shared `measure`
// method so a real fireEvent.press on the trigger reports a layout rect and
// the portal actually opens — see that file for why.)
function renderPicker(value: PsgcAddress | null = null, onChange = jest.fn()) {
  render(
    <>
      <PsgcAddressPicker value={value} onChange={onChange} label="LOCATION" />
      <PortalHost />
    </>
  );
  return onChange;
}

async function openAndPick(accessibilityLabel: string, itemText: string) {
  fireEvent.press(screen.getByLabelText(accessibilityLabel));
  fireEvent.press(await screen.findByText(itemText));
}

describe("PsgcAddressPicker", () => {
  beforeEach(() => {
    mockRegions = [{ code: "r1", name: "Davao Region" }, { code: "r2", name: "Metro Manila" }];
    mockProvincesResult = {
      data: [{ code: "p1", name: "Davao del Sur" }, { code: "p2", name: "Davao Oriental" }],
      isSuccess: true,
    };
    mockCities = [{ code: "c1", name: "Digos City" }, { code: "c2", name: "Bansalan" }];
    mockCityLookupResult = { data: undefined };
  });

  it("renders three dropdowns with only Region enabled until a value is picked", () => {
    renderPicker();
    expect(screen.getByLabelText("Region")).toBeOnTheScreen();
    expect(screen.getByLabelText("Region").props.accessibilityState.disabled).toBe(false);
    expect(screen.getByLabelText("Province").props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText("City").props.accessibilityState.disabled).toBe(true);
  });

  it("cascades region → province → city, only emitting onChange once a city is chosen", async () => {
    const onChange = renderPicker();

    await openAndPick("Region", "Davao Region");
    expect(onChange).not.toHaveBeenCalled();
    expect(within(screen.getByLabelText("Region")).getByText("Davao Region")).toBeOnTheScreen();
    expect(screen.getByLabelText("Province").props.accessibilityState.disabled).toBe(false);

    await openAndPick("Province", "Davao del Sur");
    expect(onChange).not.toHaveBeenCalled();
    expect(within(screen.getByLabelText("Province")).getByText("Davao del Sur")).toBeOnTheScreen();
    expect(screen.getByLabelText("City").props.accessibilityState.disabled).toBe(false);

    await openAndPick("City", "Digos City");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      city_psgc_code: "c1",
      city_name: "Digos City",
      province_name: "Davao del Sur",
      region_name: "Davao Region",
    });
  });

  it("clears City when Province changes, and clears Province + City when Region changes", async () => {
    renderPicker();
    await openAndPick("Region", "Davao Region");
    await openAndPick("Province", "Davao del Sur");
    await openAndPick("City", "Digos City");
    expect(within(screen.getByLabelText("City")).getByText("Digos City")).toBeOnTheScreen();

    await openAndPick("Province", "Davao Oriental");
    expect(within(screen.getByLabelText("City")).getByText("Select city or municipality")).toBeOnTheScreen();

    await openAndPick("City", "Bansalan");
    expect(within(screen.getByLabelText("City")).getByText("Bansalan")).toBeOnTheScreen();

    await openAndPick("Region", "Metro Manila");
    expect(within(screen.getByLabelText("Province")).getByText("Select province")).toBeOnTheScreen();
    expect(within(screen.getByLabelText("City")).getByText("Select city or municipality")).toBeOnTheScreen();
    expect(screen.getByLabelText("City").props.accessibilityState.disabled).toBe(true);
  });

  it("shows a disabled loading affordance on Province while provinces are loading", async () => {
    mockProvincesResult = { data: undefined, isSuccess: false, isLoading: true };
    renderPicker();

    fireEvent.press(screen.getByLabelText("Region"));
    fireEvent.press(await screen.findByText("Davao Region"));

    const provinceTrigger = screen.getByLabelText("Province");
    expect(provinceTrigger.props.accessibilityState.disabled).toBe(true);
    expect(within(provinceTrigger).getByText("Loading…")).toBeOnTheScreen();
  });

  it("skips Province for a region with no provinces (NCR) and emits province_name: null", async () => {
    mockProvincesResult = { data: [], isSuccess: true };
    const onChange = renderPicker();

    await openAndPick("Region", "Davao Region");
    expect(screen.queryByLabelText("Province")).toBeNull();

    const cityTrigger = screen.getByLabelText("City");
    expect(cityTrigger.props.accessibilityState.disabled).toBe(false);

    await openAndPick("City", "Digos City");
    expect(onChange).toHaveBeenCalledWith({
      city_psgc_code: "c1",
      city_name: "Digos City",
      province_name: null,
      region_name: "Davao Region",
    });
  });

  it("seeds region, province, and city from an existing value", async () => {
    mockCityLookupResult = { data: { code: "c1", name: "Digos City", province_code: "p1", region_code: "r1" } };
    renderPicker({
      city_psgc_code: "c1",
      city_name: "Digos City",
      province_name: "Davao del Sur",
      region_name: "Davao Region",
    });

    expect(within(screen.getByLabelText("City")).getByText("Digos City")).toBeOnTheScreen();
    expect(await within(screen.getByLabelText("Region")).findByText("Davao Region")).toBeOnTheScreen();
    expect(await within(screen.getByLabelText("Province")).findByText("Davao del Sur")).toBeOnTheScreen();
  });

  it("seeds a City with no province (NCR) without rendering a Province dropdown", async () => {
    mockProvincesResult = { data: [], isSuccess: true };
    mockCityLookupResult = { data: { code: "c9", name: "Manila", province_code: null, region_code: "r2" } };
    renderPicker({
      city_psgc_code: "c9",
      city_name: "Manila",
      province_name: null,
      region_name: "Metro Manila",
    });

    expect(within(screen.getByLabelText("City")).getByText("Manila")).toBeOnTheScreen();
    expect(await within(screen.getByLabelText("Region")).findByText("Metro Manila")).toBeOnTheScreen();
    expect(screen.queryByLabelText("Province")).toBeNull();
  });

  it("wraps a long city list in a bounded, scrollable container", async () => {
    mockCities = Array.from({ length: 40 }, (_, i) => ({ code: `c${i}`, name: `City ${i}` }));
    renderPicker();
    await openAndPick("Region", "Davao Region");
    await openAndPick("Province", "Davao del Sur");

    fireEvent.press(screen.getByLabelText("City"));
    expect(await screen.findByText("City 39")).toBeOnTheScreen();
    const scroller = screen.getByTestId("select-native-scroll");
    expect(scroller.props.style).toMatchObject({ maxHeight: expect.any(Number) });
  });
});
