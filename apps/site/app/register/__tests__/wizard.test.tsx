import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RegisterWizard } from "../[categoryId]/RegisterWizard";
import type { CategoryRow, AddonRow, FormFieldRow, EventRow } from "@/lib/events";

const category: CategoryRow = {
  id: "c1", event_id: "e1", org_id: "a1", code: "100k", label: "100K",
  distance_km: 100, base_price: 250000, slots_total: 100, slots_taken: 10,
};

const event = { id: "e1", name: "Apo Sky Ultra 2026", event_date: "2026-11-14", end_date: null, org_name: "Race Pace" } as EventRow;
const addons: AddonRow[] = [{ id: "ad1", name: "Finisher shirt", price: 45000 }];
const fields: FormFieldRow[] = [
  { id: "f1", key: "shirt_size", label: "Shirt size", type: "select", required: true, options: ["S", "M", "L"], sort_order: 1 },
  { id: "f2", key: "club", label: "Running club", type: "text", required: false, options: null, sort_order: 2 },
];

const startCheckout = vi.fn();
vi.mock("@/lib/registration", () => ({
  startCheckout: (...a: unknown[]) => startCheckout(...a),
}));
vi.mock("@/lib/profile", () => ({
  getProfile: vi.fn().mockResolvedValue(null),
  upsertProfile: vi.fn().mockResolvedValue({}),
}));

beforeEach(() => {
  sessionStorage.clear();
  startCheckout.mockReset();
  startCheckout.mockResolvedValue({ registration_id: "r1", checkout_url: "https://checkout.paymongo.com/x" });
});

function renderWizard() {
  return render(
    <RegisterWizard userId="u1" category={category} event={event} addons={addons} formFields={fields} />,
  );
}

describe("RegisterWizard", () => {
  it("starts on step 1 with the entry fee shown", () => {
    renderWizard();
    expect(screen.getByText("Your details")).toBeInTheDocument();
    expect(screen.getByText("₱2,500.00")).toBeInTheDocument();
  });

  it("blocks advancing past step 1 while a required detail is empty", async () => {
    renderWizard();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findAllByText("This is required.")).not.toHaveLength(0);
    expect(screen.getByText("Your details")).toBeInTheDocument();
  });

  it("adds a selected add-on to the total", async () => {
    renderWizard();
    await userEvent.type(screen.getByLabelText(/Bib name/), "JUAN");
    await userEvent.type(screen.getByLabelText(/Date of birth/), "1990-01-01");
    await userEvent.type(screen.getByLabelText(/Emergency contact/), "Maria 09171234567");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    await userEvent.click(screen.getByRole("button", { name: "Finisher shirt" }));
    expect(screen.getByText("₱2,950.00")).toBeInTheDocument();
  });

  it("refuses to submit without the waiver accepted", async () => {
    renderWizard();
    await userEvent.type(screen.getByLabelText(/Bib name/), "JUAN");
    await userEvent.type(screen.getByLabelText(/Date of birth/), "1990-01-01");
    await userEvent.type(screen.getByLabelText(/Emergency contact/), "Maria 09171234567");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(screen.getByRole("button", { name: "M" }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    await userEvent.click(screen.getByRole("button", { name: /Register/ }));
    expect(startCheckout).not.toHaveBeenCalled();
  });

  it("persists the draft so a remount resumes the same step", async () => {
    const { unmount } = renderWizard();
    await userEvent.type(screen.getByLabelText(/Bib name/), "JUAN");
    await userEvent.type(screen.getByLabelText(/Date of birth/), "1990-01-01");
    await userEvent.type(screen.getByLabelText(/Emergency contact/), "Maria 09171234567");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    unmount();

    renderWizard();
    expect(await screen.findByText("Kit & extras")).toBeInTheDocument();
  });

  // Guards the duplicate-registration bug from Task 7.
  it("reuses the persisted idempotency key after a remount", async () => {
    const { unmount } = renderWizard();
    await userEvent.type(screen.getByLabelText(/Bib name/), "JUAN");
    const keyBefore = JSON.parse(sessionStorage.getItem("rp:draft:c1")!).idempotencyKey;
    unmount();

    renderWizard();
    const keyAfter = JSON.parse(sessionStorage.getItem("rp:draft:c1")!).idempotencyKey;
    expect(keyAfter).toBe(keyBefore);
  });

  // Regression: a required `gender` field is rendered on step 1, but the
  // required-profile-key check used to run entirely on step 2 — where step 1's
  // gender error has no field to attach to. Continue would silently no-op,
  // dead-ending the runner with no visible error and no way forward but Back.
  it("blocks advancing past step 1 with a visible error when required gender is empty", async () => {
    const fieldsWithGender: FormFieldRow[] = [
      ...fields,
      { id: "f3", key: "gender", label: "Gender", type: "select", required: true, options: ["Male", "Female", "Non-binary", "Prefer not to say"], sort_order: 3 },
    ];
    render(
      <RegisterWizard userId="u1" category={category} event={event} addons={addons} formFields={fieldsWithGender} />,
    );

    await userEvent.type(screen.getByLabelText(/Bib name/), "JUAN");
    await userEvent.type(screen.getByLabelText(/Date of birth/), "1990-01-01");
    await userEvent.type(screen.getByLabelText(/Emergency contact/), "Maria 09171234567");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    // Still on step 1, and the error is visible on the field the runner can see.
    expect(screen.getByText("Your details")).toBeInTheDocument();
    expect(await screen.findByText("This is required.")).toBeInTheDocument();

    // Selecting a gender clears the error and lets the runner advance.
    await userEvent.click(screen.getByRole("button", { name: "Male" }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Kit & extras")).toBeInTheDocument();
  });
});
