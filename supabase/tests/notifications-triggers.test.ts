import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
const service = () => createClient(url, serviceKey, { auth: { persistSession: false } });
const authed = (t: string) => createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${t}` } }, auth: { persistSession: false } });
async function makeUser(email: string) {
  const svc = service();
  const c = await svc.auth.admin.createUser({ email, password: "password123", email_confirm: true });
  const s = await anon().auth.signInWithPassword({ email, password: "password123" });
  return { id: c.data.user!.id, token: s.data.session!.access_token };
}
async function latestNote(svc: ReturnType<typeof service>, userId: string) {
  const { data } = await svc.from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(1);
  return data?.[0];
}
async function cloneEvent(svc: ReturnType<typeof service>, over: Record<string, unknown>) {
  const base = (await svc.from("events").select("*").eq("id", "00000000-0000-0000-0000-0000000000e1").single()).data!;
  const { id: _i, created_at: _c, ...rest } = base;
  return (await svc.from("events").insert({ ...rest, ...over }).select().single()).data!;
}
async function notesFor(svc: ReturnType<typeof service>, userId: string, type: string) {
  const { data } = await svc.from("notifications").select("type").eq("user_id", userId).eq("type", type);
  return data ?? [];
}

describe("notifications table", () => {
  it("is owner-scoped: a user reads only their own rows and can mark them read", async () => {
    const svc = service();
    const me = await makeUser(`ntf_me_${Date.now()}@test.dev`);
    const other = await makeUser(`ntf_ot_${Date.now()}@test.dev`);
    const ins = await svc.from("notifications").insert({
      user_id: me.id, type: "registered", title: "hi", body: "b", data: {},
    }).select().single();
    expect(ins.error).toBeNull();

    // owner reads it; other user does not
    expect((await authed(me.token).from("notifications").select("id").eq("id", ins.data!.id)).data).toHaveLength(1);
    expect((await authed(other.token).from("notifications").select("id").eq("id", ins.data!.id)).data ?? []).toHaveLength(0);

    // owner can set read_at on their own row
    const upd = await authed(me.token).from("notifications").update({ read_at: new Date().toISOString() }).eq("id", ins.data!.id);
    expect(upd.error).toBeNull();
    // a client cannot INSERT (no insert grant/policy)
    const badInsert = await authed(me.token).from("notifications").insert({ user_id: me.id, type: "paid", title: "x", body: "y", data: {} });
    expect(badInsert.error).not.toBeNull();

    await svc.from("notifications").delete().eq("id", ins.data!.id);
    for (const u of [me, other]) await svc.auth.admin.deleteUser(u.id);
  });
});

describe("device_tokens table", () => {
  it("lets a user upsert and read only their own token", async () => {
    const svc = service();
    const me = await makeUser(`dt_me_${Date.now()}@test.dev`);
    const tok = `ExponentPushToken[${Date.now()}]`;
    const up = await authed(me.token).from("device_tokens").upsert(
      { user_id: me.id, token: tok, platform: "ios" }, { onConflict: "token" });
    expect(up.error).toBeNull();
    expect((await authed(me.token).from("device_tokens").select("token").eq("token", tok)).data).toHaveLength(1);
    await svc.from("device_tokens").delete().eq("token", tok);
    await svc.auth.admin.deleteUser(me.id);
  });
});

describe("checkins table", () => {
  it("is insertable by service role and unique per registration; clients cannot insert", async () => {
    const svc = service();
    const runner = await makeUser(`ci_run_${Date.now()}@test.dev`);
    const reg = await svc.from("registrations").insert({
      org_id: "00000000-0000-0000-0000-0000000000a1", event_id: "00000000-0000-0000-0000-0000000000e1",
      category_id: "00000000-0000-0000-0000-0000000000c4", user_id: runner.id, status: "paid", total_amount: 100000,
    }).select().single();

    const ins = await svc.from("checkins").insert({
      org_id: reg.data!.org_id, registration_id: reg.data!.id, event_id: reg.data!.event_id, checked_in_by: runner.id,
    });
    expect(ins.error).toBeNull();
    // second insert for same registration violates the unique constraint
    const dup = await svc.from("checkins").insert({
      org_id: reg.data!.org_id, registration_id: reg.data!.id, event_id: reg.data!.event_id, checked_in_by: runner.id,
    });
    expect(dup.error).not.toBeNull();
    // a runner cannot insert a check-in (no client insert policy)
    const bad = await authed(runner.token).from("checkins").insert({
      org_id: reg.data!.org_id, registration_id: reg.data!.id, event_id: reg.data!.event_id, checked_in_by: runner.id,
    });
    expect(bad.error).not.toBeNull();

    await svc.from("checkins").delete().eq("registration_id", reg.data!.id);
    await svc.from("registrations").delete().eq("id", reg.data!.id);
    await svc.auth.admin.deleteUser(runner.id);
  });
});

describe("registration trigger", () => {
  it("emits 'registered' on a new pending registration and 'paid' on the paid transition", async () => {
    const svc = service();
    const runner = await makeUser(`rt_run_${Date.now()}@test.dev`);
    const reg = await svc.from("registrations").insert({
      org_id: "00000000-0000-0000-0000-0000000000a1", event_id: "00000000-0000-0000-0000-0000000000e1",
      category_id: "00000000-0000-0000-0000-0000000000c4", user_id: runner.id, status: "pending", total_amount: 100000,
    }).select().single();

    const n1 = await latestNote(svc, runner.id);
    expect(n1?.type).toBe("registered");
    expect(n1?.data.registration_id).toBe(reg.data!.id);

    await svc.from("registrations").update({ status: "paid" }).eq("id", reg.data!.id);
    const n2 = await latestNote(svc, runner.id);
    expect(n2?.type).toBe("paid");

    await svc.from("registrations").delete().eq("id", reg.data!.id);
    await svc.auth.admin.deleteUser(runner.id);
  });
});

describe("event-change trigger", () => {
  it("notifies registrants on cancel/reschedule/complete and broadcasts new events on publish", async () => {
    const svc = service();
    const runner = await makeUser(`et_run_${Date.now()}@test.dev`);
    const ev = await cloneEvent(svc, { name: `ET ${Date.now()}`, status: "open" });
    await svc.from("registrations").insert({
      org_id: ev.org_id, event_id: ev.id, category_id: "00000000-0000-0000-0000-0000000000c4",
      user_id: runner.id, status: "paid", total_amount: 100000,
    });

    await svc.from("events").update({ original_date: "2026-01-01" }).eq("id", ev.id);
    expect((await notesFor(svc, runner.id, "event_rescheduled")).length).toBe(1);
    await svc.from("events").update({ status: "completed" }).eq("id", ev.id);
    expect((await notesFor(svc, runner.id, "event_completed")).length).toBe(1);
    await svc.from("events").update({ status: "cancelled" }).eq("id", ev.id);
    expect((await notesFor(svc, runner.id, "event_cancelled")).length).toBe(1);

    // publish a fresh event (draft -> open) broadcasts to the runner (a profile holder)
    await svc.from("profiles").upsert({ id: runner.id, full_name: "Runner" });
    const draft = await cloneEvent(svc, { name: `NEW ${Date.now()}`, status: "draft" });
    await svc.from("events").update({ status: "open" }).eq("id", draft.id);
    expect((await notesFor(svc, runner.id, "event_created")).length).toBeGreaterThanOrEqual(1);
    // re-publish does not duplicate (dedup_key)
    await svc.from("events").update({ status: "draft" }).eq("id", draft.id);
    await svc.from("events").update({ status: "open" }).eq("id", draft.id);
    expect((await notesFor(svc, runner.id, "event_created")).length).toBe(1);

    await svc.from("notifications").delete().eq("user_id", runner.id);
    // the publish broadcast created event_created rows for every profile — clear them by event
    for (const e of [ev.id, draft.id]) await svc.from("notifications").delete().eq("data->>event_id", e);
    for (const e of [ev.id, draft.id]) await svc.from("events").delete().eq("id", e);
    await svc.auth.admin.deleteUser(runner.id);
  });
});

describe("check-in trigger", () => {
  it("emits 'checked_in' to the registrant when a check-in row is inserted", async () => {
    const svc = service();
    const runner = await makeUser(`ck_run_${Date.now()}@test.dev`);
    const reg = await svc.from("registrations").insert({
      org_id: "00000000-0000-0000-0000-0000000000a1", event_id: "00000000-0000-0000-0000-0000000000e1",
      category_id: "00000000-0000-0000-0000-0000000000c4", user_id: runner.id, status: "paid", total_amount: 100000,
    }).select().single();
    await svc.from("checkins").insert({
      org_id: reg.data!.org_id, registration_id: reg.data!.id, event_id: reg.data!.event_id, checked_in_by: runner.id,
    });
    const n = await latestNote(svc, runner.id);
    expect(n?.type).toBe("checked_in");
    expect(n?.data.registration_id).toBe(reg.data!.id);

    await svc.from("checkins").delete().eq("registration_id", reg.data!.id);
    await svc.from("registrations").delete().eq("id", reg.data!.id);
    await svc.auth.admin.deleteUser(runner.id);
  });
});

describe("event reminders", () => {
  it("enqueues 7-day + 1-day reminders once (idempotent) for paid registrants", async () => {
    const svc = service();
    const runner = await makeUser(`rm_run_${Date.now()}@test.dev`);
    const inDays = (n: number) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    const ev = await cloneEvent(svc, { name: `RM ${Date.now()}`, status: "open", event_date: inDays(7) });
    await svc.from("registrations").insert({
      org_id: ev.org_id, event_id: ev.id, category_id: "00000000-0000-0000-0000-0000000000c4",
      user_id: runner.id, status: "paid", total_amount: 100000,
    });

    await svc.rpc("fn_enqueue_event_reminders");
    await svc.rpc("fn_enqueue_event_reminders"); // second run must not duplicate
    const { data } = await svc.from("notifications").select("id").eq("user_id", runner.id).eq("type", "event_reminder");
    expect(data).toHaveLength(1); // 7 days out today → exactly one reminder

    await svc.from("notifications").delete().eq("user_id", runner.id);
    await svc.from("events").delete().eq("id", ev.id);
    await svc.auth.admin.deleteUser(runner.id);
  });
});
