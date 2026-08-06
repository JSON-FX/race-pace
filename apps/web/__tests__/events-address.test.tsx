import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Events } from "../routes/Events";

vi.mock("../lib/roles", () => ({ useMyRoles: () => ({ data: { orgId: "a1" } }) }));
const rows = [
  { id: "e1", name: "Apo Sky Ultra", place: null, city_name: "City of Digos", province_name: "Davao del Sur", event_date: "2026-11-14", status: "open", original_date: null, categories: [] },
  { id: "e2", name: "Legacy Race", place: "Mt Apo", city_name: null, province_name: null, event_date: "2026-10-01", status: "open", original_date: null, categories: [] },
];
vi.mock("../lib/events", () => ({ useOrgEvents: () => ({ data: rows, isLoading: false, isError: false, refetch: vi.fn() }) }));
vi.mock("../lib/registrations", () => ({ useEventRegistrationCounts: () => ({ data: {} }) }));
vi.mock("@tanstack/react-query", async (orig) => ({ ...(await orig()), useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));

it("shows the PSGC city for a structured row and the legacy place as fallback", () => {
  render(<MemoryRouter><Events /></MemoryRouter>);
  expect(screen.getByText("City of Digos, Davao del Sur")).toBeInTheDocument();
  expect(screen.getByText("Mt Apo")).toBeInTheDocument();
});
