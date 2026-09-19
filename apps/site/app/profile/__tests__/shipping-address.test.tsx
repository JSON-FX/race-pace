import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShippingAddress } from "../ShippingAddress";
vi.mock("@/lib/psgc", () => ({
  usePsgcRegions: () => ({ data: [{ code: "r", name: "Sample region" }] }),
  usePsgcProvinces: () => ({ data: [{ code: "p", name: "Sample province" }] }),
  usePsgcCities: () => ({ data: [{ code: "c", name: "Sample city" }] }),
  usePsgcBarangays: () => ({ data: [{ code: "b", name: "Sample barangay" }] }),
}));
describe("Shipping address", () => {
  it("resets the stored barangay when an ancestor changes and preserves ZIP leading zeros", () => {
    const onChange = vi.fn(); render(<ShippingAddress values={{}} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Region *"), { target: { value: "r" } });
    expect(onChange).toHaveBeenLastCalledWith({ shipping_barangay_code: "" });
    fireEvent.change(screen.getByLabelText("City or municipality *"), { target: { value: "c" } });
    fireEvent.change(screen.getByLabelText("Barangay *"), { target: { value: "b" } });
    expect(onChange).toHaveBeenLastCalledWith({ shipping_barangay_code: "b" });
    fireEvent.change(screen.getByLabelText("ZIP code *"), { target: { value: "0123" } });
    expect(onChange).toHaveBeenLastCalledWith({ shipping_zip_code: "0123" });
    fireEvent.change(screen.getByLabelText("Province *"), { target: { value: "p" } });
    expect(screen.getByLabelText("City or municipality *")).toHaveValue("");
    expect(onChange).toHaveBeenLastCalledWith({ shipping_barangay_code: "" });
  });
  it("clears all address fields together", () => {
    const onChange = vi.fn(); render(<ShippingAddress values={{ shipping_zip_code: "0123" }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear shipping address" }));
    expect(onChange).toHaveBeenCalledWith({ shipping_barangay_code: "", shipping_zip_code: "", shipping_address_line: "" });
  });
});
