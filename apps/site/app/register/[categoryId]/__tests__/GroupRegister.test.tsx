import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CategoryRow, EventRow } from "@/lib/events";
import { GroupRegister, type GroupPassport } from "../GroupRegister";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
const reserve = vi.fn();
vi.mock("@/lib/groupCheckout", async original => ({ ...await original<typeof import("@/lib/groupCheckout")>(), reserveGroup: (...args: unknown[]) => reserve(...args) }));

const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
const passports: GroupPassport[] = ids.map((id, index) => ({
  id, claimed_user_id: index === 0 ? "booker" : null, first_name: index === 0 ? "Ava" : "Lola", last_name: "Runner",
  shirt_size: null, blood_type: null, team_name: null, date_of_birth: "1950-06-01", gender: "Female",
  contact_number: "09171234567", emergency_contact_name: "Family", emergency_contact_number: "09181234567",
  emergency_contact_relationship: "Child", shipping_barangay_code: null, shipping_zip_code: null, shipping_address_line: null,
}));
const category = { id: "00000000-0000-4000-8000-000000000003", event_id: "00000000-0000-4000-8000-000000000004", org_id: "o", label: "14K", code: "14k", distance_km: 14, base_price: 10000, slots_total: 10, slots_taken: 0 } satisfies CategoryRow;
const event = { id: category.event_id, org_id: "o", name: "QA Race", status: "open", event_date: "2099-01-01" } as EventRow;
const waiver = { id: "00000000-0000-4000-8000-000000000005", title: "Test waiver", body: "Test only" };

beforeEach(() => { reserve.mockReset(); replace.mockReset(); sessionStorage.clear(); });

describe("GroupRegister", () => {
  it("requires each selected participant's own waiver acceptance and reserves one order", async () => {
    reserve.mockResolvedValue({ order_id: "order-1", status: "pending" });
    render(<GroupRegister userId="booker" category={category} event={event} passports={passports} addons={[]} fields={[]} waiver={waiver} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Reserve 0 places" })).toBeDisabled());
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ava Runner" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Lola Runner" }));
    expect(screen.getByText("Entry and add-ons: ₱200.00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reserve 2 places" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("participant acceptance required");
    fireEvent.click(screen.getByRole("checkbox", { name: "Ava Runner accepts waiver" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Lola Runner accepts waiver" }));
    fireEvent.click(screen.getByRole("button", { name: "Reserve 2 places" }));
    await waitFor(() => expect(reserve).toHaveBeenCalledOnce());
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({
      participants: expect.arrayContaining([
        expect.objectContaining({ participant_passport_id: ids[0], waiver_acceptance_method: "signed_in_self" }),
        expect.objectContaining({ participant_passport_id: ids[1], waiver_acceptance_method: "participant_on_helper_device" }),
      ]),
    }));
    expect(replace).toHaveBeenCalledWith("/group/order/order-1");
  });

  it("blocks an incomplete guest and does not reserve", async () => {
    render(<GroupRegister userId="booker" category={category} event={event} passports={[{ ...passports[1], contact_number: null }]} addons={[]} fields={[]} waiver={waiver} />);
    expect(screen.getByText("Complete this Race Passport before booking.")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Lola Runner" })).toBeDisabled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it("blocks a group larger than the visible remaining capacity", async () => {
    render(<GroupRegister userId="booker" category={{ ...category, slots_total: 1 }} event={event} passports={passports} addons={[]} fields={[]} waiver={waiver} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ava Runner" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Lola Runner" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Ava Runner accepts waiver" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Lola Runner accepts waiver" }));
    fireEvent.click(screen.getByRole("button", { name: "Reserve 2 places" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("insufficient visible slots");
    expect(reserve).not.toHaveBeenCalled();
  });
});
