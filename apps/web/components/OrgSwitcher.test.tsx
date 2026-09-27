import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

vi.mock("@/lib/actions/set-active-org", () => ({ setActiveOrg: vi.fn() }));

import { OrgSwitcher } from "./OrgSwitcher";

it("labels the active organization as a switcher for super admins", () => {
  render(
    <OrgSwitcher
      availableOrgs={[
        { orgId: "org-1", name: "Team Pogi Adventures" },
        { orgId: "org-2", name: "North Ridge Events" },
      ]}
      activeOrgId="org-1"
      isSuperAdmin
      canSwitch
    />,
  );

  const trigger = screen.getByRole("combobox", { name: /Organization: Team Pogi Adventures\. Switch organization/i });
  expect(trigger).toHaveTextContent("Organization");
  expect(trigger).toHaveTextContent("Team Pogi Adventures");
});


it("filters organizations and supports keyboard selection without changing the current org", async () => {
  const { default: userEvent } = await import("@testing-library/user-event");
  const { setActiveOrg } = await import("@/lib/actions/set-active-org");
  vi.mocked(setActiveOrg).mockClear();
  render(<OrgSwitcher availableOrgs={[{ orgId: "1", name: "North Ridge" }, { orgId: "2", name: "Team Pogi" }]} activeOrgId="1" isSuperAdmin canSwitch />);
  const user = userEvent.setup();
  const trigger = screen.getByRole("combobox", { name: /Organization: North Ridge/ });
  await user.click(trigger);
  const search = screen.getByRole("combobox", { name: "Search organizations" });
  await user.type(search, "North");
  expect(screen.getByRole("option", { name: "North Ridge" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: "Team Pogi" })).not.toBeInTheDocument();
  await user.keyboard("{ArrowDown}{Enter}");
  expect(screen.queryByRole("option")).not.toBeInTheDocument();
  expect(setActiveOrg).not.toHaveBeenCalled();
  expect(trigger).toHaveFocus();
});
