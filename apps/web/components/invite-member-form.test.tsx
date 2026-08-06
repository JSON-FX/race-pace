import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { inviteMemberAction } = vi.hoisted(() => ({
  inviteMemberAction: vi.fn(),
}));
vi.mock("@/lib/actions/team", () => ({ inviteMemberAction: (...a: unknown[]) => inviteMemberAction(...a) }));

import { InviteMemberForm } from "./InviteMemberForm";

describe("InviteMemberForm", () => {
  it("submits an invite with the entered email, org id, and selected role", async () => {
    inviteMemberAction.mockResolvedValue({ success: "Invite sent to crew@x.com." });
    const user = userEvent.setup();
    render(<InviteMemberForm orgId="a1" />);

    await user.type(screen.getByLabelText("Invite email"), "crew@x.com");
    await user.click(screen.getByLabelText("Role"));
    await user.click(screen.getByRole("option", { name: "Marshal" }));
    await user.click(screen.getByRole("button", { name: /invite/i }));

    await waitFor(() => expect(inviteMemberAction).toHaveBeenCalled());
    const formData = inviteMemberAction.mock.calls[0][1] as FormData;
    expect(formData.get("orgId")).toBe("a1");
    expect(formData.get("email")).toBe("crew@x.com");
    expect(formData.get("role")).toBe("marshal");

    expect(await screen.findByText("Invite sent to crew@x.com.")).toBeInTheDocument();
  });

  it("shows an error when the invite fails", async () => {
    inviteMemberAction.mockResolvedValue({ error: "That role can't be assigned." });
    const user = userEvent.setup();
    render(<InviteMemberForm orgId="a1" />);

    await user.type(screen.getByLabelText("Invite email"), "x@x.com");
    await user.click(screen.getByRole("button", { name: /invite/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("can't be assigned");
  });

  // Regression guard: ASSIGNABLE_ROLES/ROLE_LABELS drift (e.g. dropping
  // "claiming"/"Race Kit") would silently remove an assignable role from
  // the invite picker without any type error.
  it("offers every assignable role, including Race Kit (claiming)", async () => {
    const user = userEvent.setup();
    render(<InviteMemberForm orgId="a1" />);
    await user.click(screen.getByLabelText("Role"));
    expect(screen.getByRole("option", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Editor" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Marshal" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Race Kit" })).toBeInTheDocument();
  });
});
