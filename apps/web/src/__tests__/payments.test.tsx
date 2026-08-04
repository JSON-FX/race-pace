import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Payments } from "../routes/Payments";

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({ ...(await orig() as object), useNavigate: () => navigate }));
vi.mock("../lib/roles", () => ({ useMyRoles: () => ({ data: { orgId: "a1" } }) }));

const usePayments = vi.fn();
vi.mock("../lib/registrations", async (orig) => ({
  ...(await orig() as object),
  usePayments: (...a: unknown[]) => usePayments(...a),
}));
vi.mock("../components/StatusBadge", () => ({ PaymentStatusBadge: ({ status }: { status: string }) => <span>{status}</span> }));

const ROWS = [
  { registration_id: "r1", event_id: "e1", event_name: "Apo Sky Ultra", user_id: "u1", full_name: "Ana Cruz", amount: 100000, platform_fee: 10000, net_to_org: 90000, method: "gcash", status: "paid", created_at: "2026-07-01T00:00:00Z" },
];

beforeEach(() => {
  navigate.mockClear();
  usePayments.mockReset();
  usePayments.mockReturnValue({ data: { rows: ROWS, total: 1 }, isLoading: false, isError: false, refetch: vi.fn() });
});

const renderAt = (path = "/payments") => render(<MemoryRouter initialEntries={[path]}><Payments /></MemoryRouter>);

it("lists payments with money columns", () => {
  renderAt();
  expect(screen.getByText("Ana Cruz")).toBeInTheDocument();
  expect(screen.getByText("₱900")).toBeInTheDocument();   // net_to_org 90000
  expect(screen.getByText("₱1,000")).toBeInTheDocument(); // amount 100000
});

it("passes the chosen status filter to the query", async () => {
  const user = userEvent.setup();
  renderAt();
  await user.click(screen.getByLabelText("Payment status"));
  await user.click(screen.getByRole("option", { name: "Refunded" }));
  await waitFor(() =>
    expect(usePayments).toHaveBeenLastCalledWith("a1", expect.objectContaining({ status: "refunded" }))
  );
});

it("reads the initial status and page from the URL", () => {
  renderAt("/payments?status=paid&page=2");
  expect(usePayments).toHaveBeenLastCalledWith("a1", expect.objectContaining({ status: "paid", page: 2 }));
});

it("navigates to the event roster when a row is clicked", async () => {
  const user = userEvent.setup();
  renderAt();
  await user.click(screen.getByText("Ana Cruz"));
  expect(navigate).toHaveBeenCalledWith("/registrations?event=e1");
});
