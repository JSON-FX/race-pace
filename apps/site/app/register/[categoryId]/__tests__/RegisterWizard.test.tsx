import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CategoryRow, AddonRow, FormFieldRow, EventRow } from "@/lib/events";
import { getProfile, upsertProfile } from "@/lib/profile";
import { CheckoutError } from "@/lib/registration";
import { RegisterWizard } from "../RegisterWizard";

// Fix round: startCheckout used to throw a bare Error, discarding the
// registration_id registrations-checkout's already_registered 409 carries —
// so a runner who lost a race with another device/tab, or whose event-page
// gate was just stale, landed on a generic "Something went wrong" message and
// a dead-ended, completed three-step form instead of being routed to finish
// paying for the entry that already exists. Mirrors
// apps/mobile/app/register/[categoryId].tsx's handling of the same 409.
const mockReplace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mockReplace }) }));

const startCheckoutMock = vi.fn();
vi.mock("@/lib/registration", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/registration")>();
  return { ...actual, startCheckout: (...args: unknown[]) => startCheckoutMock(...args) };
});

vi.mock("@/lib/profile", () => ({
  getProfile: vi.fn().mockResolvedValue(null),
  upsertProfile: vi.fn().mockResolvedValue({}),
}));

const category: CategoryRow = {
  id: "cat1", event_id: "ev1", org_id: "org1", code: "21k", label: "21K",
  distance_km: 21, base_price: 150000, slots_total: 100, slots_taken: 10,
};
const event: EventRow = {
  id: "ev1", org_id: "org1", name: "Test Race", slug: "test-race", place: null, region: null,
  event_date: "2099-01-01", end_date: null, elevation_gain_m: null,
  cutoff_hours: null, status: "open", hero_image_url: null, description: null,
  gallery: [], original_date: null, status_note: null,
  city_psgc_code: null, region_name: null, province_name: null,
  city_name: null, venue: null, joined_count: 0, distances: [21],
  registration_closes_at: null,
};
const addons: AddonRow[] = [];
const formFields: FormFieldRow[] = [];
const shipping = { shipping_barangay_code: "012801001", shipping_zip_code: "0123", shipping_address_line: "House 1, Sample Street" };

function renderWizard() {
  return render(
    <RegisterWizard userId="u1" category={category} event={event} addons={addons} formFields={formFields} />,
  );
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>, saveProfile = false) {
  await user.type(screen.getByLabelText(/Full name/), "QA Runner");
  await user.type(screen.getByLabelText(/Bib name/), "Runner One");
  fireEvent.change(screen.getByLabelText(/Date of birth/), { target: { value: "1990-01-01" } });
  await user.type(screen.getByLabelText(/Emergency contact/), "Mom · 0917 000 0000");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  if (saveProfile) await user.click(screen.getByLabelText("Save these details to my profile"));
  await user.click(await screen.findByRole("button", { name: "Continue" }));
  await user.click(screen.getByRole("checkbox"));
  await user.click(await screen.findByRole("button", { name: /Continue to payment/ }));
}

beforeEach(() => {
  vi.mocked(getProfile).mockReset().mockResolvedValue(null);
  vi.mocked(upsertProfile).mockClear();
  mockReplace.mockReset();
  startCheckoutMock.mockReset();
  window.sessionStorage.clear();
});

