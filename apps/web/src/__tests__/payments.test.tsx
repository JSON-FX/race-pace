import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Payments } from "../routes/Payments";

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({ ...(await orig() as object), useNavigate: () => navigate }));
vi.mock("../lib/roles", () => ({ useMyRoles: () => ({ data: { orgId: "a1" } }) }));
vi.mock("../lib/registrations", () => ({
  usePayments: () => ({
    data: [
      { registration_id: "r1", event_id: "e1", event_name: "Apo Sky Ultra", user_id: "u1", full_name: "Ana Cruz", amount: 100000, platform_fee: 10000, net_to_org: 90000, method: "gcash", status: "paid", created_at: "2026-07-01T00:00:00Z" },
      { registration_id: "r2", event_id: "e1", event_name: "Apo Sky Ultra", user_id: "u2", full_name: "Ben Diaz", amount: 150000, platform_fee: 15000, net_to_org: 135000, method: "card", status: "refunded", created_at: "2026-07-02T00:00:00Z" },
    ],
    isLoading: false,
  }),
}));
vi.mock("../components/StatusBadge", () => ({ PaymentStatusBadge: ({ status }: { status: string }) => <span>{status}</span> }));
beforeEach(() => navigate.mockClear());

it("lists payments with money columns and filters by status", () => {
  render(<MemoryRouter><Payments /></MemoryRouter>);
  expect(screen.getByText("Ana Cruz")).toBeInTheDocument();
  expect(screen.getByText("₱900")).toBeInTheDocument(); // net_to_org 90000
  fireEvent.change(screen.getByLabelText("Payment status"), { target: { value: "refunded" } });
  expect(screen.queryByText("Ana Cruz")).not.toBeInTheDocument();
  expect(screen.getByText("Ben Diaz")).toBeInTheDocument();
});

it("navigates to the event roster when a row is clicked", () => {
  render(<MemoryRouter><Payments /></MemoryRouter>);
  fireEvent.click(screen.getByText("Ana Cruz"));
  expect(navigate).toHaveBeenCalledWith("/registrations?event=e1");
});
