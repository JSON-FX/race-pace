import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  roles: vi.fn(), rpc: vi.fn(), event: vi.fn(), revalidate: vi.fn(), list: vi.fn(),
}));
vi.mock("@/lib/queries/roles", () => ({ getMyRoles: mocks.roles }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/queries/pay-later", () => ({ getPayLaterGrants: mocks.list }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: mocks.event };
  return { from: () => chain, rpc: mocks.rpc };
} }));
import { grantPayLaterAction, listPayLaterGrantsAction, searchPayLaterRunnersAction } from "./pay-later";
const eventId = "11111111-1111-4111-8111-111111111111";
const runnerId = "22222222-2222-4222-8222-222222222222";
const input = { eventId, runnerId, dueDate: "2027-02-21" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.roles.mockResolvedValue({ isOrgAdmin: true, orgId: "org-1" });
  mocks.event.mockResolvedValue({ data: { id: eventId }, error: null });
  mocks.rpc.mockResolvedValue({ data: { id: "grant-1" }, error: null });
  mocks.list.mockResolvedValue({ rows: [{ id: "grant-1", due_date: "2027-02-21" }], total: 1 });
});

describe("Pay Later server actions", () => {
  it("rejects editors before contacting the RPC", async () => {
    mocks.roles.mockResolvedValue({ isOrgAdmin: false, isAdmin: true, orgId: "org-1" });
    expect((await grantPayLaterAction(input)).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects an event outside the active organization", async () => {
    mocks.event.mockResolvedValue({ data: null, error: null });
    expect((await searchPayLaterRunnersAction({ eventId, query: "Juan" })).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects invalid civil dates before making a request", async () => {
    expect((await grantPayLaterAction({ ...input, dueDate: "2027-02-30" })).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("passes only event, runner and date and revalidates on success", async () => {
    expect((await grantPayLaterAction(input)).ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("pay_later_grant", {p_event_id:eventId,p_user_id:runnerId,p_due_date:input.dueDate});
    expect(mocks.revalidate).toHaveBeenCalledWith("/registrations/pay-later");
  });
  it("never reports success for an unconfirmed write", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const result = await grantPayLaterAction(input);
    expect(result.ok).toBe(false);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("bounds search and pagination before contacting the database", async () => {
    expect((await searchPayLaterRunnersAction({eventId,query:""})).ok).toBe(false);
    expect((await listPayLaterGrantsAction({eventId,page:-1})).ok).toBe(false);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("keeps search text intact for the SQL authorization and escaping boundary", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect((await searchPayLaterRunnersAction({eventId,query:"  juan@example.test  "})).ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("pay_later_search_runners",{p_event_id:eventId,p_query:"juan@example.test"});
  });
  it("loads the granted record by id even when it is outside the first roster page", async () => {
    await grantPayLaterAction(input);
    expect(mocks.list).toHaveBeenCalledWith(eventId, 0, "grant-1");
  });
  it("explains ordinary registrations instead of confirming new eligibility", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({data:null,error:{code:"23505",message:"already_registered"}});
    const result = await grantPayLaterAction(input);
    expect(result).toEqual({ok:false,error:expect.stringContaining("already has a registration")});
    expect(mocks.list).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  it("maps database errors without leaking SQL details", async () => {
    vi.spyOn(console,"error").mockImplementation(()=>{});
    mocks.rpc.mockResolvedValue({ data: null, error: { code:"42501",message:"secret SQL" } });
    const result = await grantPayLaterAction(input);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret SQL");
    vi.restoreAllMocks();
  });
});
