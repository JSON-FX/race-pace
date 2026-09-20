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

  const trigger = screen.getByRole("button", { name: /Organization: Team Pogi Adventures\. Switch organization/i });
  expect(trigger).toHaveTextContent("Organization");
  expect(trigger).toHaveTextContent("Team Pogi Adventures");
});
