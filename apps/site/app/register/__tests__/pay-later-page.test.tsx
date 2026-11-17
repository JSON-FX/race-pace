import { beforeEach, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  category: vi.fn(), event: vi.fn(), terms: vi.fn(), screening: vi.fn(), entry: vi.fn(),
  passport: vi.fn(), wizard: vi.fn(() => null),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error("REDIRECT:" + url); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1", email: "juan@example.test" } } }) },
    from: (table: string) => {
      const query = { select: () => query, eq: () => query,
        maybeSingle: mocks.passport, single: async () => ({ data: { id: "w1", title: "Waiver", body: "Terms" } }) };
      if (table !== "runner_passports" && table !== "organizer_waiver_versions") throw new Error("Unexpected query");
      return query;
    },
  }),
}));
vi.mock("@/lib/events", () => ({
  fetchCategory: mocks.category, fetchEvent: mocks.event,
  fetchAddons: async () => [], fetchFormFields: async () => [],
}));
vi.mock("@/lib/pay-later", () => ({ fetchPayLaterTerms: mocks.terms, fetchPayLaterScreening: mocks.screening }));
vi.mock("@/lib/entry", () => ({ fetchMyEntry: mocks.entry }));
vi.mock("@/components/SiteHeader", () => ({ SiteHeader: () => null }));
vi.mock("../[categoryId]/RegisterWizard", () => ({ RegisterWizard: mocks.wizard }));
import Page from "../[categoryId]/page";

const passport = {
  id: "p1", claimed_user_id: "u1", first_name: "Juan", last_name: "Dela Cruz",
  date_of_birth: "1990-01-01", gender: "Male", contact_number: "09171234567",
  emergency_contact_name: "Contact", emergency_contact_number: "09171234567", emergency_contact_relationship: "Friend",
  shipping_barangay_code: "012801001", shipping_zip_code: "0123", shipping_address_line: "House 1, Sample Street",
};
const category = { id: "c1", event_id: "e1", slots_total: 10, slots_taken: 0, prescreening_enabled: false };
const terms = { id: "g1", dueAt: "2098-12-01T16:00:00Z" };
async function load(query: { participant?: string; prescreening?: string } = { participant: "p1" }) {
  return Page({ params: Promise.resolve({ categoryId: "c1" }), searchParams: Promise.resolve(query) });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.category.mockResolvedValue(category);
  mocks.event.mockResolvedValue({ id: "e1", status: "open", waiver_version_id: "w1" });
  mocks.passport.mockResolvedValue({ data: passport, error: null });
  mocks.terms.mockResolvedValue(terms);
  mocks.screening.mockResolvedValue(null);
  mocks.entry.mockResolvedValue(null);
});

it("passes payment terms only for the account's own Passport", async () => {
  render(await load());
  expect(mocks.wizard).toHaveBeenCalledWith(expect.objectContaining({ payLater: terms, assisted: false }), undefined);
  mocks.wizard.mockClear(); mocks.terms.mockClear();
  mocks.passport.mockResolvedValue({ data: { ...passport, id: "managed", claimed_user_id: null }, error: null });
  render(await load({ participant: "managed" }));
  expect(mocks.terms).not.toHaveBeenCalled();
  expect(mocks.wizard).toHaveBeenCalledWith(expect.objectContaining({ payLater: null, assisted: true }), undefined);
});

it("keeps ordinary self-registration available after unused grant expiry", async () => {
  mocks.terms.mockResolvedValue(null);
  render(await load());
  expect(mocks.wizard).toHaveBeenCalledWith(expect.objectContaining({ payLater: null }), undefined);
});

it("requires screening and uses an approved own hold even when public capacity is exhausted", async () => {
  mocks.category.mockResolvedValue({ ...category, prescreening_enabled: true, slots_taken: 10 });
  await expect(load()).rejects.toThrow("REDIRECT:/prescreening/new?event=e1&category=c1&intent=entry");
  mocks.screening.mockResolvedValue({ batchId: "b1", passportId: "p1", categoryId: "c1", deadlineAt: "infinity" });
  render(await load({ participant: "p1", prescreening: "b1" }));
  expect(mocks.wizard).toHaveBeenCalledWith(expect.objectContaining({ payLater: terms, prescreeningBatchId: "b1", prescreeningDeadlineAt: "infinity" }), undefined);
});

it("rejects a screening link for a different category, Passport, or expired approval", async () => {
  for (const approval of [null, { batchId: "b1", passportId: "p1", categoryId: "other" }, { batchId: "b1", passportId: "other", categoryId: "c1" }]) {
    mocks.screening.mockResolvedValue(approval);
    await expect(load({ participant: "p1", prescreening: "b1" })).rejects.toThrow("REDIRECT:/prescreening/b1");
  }
});

it("returns a selected self Passport to its existing reservation", async () => {
  mocks.entry.mockResolvedValue({ id: "r1", payLaterDueAt: terms.dueAt });
  await expect(load()).rejects.toThrow("REDIRECT:/ticket/r1");
});

it("surfaces payment term lookup failures", async () => {
  mocks.terms.mockRejectedValue(new Error("Could not check payment terms"));
  await expect(load()).rejects.toThrow("Could not check payment terms");
});
