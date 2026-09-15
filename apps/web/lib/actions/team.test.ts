import { beforeEach, expect, it, vi } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ functions: { invoke } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import {
  inviteMemberAction,
  resendMemberAction,
  changeRoleAction,
} from "./team";
beforeEach(() => invoke.mockReset());
function form() {
  const f = new FormData();
  f.set("orgId", "org");
  f.set("email", "crew@example.com");
  f.set("role", "claiming");
  f.set("eventScope", "event");
  return f;
}
it("passes explicit event scope and reports actual email delivery", async () => {
  invoke.mockResolvedValue({ data: { ok: true, delivery: "sent" } });
  const r = await inviteMemberAction({}, form());
  expect(r.success).toContain("email sent");
  expect(invoke).toHaveBeenCalledWith("org-members", {
    body: expect.objectContaining({ event_scope: "event" }),
  });
});
it("does not claim sent when access was saved but SMTP failed", async () => {
  invoke.mockResolvedValue({
    data: {
      ok: true,
      delivery: "failed",
      invite_link: "https://admin.test/auth/confirm?token_hash=test",
    },
  });
  const r = await inviteMemberAction({}, form());
  expect(r.success).toBeUndefined();
  expect(r.warning).toContain("was not sent");
  expect(r.inviteLink).toContain("token_hash");
});
it("resends without changing role or scope", async () => {
  invoke.mockResolvedValue({ data: { delivery: "sent" } });
  await resendMemberAction("user", "org");
  expect(invoke).toHaveBeenCalledWith("org-members", {
    body: { action: "resend", org_id: "org", user_id: "user" },
  });
});
it("preserves omitted scope but supports an explicit restriction removal", async () => {
  invoke.mockResolvedValue({ data: { ok: true } });
  await changeRoleAction("user", "org", "marshal");
  expect(invoke.mock.calls[0][1].body).not.toHaveProperty("event_scope");
  await changeRoleAction("user", "org", "marshal", null);
  expect(invoke.mock.calls[1][1].body).toHaveProperty("event_scope", null);
});
