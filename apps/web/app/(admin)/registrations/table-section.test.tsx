import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { parseTableParams } from "@/lib/table-params";
import { tableParamsMockReturn, resetTableParamsSpies } from "@/lib/test-utils/mock-table-params";
import type { RegistrationRow } from "@/lib/queries/registrations";

vi.mock("@/lib/use-table-params", () => ({ useTableParams: () => tableParamsMockReturn }));

// This renders the real RegistrationsTable (not a stub, unlike page.test.tsx —
// see that file's header comment), which now reads the open registration id
// via useSearchParams() directly (see registrations-table.tsx's `urlRegId`).
// No test here opens the modal, so a fixed empty value is enough — see
// registrations-table.test.tsx for the mutable version other cases need.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const listEventRegistrations = vi.hoisted(() => vi.fn());
const listEventCategories = vi.hoisted(() => vi.fn());
vi.mock("@/lib/queries/registrations", () => ({ listEventRegistrations, listEventCategories }));

import { RegistrationsTableSection } from "./table-section";

beforeEach(() => {
  resetTableParamsSpies();
  listEventRegistrations.mockReset();
  listEventCategories.mockReset();
});

const rows: RegistrationRow[] = [
  {
    id: "r1", user_id: "u1", category_id: "c1", category_label: "50K Ultra",
    full_name: "Maria Josefa Santos", bib_name: "D-1042", avatar_url: null, email: "maria.santos@gmail.com",
    total_amount: 285000, payment_status: "paid", payment_method: "gcash",
    created_at: "2026-08-03T09:14:00Z", custom_data: {}, addons: [],
  },
];

describe("RegistrationsTableSection", () => {
  it("renders rows and categories from the list readers, both scoped to the given event and filters", async () => {
    listEventRegistrations.mockResolvedValue({ rows, total: 1 });
    listEventCategories.mockResolvedValue([{ id: "c1", label: "50K Ultra" }]);
    const params = parseTableParams({}, { sort: [], filters: { status: "all", category: "all" } });

    render(await RegistrationsTableSection({ eventId: "ev-1", params }));

    expect(listEventRegistrations).toHaveBeenCalledWith(
      "ev-1",
      expect.objectContaining({ filters: expect.objectContaining({ status: "all", category: "all" }) }),
    );
    expect(listEventCategories).toHaveBeenCalledWith("ev-1");
    expect(screen.getByText("Maria Josefa Santos")).toBeInTheDocument();
  });
});
