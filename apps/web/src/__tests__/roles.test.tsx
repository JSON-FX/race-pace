import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const rows = { current: [] as Array<{ role: string; org_id: string | null }> };

vi.mock("../lib/supabase", () => ({
  supabase: { from: () => ({ select: () => Promise.resolve({ data: rows.current, error: null }) }) },
}));
vi.mock("../lib/auth", () => ({ useAuth: () => ({ session: { user: { id: "u1" } } }) }));

import { useMyRoles } from "../lib/roles";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

it("a pure marshal is not an admin but can check in", async () => {
  rows.current = [{ role: "marshal", org_id: "a1" }];
  const { result } = renderHook(() => useMyRoles(), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toBeTruthy());
  expect(result.current.data).toMatchObject({ isAdmin: false, isMarshal: true, canCheckIn: true });
});

it("an admin can check in without holding a marshal row", async () => {
  rows.current = [{ role: "admin", org_id: "a1" }];
  const { result } = renderHook(() => useMyRoles(), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toBeTruthy());
  expect(result.current.data).toMatchObject({ isAdmin: true, isMarshal: false, canCheckIn: true });
});

it("roles are additive — an admin who is also a marshal is still an admin", async () => {
  rows.current = [{ role: "admin", org_id: "a1" }, { role: "marshal", org_id: "a1" }];
  const { result } = renderHook(() => useMyRoles(), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toBeTruthy());
  expect(result.current.data).toMatchObject({ isAdmin: true, isMarshal: true, canCheckIn: true, orgId: "a1" });
});

it("a plain user can do neither", async () => {
  rows.current = [{ role: "user", org_id: "a1" }];
  const { result } = renderHook(() => useMyRoles(), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toBeTruthy());
  expect(result.current.data).toMatchObject({ isAdmin: false, isMarshal: false, canCheckIn: false });
});
