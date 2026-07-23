import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMyRoles } from "../lib/roles";

vi.mock("../lib/roles", () => ({ useMyRoles: vi.fn(() => ({ data: { orgId: "a1", isAdmin: true, isOrgAdmin: true } })) }));

const members = [
  { user_id: "u1", email: "ana@x.com", full_name: "Ana", role: "admin" },
  { user_id: "u2", email: "ben@x.com", full_name: "Ben", role: "marshal" },
];
const setMemberRole = vi.fn((..._a: unknown[]): Promise<{ ok: boolean; error?: string }> => Promise.resolve({ ok: true }));
const removeMember = vi.fn((..._a: unknown[]): Promise<{ ok: boolean; error?: string }> => Promise.resolve({ ok: true }));
vi.mock("../lib/team", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/team")>();
  return {
    ...actual,
    useOrgMembers: () => ({ data: members, isLoading: false }),
    setMemberRole: (...a: unknown[]) => setMemberRole(...a),
    removeMember: (...a: unknown[]) => removeMember(...a),
    inviteMember: () => Promise.resolve({ ok: true }),
  };
});

import { Team } from "../routes/Team";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

it("lists members with their details", () => {
  wrap(<Team />);
  expect(screen.getByText("Ana")).toBeInTheDocument();
  expect(screen.getByText("ben@x.com")).toBeInTheDocument();
});

it("changes a member's role", async () => {
  wrap(<Team />);
  fireEvent.change(screen.getByLabelText("Role for ben@x.com"), { target: { value: "editor" } });
  await waitFor(() => expect(setMemberRole).toHaveBeenCalledWith("a1", "u2", "editor"));
});

it("removes a member after confirming in the dialog", async () => {
  wrap(<Team />);
  fireEvent.click(screen.getByLabelText("Remove ben@x.com"));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove member" }));
  await waitFor(() => expect(removeMember).toHaveBeenCalledWith("a1", "u2"));
});

it("clears the error when the remove dialog is cancelled", async () => {
  removeMember.mockResolvedValueOnce({ ok: false, error: "Couldn't remove the member." });
  wrap(<Team />);
  fireEvent.click(screen.getByLabelText("Remove ben@x.com"));
  fireEvent.click(screen.getByRole("button", { name: "Remove member" }));
  expect(await screen.findByText("Couldn't remove the member.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByText("Couldn't remove the member.")).toBeNull();
});

it("shows an admin-only notice for a non-org-admin (editor)", () => {
  (useMyRoles as unknown as { mockReturnValueOnce: (v: unknown) => void }).mockReturnValueOnce({ data: { orgId: "a1", isAdmin: true, isOrgAdmin: false } });
  wrap(<Team />);
  expect(screen.getByText(/organization admins only/i)).toBeInTheDocument();
  expect(screen.queryByText("Ana")).toBeNull();
});
