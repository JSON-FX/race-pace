import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const service = () => createClient(url, serviceKey, { auth: { persistSession: false } });

describe("platform user session revocation", () => {
  it("is service-role only and invalidates the target refresh session", async () => {
    const admin = service();
    const email = `platform-suspend-${Date.now()}@test.dev`;
    const created = await admin.auth.admin.createUser({ email, password: "password123", email_confirm: true });
    expect(created.error).toBeNull();
    const userId = created.data.user!.id;

    try {
      const runner = createClient(url, anonKey, { auth: { persistSession: false } });
      const signedIn = await runner.auth.signInWithPassword({ email, password: "password123" });
      expect(signedIn.error).toBeNull();

      const anonCall = await createClient(url, anonKey).rpc("platform_revoke_user_sessions", { p_user_id: userId });
      expect(anonCall.error?.code).toBe("42501");

      const runnerCall = await runner.rpc("platform_revoke_user_sessions", { p_user_id: userId });
      expect(runnerCall.error?.code).toBe("42501");

      const revoked = await admin.rpc("platform_revoke_user_sessions", { p_user_id: userId });
      expect(revoked.error).toBeNull();
      expect(revoked.data).toBeGreaterThanOrEqual(1);

      const refreshed = await runner.auth.refreshSession();
      expect(refreshed.error).not.toBeNull();
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });
});
