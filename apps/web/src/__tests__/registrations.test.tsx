import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Registrations } from "../routes/Registrations";

const invalidateQueries = vi.fn();
vi.mock("@tanstack/react-query", async (orig) => ({ ...(await orig() as object), useQueryClient: () => ({ invalidateQueries }) }));
vi.mock("../lib/roles", () => ({ useMyRoles: () => ({ data: { orgId: "a1" } }) }));
vi.mock("../lib/events", () => ({
  useOrgEvents: () => ({ data: [{ id: "e1", name: "Apo Sky Ultra" }, { id: "e2", name: "Second Race" }] }),
  useEventForEditor: () => ({ data: { categories: [{ id: "c4", label: "10K" }, { id: "c3", label: "21K" }] } }),
}));

const ROWS = [
  { id: "r1", user_id: "u1", category_id: "c4", category_label: "10K", full_name: "Ana Cruz", bib_name: "ANA", total_amount: 100000, payment_status: "paid", payment_method: "gcash", created_at: "2026-07-01T00:00:00Z", custom_data: {} },
  { id: "r2", user_id: "u2", category_id: "c3", category_label: "21K", full_name: "Ben Diaz", bib_name: null, total_amount: 150000, payment_status: "pending", payment_method: null, created_at: "2026-07-02T00:00:00Z", custom_data: {} },
];

const useEventRegistrations = vi.fn();
vi.mock("../lib/registrations", async (orig) => ({
  ...(await orig() as object),
  useEventRegistrationCounts: () => ({ data: { e1: 2 }, refetch: vi.fn() }),
  useEventRegistrations: (...a: unknown[]) => useEventRegistrations(...a),
}));
vi.mock("../components/RegistrationDetail", () => ({ RegistrationDetail: ({ row, onRefunded }: { row: { full_name: string }; onRefunded: () => void }) => <div data-testid="detail">{row.full_name}<button onClick={onRefunded}>trigger-refund</button></div> }));
vi.mock("../components/StatusBadge", () => ({ PaymentStatusBadge: ({ status }: { status: string }) => <span>{status}</span> }));

beforeEach(() => {
  useEventRegistrations.mockReset();
  useEventRegistrations.mockReturnValue({ data: { rows: ROWS, total: 2 }, isLoading: false, isError: false, refetch: vi.fn() });
});

const at = (path = "/registrations?event=e1") => render(<MemoryRouter initialEntries={[path]}><Registrations /></MemoryRouter>);

it("lists the event's registrations", () => {
  at();
  expect(screen.getByText("Ana Cruz")).toBeInTheDocument();
  expect(screen.getByText("Ben Diaz")).toBeInTheDocument();
  expect(useEventRegistrations).toHaveBeenLastCalledWith("e1", expect.objectContaining({ status: "all", categoryId: "all", q: "" }));
});

it("passes the chosen payment status filter to the query", async () => {
  const user = userEvent.setup();
  at();
  await user.click(screen.getByLabelText("Payment status"));
  await user.click(screen.getByRole("option", { name: "Paid" }));
  await waitFor(() =>
    expect(useEventRegistrations).toHaveBeenLastCalledWith("e1", expect.objectContaining({ status: "paid" }))
  );
});

it("passes the chosen category filter to the query", async () => {
  const user = userEvent.setup();
  at();
  await user.click(screen.getByLabelText("Category"));
  await user.click(screen.getByRole("option", { name: "10K" }));
  await waitFor(() =>
    expect(useEventRegistrations).toHaveBeenLastCalledWith("e1", expect.objectContaining({ categoryId: "c4" }))
  );
});

it("passes the name search to the query", () => {
  at();
  fireEvent.change(screen.getByLabelText("Search name"), { target: { value: "ben" } });
  expect(useEventRegistrations).toHaveBeenLastCalledWith("e1", expect.objectContaining({ q: "ben" }));
});

it("opens the detail when a row is clicked", () => {
  at();
  fireEvent.click(screen.getByText("Ana Cruz"));
  expect(screen.getByTestId("detail")).toHaveTextContent("Ana Cruz");
});

it("resets the category filter and closes the detail when the event changes", async () => {
  const user = userEvent.setup();
  at();
  await user.click(screen.getByLabelText("Category"));
  await user.click(screen.getByRole("option", { name: "10K" }));
  await waitFor(() => expect(useEventRegistrations).toHaveBeenLastCalledWith("e1", expect.objectContaining({ categoryId: "c4" })));

  fireEvent.click(screen.getByText("Ana Cruz"));
  expect(screen.getByTestId("detail")).toBeInTheDocument();

  await user.click(screen.getByLabelText("Event"));
  await user.click(screen.getByRole("option", { name: /Second Race/ }));
  await waitFor(() => expect(useEventRegistrations).toHaveBeenLastCalledWith("e2", expect.objectContaining({ categoryId: "all" })));
  expect(screen.queryByTestId("detail")).not.toBeInTheDocument();
});

it("invalidates the Events list after a refund", () => {
  at();
  fireEvent.click(screen.getByText("Ana Cruz"));
  fireEvent.click(screen.getByText("trigger-refund"));
  expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["org-events"] });
});
