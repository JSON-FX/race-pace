import { render, screen, fireEvent } from "@testing-library/react-native";
import { PortalHost } from "@rn-primitives/portal";

let mockRegions: any[] = [{ code: "r1", name: "Davao Region" }, { code: "r2", name: "Metro Manila" }];
let mockProvincesResult: any = { data: [{ code: "p1", name: "Davao del Sur" }], isSuccess: true };
let mockCities: any[] = [{ code: "c1", name: "Digos City" }];

jest.mock("../lib/psgc", () => ({
  usePsgcRegions: () => ({ data: mockRegions }),
  usePsgcProvinces: () => mockProvincesResult,
  usePsgcCities: () => ({ data: mockCities, isSuccess: true }),
}));

import { RegionFilterPicker } from "../components/RegionFilterPicker";

function renderPicker(onChange = jest.fn()) {
  render(
    <>
      <RegionFilterPicker onChange={onChange} />
      <PortalHost />
    </>
  );
  return onChange;
}

async function openAndPick(label: string, text: string) {
  fireEvent.press(screen.getByLabelText(label));
  fireEvent.press(await screen.findByText(text));
}

describe("RegionFilterPicker", () => {
  beforeEach(() => {
    mockRegions = [{ code: "r1", name: "Davao Region" }, { code: "r2", name: "Metro Manila" }];
    mockProvincesResult = { data: [{ code: "p1", name: "Davao del Sur" }], isSuccess: true };
    mockCities = [{ code: "c1", name: "Digos City" }];
  });

  it("emits region-only as soon as a region is picked, unlike PsgcAddressPicker", async () => {
    const onChange = renderPicker();
    await openAndPick("Region", "Davao Region");
    expect(onChange).toHaveBeenCalledWith({ region_name: "Davao Region" });
  });

  it("narrows to region + province when a province is picked", async () => {
    const onChange = renderPicker();
    await openAndPick("Region", "Davao Region");
    await openAndPick("Province", "Davao del Sur");
    expect(onChange).toHaveBeenLastCalledWith({ region_name: "Davao Region", province_name: "Davao del Sur" });
  });

  it("narrows to region + province + city when a city is picked", async () => {
    const onChange = renderPicker();
    await openAndPick("Region", "Davao Region");
    await openAndPick("Province", "Davao del Sur");
    await openAndPick("City", "Digos City");
    expect(onChange).toHaveBeenLastCalledWith({ region_name: "Davao Region", province_name: "Davao del Sur", city_name: "Digos City" });
  });

  it("skips Province for a region with no provinces (NCR) and enables City immediately", async () => {
    mockProvincesResult = { data: [], isSuccess: true };
    renderPicker();
    await openAndPick("Region", "Metro Manila");
    expect(screen.queryByLabelText("Province")).toBeNull();
    expect(screen.getByLabelText("City").props.accessibilityState.disabled).toBe(false);
  });
});
