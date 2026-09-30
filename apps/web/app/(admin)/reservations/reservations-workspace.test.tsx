import { expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReservationCategoryAvailability, ReservationRow } from "@/lib/queries/reservations";
import { ReservationsWorkspace } from "./reservations-workspace";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

function category(id: string, code: string | null, label = code ?? "100 miles"): ReservationCategoryAvailability {
  return { id, code, label, capacity: 100, reservationEnabled: true, totalAvailable: 99, generalAvailable: 89, reservationAvailable: 10 };
}
function row(id: string, overrides: Partial<ReservationRow> = {}): ReservationRow {
  return {
    id, userId: id, name: `Runner ${id}`, email: `${id}@example.test`, avatarUrl: null,
    paymentStatus: "Paid", paidAt: "2026-10-01T00:00:00Z", amountCents: 21128,
    converted: false, managed: [], categories: ["25k"], categoryIds: ["category-25"], deadlines: [],
    ...overrides,
  };
}
const categories = [category("category-25", "25k"), category("category-42", "42k"), category("category-empty", null)];
const rows = [
  row("group", { name: "Ana Booking", email: "ana@example.test", amountCents: 42256, managed: [{ name: "Bea Managed", category: "42k", status: "paid" }], categories: ["25k", "42k"], categoryIds: ["category-25", "category-42"] }),
  row("pending", { name: "Bea Pending", paymentStatus: "Pending", paidAt: null, amountCents: null, categories: ["42k"], categoryIds: ["category-42"] }),
  row("other", { name: "Cam Runner" }),
];
const props = {
  events: [{ id: "event-1", name: "Trail Event", event_date: null }], eventId: "event-1", orgName: "Trail Org", rows, categories,
  summary: { total: 3, paid: 2, paidAmountCents: 63384, pending: 1 },
};
async function choose(user: ReturnType<typeof userEvent.setup>, filter: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: filter }));
  await user.click(screen.getByRole("option", { name: option }));
}
function tableRows() { return within(screen.getByRole("table")).getAllByRole("row").slice(1); }

it("offers all categories for the selected event, including categories with no reservations", async () => {
  const user = userEvent.setup();
  render(<ReservationsWorkspace {...props} />);
  await user.click(screen.getByRole("combobox", { name: "Category filter" }));
  expect(screen.getAllByRole("option").map(option => option.textContent)).toEqual(["All categories", "25k", "42k", "100 miles"]);
});

it("combines category, managed runner search, and payment status without splitting a checkout or its payment", async () => {
  const user = userEvent.setup();
  render(<ReservationsWorkspace {...props} />);
  await user.type(screen.getByRole("textbox", { name: "Search runners" }), "BEA");
  await choose(user, "Payment status filter", "Paid");
  await choose(user, "Category filter", "42k");

  const shown = tableRows();
  expect(shown).toHaveLength(1);
  const cells = within(shown[0]).getAllByRole("cell");
  expect(cells[1]).toHaveTextContent("Ana Booking");
  expect(cells[1]).toHaveTextContent("Managed: Bea Managed · 42k");
  expect(cells[3]).toHaveTextContent("25k42k");
  expect(cells[7]).toHaveTextContent("₱422.56");
  expect(screen.getByText("1–1 of 1 checkouts")).toBeInTheDocument();
  expect(within(screen.getByRole("region", { name: "Event reservation summary" })).getByText("₱633.84")).toBeInTheDocument();
  expect(screen.getByText("3 checkouts")).toBeInTheDocument();
});

it("selects duplicate category labels by ID", async () => {
  const user = userEvent.setup();
  render(<ReservationsWorkspace {...props} categories={[category("category-42", "42k"), category("category-other-42", "42k")]} rows={[
    row("first", { categoryIds: ["category-42"], categories: ["42k"] }),
    row("second", { categoryIds: ["category-other-42"], categories: ["42k"] }),
  ]} />);
  await user.click(screen.getByRole("combobox", { name: "Category filter" }));
  await user.click(screen.getAllByRole("option", { name: "42k" })[1]);
  const shown = tableRows();
  expect(shown).toHaveLength(1);
  expect(shown[0]).toHaveTextContent("Runner second");
});

it("clears search, payment, and category filters after selecting an empty category", async () => {
  const user = userEvent.setup();
  render(<ReservationsWorkspace {...props} />);
  await user.type(screen.getByRole("textbox", { name: "Search runners" }), "Ana");
  await choose(user, "Payment status filter", "Paid");
  await choose(user, "Category filter", "100 miles");
  expect(screen.getByText("No matching reservations")).toBeInTheDocument();
  expect(screen.getByText("0 checkouts")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getByRole("textbox", { name: "Search runners" })).toHaveValue("");
  expect(screen.getByRole("combobox", { name: "Payment status filter" })).toHaveTextContent("All payments");
  expect(screen.getByRole("combobox", { name: "Category filter" })).toHaveTextContent("All categories");
  expect(tableRows()).toHaveLength(3);
  expect(screen.getByText("1–3 of 3 checkouts")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
});

it.each(["category", "search", "payment"])("resets pagination when the %s filter changes", async filter => {
  const user = userEvent.setup();
  const paginated = Array.from({ length: 25 }, (_, index) => row(`first-${index}`, { name: `First participant ${index}`, paymentStatus: "Pending", amountCents: null }));
  paginated.push(row("last", { name: "Last participant", categories: ["42k"], categoryIds: ["category-42"] }));
  render(<ReservationsWorkspace {...props} rows={paginated} summary={{ total: 26, paid: 1, paidAmountCents: 21128, pending: 25 }} />);
  await user.click(screen.getByRole("button", { name: "Next page" }));
  expect(screen.getByText("26–26 of 26 checkouts")).toBeInTheDocument();
  if (filter === "category") await choose(user, "Category filter", "25k");
  else if (filter === "search") await user.type(screen.getByRole("textbox", { name: "Search runners" }), "First");
  else await choose(user, "Payment status filter", "Pending");
  expect(screen.getByText("1–25 of 25 checkouts")).toBeInTheDocument();
  expect(tableRows()).toHaveLength(25);
  expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
});
