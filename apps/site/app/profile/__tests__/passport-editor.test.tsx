import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PassportEditor } from "../PassportEditor";
vi.mock("../ShippingAddress", () => ({ ShippingAddress: () => <div>Shipping address</div> }));
const api = vi.hoisted(() => ({ listPassports: vi.fn(), savePassport: vi.fn(), createManagedPassport: vi.fn() }));
vi.mock("@/lib/passports", () => api);
const own = { id: "self", claimed_user_id: "user", first_name: "Ana", last_name: "Cruz", gender: "Female", date_of_birth: "1950-01-01", contact_number: "09171234567", emergency_contact_name: "Juan", emergency_contact_number: "09181234567", emergency_contact_relationship: "Son", legacy_full_name: "Ana Cruz", shipping_barangay_code: "012801001", shipping_zip_code: "0123", shipping_address_line: "House 1, Sample Street" };
beforeEach(() => {
  vi.resetAllMocks(); api.listPassports.mockResolvedValue([own]); api.savePassport.mockResolvedValue(own);
});
describe("Passport editor", () => {
  it("shows split fields and verified account email without bib-name or obsolete gender choices", async () => {
    render(<PassportEditor userId="user" email="ana@example.com" />);
    expect(await screen.findByLabelText("First name *")).toHaveValue("Ana");
    expect(screen.getByLabelText("Last name *")).toHaveValue("Cruz");
    expect(screen.getByText("Account email")).toBeInTheDocument();
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
    expect(screen.queryByText("Bib name")).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Non-binary" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Emergency contact number *")).toHaveValue("+63 918 123 4567");
    expect(screen.getByLabelText("Relationship *")).toHaveValue("Son");
    expect(screen.getByRole("option", { name: "Caregiver" })).toBeInTheDocument();
  });
  it("blocks incomplete details and does not submit", async () => {
    render(<PassportEditor userId="user" />);
    fireEvent.change(await screen.findByLabelText("First name *"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save Passport" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("highlighted");
    expect(api.savePassport).not.toHaveBeenCalled();
  });
  it("saves the selected participant without changing the booking account", async () => {
    api.listPassports.mockResolvedValue([own, { ...own, id: "managed", claimed_user_id: null, first_name: "Lola" }]);
    api.savePassport.mockResolvedValue({ ...own, id: "managed", claimed_user_id: null });
    render(<PassportEditor userId="user" />);
    fireEvent.click(await screen.findByRole("button", { name: "Edit Lola Cruz" }));
    expect(screen.getByLabelText("Participant email")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Save Passport" }));
    await waitFor(() => expect(api.savePassport).toHaveBeenCalledWith("managed", expect.objectContaining({ first_name: "Lola" }), expect.any(String)));
    expect(await screen.findByRole("status")).toHaveTextContent("Passport saved");
  });
  it("reports load failures instead of silently rendering an empty Passport", async () => {
    api.listPassports.mockRejectedValue(new Error("Unable to connect"));
    render(<PassportEditor userId="user" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to connect");
  });
  it("formats both contact numbers as Philippine numbers while typing", async () => {
    render(<PassportEditor userId="user" />);
    const contact = await screen.findByLabelText("Contact number *");
    fireEvent.change(contact, { target: { value: "09175550142" } });
    expect(contact).toHaveValue("+63 917 555 0142");
    const emergency = screen.getByLabelText("Emergency contact number *");
    fireEvent.change(emergency, { target: { value: "639185550188" } });
    expect(emergency).toHaveValue("+63 918 555 0188");
  });
});
