import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../lib/supabase", () => {
  const invoke = vi.fn(() => Promise.resolve({ data: { ok: true, members: [{ user_id: "u1", email: "a@x.com", full_name: "Ana", role: "editor" }] }, error: null }));
  return { supabase: { functions: { invoke } } };
});

import { supabase } from "../lib/supabase";
import { useOrgMembers, inviteMember, setMemberRole, removeMember } from "../lib/team";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

it("useOrgMembers returns the members list from the function", async () => {
  const { result } = renderHook(() => useOrgMembers("a1"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toHaveLength(1));
  expect(result.current.data![0]).toMatchObject({ user_id: "u1", email: "a@x.com", role: "editor" });
  expect(supabase.functions.invoke).toHaveBeenCalledWith("org-members", { body: { action: "list", org_id: "a1" } });
});

it("inviteMember posts the invite action", async () => {
  const res = await inviteMember("a1", "New@X.com", "marshal");
  expect(res.ok).toBe(true);
  expect(supabase.functions.invoke).toHaveBeenCalledWith("org-members", { body: { action: "invite", org_id: "a1", email: "New@X.com", role: "marshal" } });
});

it("setMemberRole posts the setRole action", async () => {
  await setMemberRole("a1", "u1", "admin");
  expect(supabase.functions.invoke).toHaveBeenCalledWith("org-members", { body: { action: "setRole", org_id: "a1", user_id: "u1", role: "admin" } });
});

it("removeMember posts the remove action", async () => {
  await removeMember("a1", "u1");
  expect(supabase.functions.invoke).toHaveBeenCalledWith("org-members", { body: { action: "remove", org_id: "a1", user_id: "u1" } });
});

it("maps a 409 error to the last-admin message", async () => {
  (supabase.functions.invoke as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({ data: null, error: { context: { status: 409 } } });
  const res = await removeMember("a1", "u1");
  expect(res.ok).toBe(false);
  expect(res.error).toMatch(/at least one admin/);
});

it("maps a 502 error to the invite-failed message", async () => {
  (supabase.functions.invoke as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({ data: null, error: { context: { status: 502 } } });
  const res = await inviteMember("a1", "x@x.com", "editor");
  expect(res.ok).toBe(false);
  expect(res.error).toMatch(/send the invite/i);
});
