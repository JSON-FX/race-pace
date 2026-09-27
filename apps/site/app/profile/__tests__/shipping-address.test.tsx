import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ShippingAddress } from "../ShippingAddress";
vi.mock("@/lib/psgc", () => ({
  usePsgcRegions: () => ({ data: [{ code: "r", name: "Sample region" }] }),
  usePsgcProvinces: () => ({ data: [{ code: "p", name: "Sample province" }] }),
  usePsgcCities: () => ({ data: [{ code: "c", name: "Sample city" }] }),
  usePsgcBarangays: () => ({ data: [{ code: "b", name: "Sample barangay" }] }),
}));
describe("Shipping address", () => {
  it("resets the stored barangay when an ancestor changes and preserves ZIP leading zeros", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn(); render(<ShippingAddress values={{}} onChange={onChange} />);
    await user.click(screen.getByRole("combobox", { name: "Region" }));
    await user.click(screen.getByRole("option", { name: "Sample region" }));
    expect(onChange).toHaveBeenLastCalledWith({ shipping_barangay_code: "" });
    await user.click(screen.getByRole("combobox", { name: "City or municipality" }));
    await user.click(screen.getByRole("option", { name: "Sample city" }));
    await user.click(screen.getByRole("combobox", { name: "Barangay" }));
    await user.click(screen.getByRole("option", { name: "Sample barangay" }));
    expect(onChange).toHaveBeenLastCalledWith({ shipping_barangay_code: "b" });
    fireEvent.change(screen.getByLabelText("ZIP code *"), { target: { value: "0123" } });
    expect(onChange).toHaveBeenLastCalledWith({ shipping_zip_code: "0123" });
    await user.click(screen.getByRole("combobox", { name: "Province" }));
    await user.click(screen.getByRole("option", { name: "Sample province" }));
    expect(screen.getByRole("combobox", { name: "City or municipality" })).toHaveTextContent("Select city or municipality");
    expect(onChange).toHaveBeenLastCalledWith({ shipping_barangay_code: "" });
  });
  it("clears all address fields together", () => {
    const onChange = vi.fn(); render(<ShippingAddress values={{ shipping_zip_code: "0123" }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear shipping address" }));
    expect(onChange).toHaveBeenCalledWith({ shipping_barangay_code: "", shipping_zip_code: "", shipping_address_line: "" });
  });
});
