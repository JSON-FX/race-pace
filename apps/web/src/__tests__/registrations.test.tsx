import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Registrations } from "../routes/Registrations";

vi.mock("../lib/roles", () => ({ useMyRoles: () => ({ data: { orgId: "a1" } }) }));
vi.mock("../lib/events", () => ({ useOrgEvents: () => ({ data: [{ id: "e1", name: "Apo Sky Ultra" }] }) }));
vi.mock("../lib/registrations", () => ({
  useEventRegistrationCounts: () => ({ data: { e1: 2 }, refetch: vi.fn() }),
  useEventRegistrations: () => ({
    data: [
      { id: "r1", user_id: "u1", category_id: "c4", category_label: "10K", full_name: "Ana Cruz", bib_name: "ANA", total_amount: 100000, payment_status: "paid", payment_method: "gcash", created_at: "2026-07-01T00:00:00Z", custom_data: {}, addons: [] },
      { id: "r2", user_id: "u2", category_id: "c3", category_label: "21K", full_name: "Ben Diaz", bib_name: null, total_amount: 150000, payment_status: "pending", payment_method: null, created_at: "2026-07-02T00:00:00Z", custom_data: {}, addons: [] },
    ],
    isLoading: false, refetch: vi.fn(),
  }),
}));
vi.mock("../components/RegistrationDetail", () => ({ RegistrationDetail: ({ row }: { row: { full_name: string } }) => <div data-testid="detail">{row.full_name}</div> }));
vi.mock("../components/PaymentBadge", () => ({ PaymentBadge: ({ status }: { status: string }) => <span>{status}</span> }));

const at = (path = "/registrations?event=e1") => render(<MemoryRouter initialEntries={[path]}><Registrations /></MemoryRouter>);

it("lists the event's registrations and filters by payment status", () => {
  at();
  expect(screen.getByText("Ana Cruz")).toBeInTheDocument();
  expect(screen.getByText("Ben Diaz")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Payment status"), { target: { value: "paid" } });
  expect(screen.getByText("Ana Cruz")).toBeInTheDocument();
  expect(screen.queryByText("Ben Diaz")).not.toBeInTheDocument();
});

it("filters by name search", () => {
  at();
  fireEvent.change(screen.getByLabelText("Search name"), { target: { value: "ben" } });
  expect(screen.queryByText("Ana Cruz")).not.toBeInTheDocument();
  expect(screen.getByText("Ben Diaz")).toBeInTheDocument();
});

it("opens the detail when a row is clicked", () => {
  at();
  fireEvent.click(screen.getByText("Ana Cruz"));
  expect(screen.getByTestId("detail")).toHaveTextContent("Ana Cruz");
});
