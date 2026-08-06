import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const inviteMember = vi.fn((..._a: unknown[]): Promise<{ ok: boolean; error?: string }> => Promise.resolve({ ok: true }));
vi.mock("../lib/team", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/team")>();
  return { ...actual, inviteMember: (...a: unknown[]) => inviteMember(...a) };
});

import { InviteMemberForm } from "../components/InviteMemberForm";

it("submits an invite with the entered email and selected role", async () => {
  const onInvited = vi.fn();
  render(<InviteMemberForm orgId="a1" onInvited={onInvited} />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Invite email"), "crew@x.com");
  await user.click(screen.getByLabelText("Role"));
  await user.click(screen.getByRole("option", { name: "Marshal" }));
  await user.click(screen.getByRole("button", { name: /invite/i }));
  await waitFor(() => expect(inviteMember).toHaveBeenCalledWith("a1", "crew@x.com", "marshal"));
  await waitFor(() => expect(onInvited).toHaveBeenCalled());
});

it("shows an error when the invite fails", async () => {
  inviteMember.mockResolvedValueOnce({ ok: false, error: "That role can't be assigned." });
  render(<InviteMemberForm orgId="a1" onInvited={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Invite email"), { target: { value: "x@x.com" } });
  fireEvent.click(screen.getByRole("button", { name: /invite/i }));
  expect(await screen.findByRole("alert")).toHaveTextContent("can't be assigned");
});
