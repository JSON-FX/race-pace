import { expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";
import { seededIds } from "../../test/seeded";

it("records confirmation time once and retains it through replay and refund", async () => {
  const { url, serviceKey } = loadEnv();
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const ids = await seededIds();
  const { data: user, error: userError } = await db.auth.admin.createUser({ email: `report-date-${Date.now()}@example.com`, email_confirm: true });
  expect(userError).toBeNull();
  let rid: string | undefined;
  let occupied = false;
  try {
    const reg = await db.from("registrations").insert({ org_id: ids.ORG_A, event_id: ids.EVENT_A, category_id: ids.CATEGORY_A, user_id: user.user!.id, status: "pending", total_amount: 100000, waiver_version_id: ids.WAIVER_A }).select("id").single();
    expect(reg.error).toBeNull(); rid = reg.data!.id;
    expect((await db.from("payments").insert({ org_id: ids.ORG_A, registration_id: rid, amount: 100000, platform_fee: 3000, net_to_org: 95500, status: "pending", created_at: "2020-01-01T00:00:00Z" })).error).toBeNull();
    const args = { p_registration_id: rid, p_method: "gcash", p_fee: 3000, p_net: 95500, p_token: "test-token", p_raw: {}, p_processor_fee: 1500, p_processor_fee_predicted: 1500, p_processor_fee_source: "predicted" };
    const confirmed = await db.rpc("confirm_payment_tx", args);
    expect(confirmed.error).toBeNull(); expect(confirmed.data).toBe("paid"); occupied = true;
    const first = (await db.from("payments").select("paid_at,created_at").eq("registration_id", rid).single()).data!;
    expect(Date.parse(first.paid_at)).toBeGreaterThan(Date.parse(first.created_at));
    const audit = await db.from("registration_audit").select("created_at").eq("registration_id", rid).eq("action", "paid").single();
    expect(Date.parse(first.paid_at)).toBe(Date.parse(audit.data!.created_at));
    expect((await db.rpc("confirm_payment_tx", args)).data).toBe("already");
    const refunded = await db.rpc("refund_registration_tx", { p_registration_id: rid, p_refunded_by: user.user!.id, p_note: "report QA", p_provider_refund: { provider: "fake" } });
    expect(refunded.error).toBeNull(); occupied = false;
    const after = (await db.from("payments").select("paid_at,raw,refunded_amount").eq("registration_id", rid).single()).data!;
    expect(after.paid_at).toBe(first.paid_at);
    expect(Number.isFinite(Date.parse(after.raw.refunded_at))).toBe(true);
    expect(after.refunded_amount).toBe(95500);
  } finally {
    if (occupied) await db.rpc("decrement_slot", { p_category_id: ids.CATEGORY_A });
    if (rid) await db.from("registrations").delete().eq("id", rid);
    await db.auth.admin.deleteUser(user.user!.id);
  }
});
