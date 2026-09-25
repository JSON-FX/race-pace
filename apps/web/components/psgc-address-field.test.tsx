import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { PsgcAddressField } from "./PsgcAddressField";
import type { PsgcAddress } from "@race-pace/shared";

let regions: { data: { code: string; name: string }[] | undefined };
let provinces: { data: { code: string; name: string }[] | undefined; isSuccess: boolean };
let cities: { data: { code: string; name: string }[] | undefined };
let cityLookup: { data: { code: string; name: string; province_code: string | null; region_code: string } | null };
vi.mock("../lib/psgc", () => ({
  usePsgcRegions: () => regions,
  usePsgcProvinces: () => provinces,
  usePsgcCities: () => cities,
  usePsgcCity: () => cityLookup,
}));

beforeEach(() => {
  regions = { data: [{ code: "13", name: "Davao Region" }] };
  provinces = { data: [{ code: "1324", name: "Davao del Sur" }], isSuccess: true };
  cities = { data: [{ code: "112603", name: "City of Digos" }] };
  cityLookup = { data: null };
});

it("cascades region → province → city and emits the address progressively", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<PsgcAddressField value={null} onChange={onChange} />);

  await user.click(screen.getByLabelText("Region"));
  await user.click(await screen.findByRole("option", { name: "Davao Region" }));
  expect(onChange).toHaveBeenLastCalledWith({ city_psgc_code: null, city_name: null, province_name: null, region_name: "Davao Region" });

  await user.click(screen.getByLabelText("Province"));
  await user.click(await screen.findByRole("option", { name: "Davao del Sur" }));
  expect(onChange).toHaveBeenLastCalledWith({ city_psgc_code: null, city_name: null, province_name: "Davao del Sur", region_name: "Davao Region" });

  await user.click(screen.getByLabelText("City"));
  await user.click(await screen.findByRole("option", { name: "City of Digos" }));
  expect(onChange).toHaveBeenLastCalledWith({ city_psgc_code: "112603", city_name: "City of Digos", province_name: "Davao del Sur", region_name: "Davao Region" });
});

it("skips province for a region with no provinces and filters city by region", async () => {
  provinces = { data: [], isSuccess: true };
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<PsgcAddressField value={null} onChange={onChange} />);

  await user.click(screen.getByLabelText("Region"));
  await user.click(await screen.findByRole("option", { name: "Davao Region" }));
  expect(screen.getByLabelText("Province")).toBeDisabled();

  await user.click(screen.getByLabelText("City"));
  await user.click(await screen.findByRole("option", { name: "City of Digos" }));
  expect(onChange).toHaveBeenLastCalledWith({ city_psgc_code: "112603", city_name: "City of Digos", province_name: null, region_name: "Davao Region" });
});

it("clears a selected region back to no address, same as the old empty option", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<PsgcAddressField value={null} onChange={onChange} />);

  await user.click(screen.getByLabelText("Region"));
  await user.click(await screen.findByRole("option", { name: "Davao Region" }));
  expect(onChange).toHaveBeenLastCalledWith({ city_psgc_code: null, city_name: null, province_name: null, region_name: "Davao Region" });

  await user.click(screen.getByLabelText("Region"));
  await user.click(await screen.findByRole("option", { name: "— None —" }));
  expect(onChange).toHaveBeenLastCalledWith({ city_psgc_code: null, city_name: null, province_name: null, region_name: null });
});

it("clears a selected city, keeping the region/province, same as the old empty option", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<PsgcAddressField value={null} onChange={onChange} />);

  await user.click(screen.getByLabelText("Region"));
  await user.click(await screen.findByRole("option", { name: "Davao Region" }));
  await user.click(screen.getByLabelText("Province"));
  await user.click(await screen.findByRole("option", { name: "Davao del Sur" }));
  await user.click(screen.getByLabelText("City"));
  await user.click(await screen.findByRole("option", { name: "City of Digos" }));
  expect(onChange).toHaveBeenLastCalledWith({ city_psgc_code: "112603", city_name: "City of Digos", province_name: "Davao del Sur", region_name: "Davao Region" });

  await user.click(screen.getByLabelText("City"));
  await user.click(await screen.findByRole("option", { name: "— None —" }));
  expect(onChange).toHaveBeenLastCalledWith({ city_psgc_code: null, city_name: null, province_name: "Davao del Sur", region_name: "Davao Region" });
});

it("pre-selects region/province/city from a stored city code (edit-seed)", async () => {
  cityLookup = { data: { code: "112603", name: "City of Digos", province_code: "1324", region_code: "13" } };
  const onChange = vi.fn();
  render(<PsgcAddressField value={{ city_psgc_code: "112603", city_name: "City of Digos", province_name: "Davao del Sur", region_name: "Davao Region" }} onChange={onChange} />);
  expect(await screen.findByText("Davao Region")).toBeInTheDocument();
  expect(screen.getByText("Davao del Sur")).toBeInTheDocument();
  expect(screen.getByText("City of Digos")).toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});

it("keeps a stored city while the edit-seed lookup resolves", async () => {
  regions = { data: undefined };
  provinces = { data: undefined, isSuccess: false };
  cities = { data: undefined };
  const saved: PsgcAddress = {
    city_psgc_code: "112603", city_name: "City of Digos",
    province_name: "Davao del Sur", region_name: "Davao Region",
  };
  function ControlledAddress() {
    const [value, setValue] = useState(saved);
    return <>
      <input type="hidden" data-testid="stored-city" value={value.city_psgc_code ?? ""} readOnly />
      <PsgcAddressField value={value} onChange={setValue} />
    </>;
  }

  const { rerender } = render(<ControlledAddress />);
  expect(screen.getByTestId("stored-city")).toHaveValue("112603");
  regions = { data: [{ code: "13", name: "Davao Region" }] };
  rerender(<ControlledAddress />);
  cityLookup = { data: { code: "112603", name: "City of Digos", province_code: "1324", region_code: "13" } };
  rerender(<ControlledAddress />);
  provinces = { data: [{ code: "1324", name: "Davao del Sur" }], isSuccess: true };
  cities = { data: [{ code: "112603", name: "City of Digos" }] };
  rerender(<ControlledAddress />);

  expect(await screen.findByText("Davao Region")).toBeInTheDocument();
  expect(screen.getByTestId("stored-city")).toHaveValue("112603");
  expect(screen.getByLabelText("Province")).toHaveTextContent("Davao del Sur");
  expect(screen.getByLabelText("City")).toHaveTextContent("City of Digos");
});
