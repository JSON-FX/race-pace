import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Events } from "../routes/Events";

const navigate = vi.fn();
vi.mock("react-router-dom", async (orig) => ({ ...(await orig() as object), useNavigate: () => navigate }));
vi.mock("../lib/roles", () => ({ useMyRoles: () => ({ data: { orgId: "a1" } }) }));
const rows = [{ id: "e1", name: "Apo Sky Ultra", place: null, city_name: "City of Digos", province_name: "Davao del Sur", event_date: "2026-11-14", status: "open", original_date: null, categories: [] }];
vi.mock("../lib/events", () => ({ useOrgEvents: () => ({ data: rows, isLoading: false, isError: false, refetch: vi.fn() }) }));
vi.mock("../lib/registrations", () => ({ useEventRegistrationCounts: () => ({ data: { e1: 7 } }) }));
vi.mock("@tanstack/react-query", async (orig) => ({ ...(await orig() as object), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
beforeEach(() => navigate.mockClear());

it("shows the registration count and navigates to the roster from the row menu", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><Events /></MemoryRouter>);
  expect(screen.getByText("7")).toBeInTheDocument();
  await user.click(screen.getByLabelText("Actions for Apo Sky Ultra"));
  await user.click(await screen.findByText("View registrations"));
  expect(navigate).toHaveBeenCalledWith("/registrations?event=e1");
});
