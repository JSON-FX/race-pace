import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import type { PlatformPassport, PlatformUser } from "@/lib/queries/platform-users";

const invoke = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ functions: { invoke } }) }));
vi.mock("@/components/PhotoAvatar", () => ({ PhotoAvatar: ({ fallback }: { fallback: React.ReactNode }) => <span>{fallback}</span> }));

import { UsersDirectory } from "./users-directory";

const passportDetails: Pick<PlatformPassport,
  "firstName" | "lastName" | "teamName" | "dateOfBirth" | "gender" | "contactNumber" |
  "participantEmail" | "emergencyContactName" | "emergencyContactNumber" |
  "emergencyContactRelationship" | "shirtSize" | "bloodType" | "shippingAddressLine" |
  "shippingBarangayCode" | "shippingZipCode" | "shippingBarangay" | "shippingCity" |
  "shippingProvince" | "shippingRegion" | "legacyFullName" | "legacyBibName" |
  "legacyGender" | "legacyEmergencyContact"
> = {
  firstName: "Maya",
  lastName: "Santos",
  teamName: "Ridge Runners",
  dateOfBirth: "2010-06-14",
  gender: "Female",
  contactNumber: "+63 917 123 4567",
  participantEmail: "maya@example.com",
  emergencyContactName: "Alina Santos",
  emergencyContactNumber: "+63 918 123 4567",
  emergencyContactRelationship: "Mother",
  shirtSize: "S",
  bloodType: "O+",
  shippingAddressLine: "House 1, Trail Road",
  shippingBarangayCode: "012801001",
  shippingZipCode: "8000",
  shippingBarangay: "Adams (Pob.)",
  shippingCity: "Adams",
  shippingProvince: "Ilocos Norte",
  shippingRegion: "Ilocos Region",
  legacyFullName: null,
  legacyBibName: null,
  legacyGender: null,
  legacyEmergencyContact: null,
};

const user: PlatformUser = {
  id: "u1",
  email: "alina@example.com",
  name: "Alina Santos",
  avatarUrl: "https://example.com/alina.jpg",
  provider: "google",
  createdAt: "2026-09-12T00:00:00Z",
  lastSignInAt: "2026-09-20T00:00:00Z",
  status: "active",
  protectedAccount: false,
  registrations: [],
  currentRegistrations: [],
  latestPayment: null,
  passports: [{
    ...passportDetails,
    id: "p1",
    name: "Maya Santos",
    avatarUrl: "https://example.com/maya.jpg",
    relationship: "managed",
    claimed: false,
    latestPayment: { method: "gcash", amountCents: 245000, paidAt: "2026-09-15T00:00:00Z", eventName: "Forest Loop Juniors" },
    currentRegistrations: [],
    registrations: [{
      id: "r1",
      eventName: "Forest Loop Juniors",
      eventDate: "2026-10-18",
      eventStatus: "open",
      category: "5K",
      status: "paid",
      createdAt: "2026-09-15T00:00:00Z",
      amountCents: 245000,
      payment: { method: "gcash", amountCents: 245000, paidAt: "2026-09-15T00:00:00Z", eventName: "Forest Loop Juniors" },
    }],
  }],
};

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
});

it("filters users and expands managed Race Passport details in the inspector", async () => {
  const events = userEvent.setup();
  render(<UsersDirectory initialUsers={[user]} />);

  await events.type(screen.getByRole("textbox", { name: "Search users" }), "missing");
  expect(screen.getByText("No users match these filters.")).toBeInTheDocument();
  await events.clear(screen.getByRole("textbox", { name: "Search users" }));
  await events.click(screen.getByRole("button", { name: "View Alina Santos" }));

  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("alina@example.com")).toBeInTheDocument();
  const maya = within(dialog).getByText("Maya Santos").closest("details");
  expect(maya).toHaveAttribute("open");
  await events.click(within(dialog).getByText("Maya Santos"));
  expect(maya).not.toHaveAttribute("open");
  await events.click(within(dialog).getByText("Maya Santos"));
  expect(maya).toHaveAttribute("open");
  expect(within(dialog).getByText(/Managed Race Passport/)).toBeInTheDocument();
  expect(within(dialog).getByText("Ridge Runners")).toBeInTheDocument();
  expect(within(dialog).getByText("maya@example.com")).toBeInTheDocument();
  expect(within(dialog).getByText("House 1, Trail Road")).toBeInTheDocument();
  expect(within(dialog).getAllByText(/Forest Loop Juniors/).length).toBeGreaterThan(0);
});

it("shows the account passport and lets two managed passports expand independently", async () => {
  const events = userEvent.setup();
  const own: PlatformPassport = {
    ...user.passports[0], ...passportDetails,
    id: "own", name: "Alina Santos", relationship: "own", claimed: true,
    firstName: "Alina", lastName: "Santos", participantEmail: null,
    registrations: [], currentRegistrations: [], latestPayment: null,
  };
  const second: PlatformPassport = {
    ...user.passports[0], ...passportDetails,
    id: "p2", name: "Nico Santos", firstName: null, lastName: null,
    legacyFullName: "Nico Santos", legacyEmergencyContact: "Saved helper contact",
    emergencyContactName: null, participantEmail: null, shippingBarangay: null,
    registrations: [], currentRegistrations: [], latestPayment: null,
  };
  render(<UsersDirectory initialUsers={[{ ...user, passports: [own, user.passports[0], second] }]} />);
  await events.click(screen.getByRole("button", { name: "View Alina Santos" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("Race Passports managed (3)")).toBeInTheDocument();
  expect(within(dialog).getByText("Account email")).toBeInTheDocument();
  await events.click(within(dialog).getByText("Maya Santos"));
  await events.click(within(dialog).getAllByText("Nico Santos")[0]);
  expect(within(dialog).getAllByText("Participant email (unverified)")).toHaveLength(2);
  expect(within(dialog).getAllByText("Nico Santos")[0].closest("details")).toHaveAttribute("open");
  expect(within(dialog).getByText("Maya Santos").closest("details")).toHaveAttribute("open");
  const nico = within(dialog).getAllByText("Nico Santos")[0].closest("details") as HTMLElement;
  expect(within(nico).getByText("Previously saved name")).toBeInTheDocument();
  expect(within(nico).getByText("Saved helper contact")).toBeInTheDocument();
  expect(within(nico).getAllByText("Not provided").length).toBeGreaterThan(0);
  expect(within(nico).getByText("012801001 (code)")).toBeInTheDocument();
  await events.click(within(dialog).getByRole("button", { name: "Race Passports" }));
  expect(within(dialog).getByText("Race Passports managed (3)")).toBeInTheDocument();
});

it("requires confirmation before suspending an account", async () => {
  const events = userEvent.setup();
  render(<UsersDirectory initialUsers={[user]} />);
  await events.click(screen.getByRole("button", { name: "View Alina Santos" }));
  await events.click(await screen.findByRole("button", { name: "Suspend user" }));
  const confirmation = await screen.findByRole("alertdialog");
  await events.click(within(confirmation).getByRole("button", { name: "Suspend user" }));
  expect(invoke).toHaveBeenCalledWith("platform-users", { body: { action: "suspend", user_id: "u1" } });
  expect((await screen.findAllByText("Suspended")).length).toBeGreaterThan(0);
});
