import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ roles: vi.fn(), rpc: vi.fn(), refresh: vi.fn(), event: vi.fn() }));
vi.mock("@/lib/queries/roles", () => ({ getMyRoles: m.roles }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: m.rpc, from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: m.event }) }) }) }) }) }));
vi.mock("next/cache", () => ({ revalidatePath: m.refresh }));
import { publishWaiverAction, selectEventWaiverAction } from "./waivers";
const org = "11111111-1111-4111-8111-111111111111", version = "22222222-2222-4222-8222-222222222222";
function form() { const f = new FormData(); Object.entries({ orgId: org, versionId: version, title: "Waiver", body: "Exact text\nNext line", reviewed: "on" }).forEach(([k,v]) => f.set(k,v)); return f; }
beforeEach(() => { vi.clearAllMocks(); m.roles.mockResolvedValue({ isOrgAdmin: true, orgId: org }); m.rpc.mockResolvedValue({ data: version, error: null }); });
it("publishes reviewed exact text through the checked RPC", async () => {
 expect((await publishWaiverAction({}, form())).success).toBeTruthy();
 expect(m.rpc).toHaveBeenCalledWith("organizer_publish_waiver", { p_org_id: org, p_version_id: version, p_title: "Waiver", p_body: "Exact text\nNext line" });
 expect(m.refresh).toHaveBeenCalledWith("/settings");
});
it.each([{ isOrgAdmin: false, orgId: org }, { isOrgAdmin: true, orgId: version }, null])("denies unauthorized scope %j", async roles => {
 m.roles.mockResolvedValue(roles); expect((await publishWaiverAction({}, form())).error).toBeTruthy(); expect(m.rpc).not.toHaveBeenCalled();
});
it("requires explicit review", async () => { const f=form(); f.delete("reviewed"); expect((await publishWaiverAction({}, f)).error).toBeTruthy(); expect(m.rpc).not.toHaveBeenCalled(); });
it("does not report success for an RPC failure", async () => { m.rpc.mockResolvedValue({ data: null, error: { message: "secret" } }); const r=await publishWaiverAction({}, form()); expect(r.error).toBeTruthy(); expect(r.error).not.toContain("secret"); expect(m.refresh).not.toHaveBeenCalled(); });

it("selects a published version for an event in the active organization", async () => {
 m.event.mockResolvedValue({ data: { id: version } });
 const f = new FormData(); Object.entries({ orgId: org, eventId: version, waiverId: version }).forEach(([k,v]) => f.set(k,v));
 expect((await selectEventWaiverAction({}, f)).success).toBeTruthy();
 expect(m.rpc).toHaveBeenCalledWith("event_select_waiver", { p_event_id: version, p_version_id: version });
});
it("refuses an event outside the active organization before the privileged RPC", async () => {
 m.event.mockResolvedValue({ data: null });
 const f = new FormData(); Object.entries({ orgId: org, eventId: version, waiverId: version }).forEach(([k,v]) => f.set(k,v));
 expect((await selectEventWaiverAction({}, f)).error).toBeTruthy(); expect(m.rpc).not.toHaveBeenCalled();
});
