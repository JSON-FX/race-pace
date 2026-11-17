import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), eq: vi.fn(), order: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => {
  const table = { select: () => table, eq: mock.eq, order: mock.order };
  mock.eq.mockReturnValue(table);
  return { from: () => table, rpc: mock.rpc };
} }));
import { getPayLaterEvents, getPayLaterGrants } from "./pay-later";
beforeEach(()=>vi.clearAllMocks());
describe("Pay Later queries",()=>{
 it("scopes event options to the chosen organization",async()=>{
   mock.order.mockResolvedValue({data:[],error:null});
   await getPayLaterEvents("org-1");
   expect(mock.eq).toHaveBeenCalledWith("org_id","org-1");
 });
 it("requests one bounded roster page and keeps the server count",async()=>{
   mock.rpc.mockResolvedValue({data:[{id:"grant",total_count:42}],error:null});
   expect(await getPayLaterGrants("event-1",1)).toEqual({rows:[{id:"grant",total_count:42}],total:42});
   expect(mock.rpc).toHaveBeenCalledWith("pay_later_list_grants",{p_event_id:"event-1",p_limit:20,p_offset:20});
 });
 it("reports a failed roster read rather than an empty roster",async()=>{
   mock.rpc.mockResolvedValue({data:null,error:new Error("failed")});
   await expect(getPayLaterGrants("event-1")).rejects.toThrow("failed");
 });
});
