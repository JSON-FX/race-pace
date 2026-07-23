import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const inviteMember = vi.fn((..._a: unknown[]): Promise<{ ok: boolean; error?: string }> => Promise.resolve({ ok: true }));
vi.mock("../lib/team", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/team")>();
  return { ...actual, inviteMember: (...a: unknown[]) => inviteMember(...a) };
});

import { InviteMemberForm } from "../components/InviteMemberForm";

it("submits an invite with the entered email and selected role", async () => {
  const onInvited = vi.fn();
  render(<InviteMemberForm orgId="a1" onInvited={onInvited} />);
  fireEvent.change(screen.getByLabelText("Invite email"), { target: { value: "crew@x.com" } });
  fireEvent.change(screen.getByLabelText("Role"), { target: { value: "marshal" } });
  fireEvent.click(screen.getByRole("button", { name: /invite/i }));
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