describe("RegisterWizard — already_registered 409", () => {
  it("shows the saved runner avatar and keeps initials as the missing-photo fallback", async () => {
    const passport = { first_name: "QA", last_name: "Runner", date_of_birth: "1990-01-01", gender: "Female" as const,
      contact_number: "09171234567", emergency_contact_name: "Contact", emergency_contact_number: "09171234567",
      emergency_contact_relationship: "Friend", ...shipping };
    vi.mocked(getProfile).mockResolvedValueOnce({ id: "u1", full_name: "QA Runner", bib_name: null, city: null,
      avatar_url: "https://cdn.test/avatar.png#c=10,10,80,80" });
    const { unmount } = render(<RegisterWizard userId="u1" category={category} event={event} addons={addons} formFields={formFields} passport={passport} />);
    expect(await screen.findByRole("img", { name: "QA Runner's profile photo" })).toHaveAttribute("src", "https://cdn.test/avatar.png");
    unmount();
    render(<RegisterWizard userId="u1" category={category} event={event} addons={addons} formFields={formFields} passport={passport} />);
    expect(screen.getByText("QR", { selector: "span[aria-hidden=true]" })).toBeInTheDocument();
  });
  it("keeps the advertised total fixed when both fees are deducted from the organizer payout", () => {
    const passport = { first_name: "QA", last_name: "Runner", date_of_birth: "1990-01-01", gender: "Female" as const,
      contact_number: "09171234567", emergency_contact_name: "Contact", emergency_contact_number: "09171234567",
      emergency_contact_relationship: "Friend", ...shipping };
    render(<RegisterWizard userId="u1" category={category} event={{ ...event, feeMode: "absorb", commissionTerms: {
      commission_type: "percent", commission_rate: 0.03, commission_flat_cents: 0,
    } }} addons={addons} formFields={formFields} passport={passport} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Total to pay").closest("div")).toHaveTextContent("₱1,500.00");
    expect(screen.getByText(/This price includes ₱45.00 in Taxes and fees/)).toBeInTheDocument();
    expect(screen.getByText(/Neither fee is added to your total/)).toBeInTheDocument();
  });

  it("discloses the known platform fee without quoting PayMongo's changing fee", async () => {
    const passport = { first_name: "QA", last_name: "Runner", date_of_birth: "1990-01-01", gender: "Female" as const,
      contact_number: "09171234567", emergency_contact_name: "Contact", emergency_contact_number: "09171234567",
      emergency_contact_relationship: "Friend", ...shipping };
    render(<RegisterWizard userId="u1" category={category} event={{ ...event, feeMode: "pass_on", commissionTerms: {
      commission_type: "percent", commission_rate: 0.03, commission_flat_cents: 0,
    } }} addons={addons} formFields={formFields} passport={passport} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Taxes and fees")).toBeInTheDocument();
    expect(screen.getByText("₱45.00")).toBeInTheDocument();
    expect(screen.getByText("Subtotal before payment processing")).toBeInTheDocument();
    expect(screen.getAllByText("₱1,545.00")).toHaveLength(2);
    expect(screen.getByText(/PayMongo calculates the processing fee and final total/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to payment" })).toBeInTheDocument();
  });

  it("reviews saved Passport fields without legacy identity inputs", async () => {
    const passport = { first_name: "QA", last_name: "Runner", team_name: "Trail Team", date_of_birth: "1950-01-01", gender: "Female" as const, contact_number: "09171234567", emergency_contact_name: "QA Contact", emergency_contact_number: "09171234567", emergency_contact_relationship: "Child", ...shipping };
    render(<RegisterWizard userId="u1" category={category} event={event} addons={addons} formFields={formFields} passport={passport} email="qa@example.com" />);
    expect(screen.getByText("Trail Team")).toBeInTheDocument();
    expect(screen.getByText("qa@example.com")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Bib name/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit Race Passport" })).toHaveAttribute("href", "/profile");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Make this entry yours")).toBeInTheDocument();
  });
  it("routes straight to /pay/<id> instead of showing a dead-end error", async () => {
    startCheckoutMock.mockRejectedValue(new CheckoutError("already_registered", "existing-reg-1"));
    const user = userEvent.setup();
    renderWizard();

    await fillAndSubmit(user);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/pay/existing-reg-1"));
    expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument();
  });

  it("falls back to readable copy — not the raw error code or a generic string — when the 409 body carried no registration_id", async () => {
    startCheckoutMock.mockRejectedValue(new CheckoutError("already_registered"));
    const user = userEvent.setup();
    renderWizard();

    await fillAndSubmit(user);

    expect(
      await screen.findByText("You're already entered in this race. Check My Races for your entry."),
    ).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});


describe("registration identity snapshot", () => {
  it("submits identity without saving the global profile", async () => {
    startCheckoutMock.mockResolvedValue({ registration_id: "new-reg" });
    renderWizard();
    await fillAndSubmit(userEvent.setup());
    expect(startCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({
      custom_data: expect.objectContaining({ full_name: "QA Runner", bib_name: "Runner One" }),
    }));
    expect(upsertProfile).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/pay/new-reg");
  });
});


it.each([{}, { error: "Profile save failed" }])("keeps registration identity when optional profile save returns %j", async (result) => {
  vi.mocked(upsertProfile).mockResolvedValueOnce(result);
  startCheckoutMock.mockResolvedValue({ registration_id: "new-reg" });
  renderWizard();
  await fillAndSubmit(userEvent.setup(), true);
  expect(upsertProfile).toHaveBeenCalledWith(expect.objectContaining({ full_name: "QA Runner", bib_name: "Runner One" }));
  expect(startCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({ custom_data: expect.objectContaining({ full_name: "QA Runner" }) }));
  expect(mockReplace).toHaveBeenCalledWith("/pay/new-reg");
});

it("submits the organizer version shown to the runner", async () => {
 const user = userEvent.setup();
 startCheckoutMock.mockResolvedValue({ registration_id: "reg", checkout_url: "https://example.com" });
 render(<RegisterWizard userId="u1" category={category} event={event} addons={addons} formFields={formFields} waiver={{ id: "version-one", title: "Organizer terms", body: "Exact organizer text" }} />);
 await fillAndSubmit(user);
 expect(startCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({ waiver_version_id: "version-one", waiver_accepted: true }));
});

it("submits assisted acceptance separately from the authenticated booker", async () => {
 const user = userEvent.setup();
 const passport = { first_name: "Guest", last_name: "Runner", date_of_birth: "1950-01-01", gender: "Female" as const, contact_number: "09171234567", emergency_contact_name: "Helper", emergency_contact_number: "09171234567", emergency_contact_relationship: "Child", ...shipping };
 startCheckoutMock.mockResolvedValue({ registration_id: "guest-reg", checkout_url: "https://example.com" });
 render(<RegisterWizard userId="helper" participantId="guest-passport" assisted passport={passport} category={category} event={event} addons={addons} formFields={formFields} waiver={{ id:"guest-waiver",title:"Sample",body:"Sample document" }} />);
 await user.click(screen.getByRole("button", { name:"Continue" }));
 await user.click(screen.getByRole("button", { name:"Continue" }));
 expect(screen.getByText(/Pass this device to/)).toBeInTheDocument();
 await user.click(screen.getByRole("checkbox"));
 await user.click(screen.getByRole("button", { name:/Continue to payment/ }));
 expect(startCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({participant_passport_id:"guest-passport",waiver_acceptance_method:"participant_on_helper_device",waiver_version_id:"guest-waiver"}));
});

describe("approved deferred registration", () => {
  const passport = { first_name: "Juan", last_name: "Dela Cruz", date_of_birth: "1990-01-01", gender: "Male" as const,
    contact_number: "09171234567", emergency_contact_name: "Contact", emergency_contact_number: "09171234567",
    emergency_contact_relationship: "Friend", ...shipping };
  const terms = { id: "grant1", dueAt: "2098-12-01T16:00:00Z" };
  function showDeferred(extra: Partial<React.ComponentProps<typeof RegisterWizard>> = {}) {
    return render(<RegisterWizard userId="u1" participantId="passport1" category={category} event={event}
      addons={addons} formFields={formFields} passport={passport} payLater={terms} {...extra} />);
  }
  function review() {
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  }
  it("confirms one reservation with explicit intent and skips immediate payment", async () => {
    startCheckoutMock.mockResolvedValue({ registration_id: "r1", payment_plan: "pay_later", checkout_url: null });
    showDeferred({ prescreeningBatchId: "screening1", prescreeningDeadlineAt: "infinity" });
    review();
    expect(screen.getByText("Due today").closest("div")).toHaveTextContent("₱0.00");
    expect(screen.queryByRole("button", { name: "Continue to payment" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm registration" }));
    expect(startCheckoutMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("accept the waiver");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm registration" }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/ticket/r1"));
    expect(startCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({
      pay_later_grant_id: "grant1", prescreening_batch_id: "screening1", participant_passport_id: "passport1",
    }));
  });
  it("uses the existing reservation's server plan after duplicate submission", async () => {
    startCheckoutMock.mockRejectedValue(new CheckoutError("already_registered", "existing", "pay_later"));
    showDeferred(); review();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm registration" }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/ticket/existing"));
  });
  it("leaves assisted and expired unused grants on the normal payment path", () => {
    const first = showDeferred({ assisted: true }); review();
    expect(screen.getByRole("button", { name: "Continue to payment" })).toBeInTheDocument();
    expect(screen.queryByText("Due today")).not.toBeInTheDocument();
    first.unmount(); window.sessionStorage.clear();
    showDeferred({ payLater: { id: "old", dueAt: "2000-01-01T00:00:00Z" } }); review();
    expect(screen.getByRole("button", { name: "Continue to payment" })).toBeInTheDocument();
  });
  it("blocks a stale screened form once the approval window ends", () => {
    showDeferred({ prescreeningBatchId: "screening1", prescreeningDeadlineAt: "2000-01-01T00:00:00Z" });
    expect(screen.getByRole("link", { name: "View request" })).toHaveAttribute("href", "/prescreening/screening1");
    expect(screen.queryByRole("button", { name: /Continue|Confirm/ })).not.toBeInTheDocument();
  });
});
