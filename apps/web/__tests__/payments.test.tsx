import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
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

it("debounces the search box so it does not call through on every keystroke", () => {
  vi.useFakeTimers();
  try {
    renderAt();
    const input = screen.getByLabelText("Search payments");
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "an" } });
    fireEvent.change(input, { target: { value: "ana" } });
    // Still within the debounce window — the query hook has not seen "ana" yet.
    act(() => { vi.advanceTimersByTime(299); });
    expect(usePayments).not.toHaveBeenLastCalledWith("a1", expect.objectContaining({ q: "ana" }));

    act(() => { vi.advanceTimersByTime(1); });
    expect(usePayments).toHaveBeenLastCalledWith("a1", expect.objectContaining({ q: "ana" }));
  } finally {
    vi.useRealTimers();
  }
});

it("does not strip the page from a deep link when the debounce timer fires on mount untouched", () => {
  vi.useFakeTimers();
  try {
    renderAt("/payments?status=paid&page=2");
    act(() => { vi.advanceTimersByTime(300); });
    expect(usePayments).toHaveBeenLastCalledWith("a1", expect.objectContaining({ page: 2 }));
  } finally {
    vi.useRealTimers();
  }
});

it("navigates to the event roster when a row is clicked", async () => {
  const user = userEvent.setup();
  renderAt();
  await user.click(screen.getByText("Ana Cruz"));
  expect(navigate).toHaveBeenCalledWith("/registrations?event=e1");
});
