import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mocks.user } }) } }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
import Callback from "./page";
it("preserves the paid return hint through sign-in", async () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  mocks.user = null;
  await expect(Callback({ searchParams: Promise.resolve({ reservation_id: id, status: "paid" }) }))
    .rejects.toThrow(`/sign-in?next=${encodeURIComponent(`/reservations/${id}?returned=1`)}`);
});
