import { afterAll, beforeAll, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";
import { mintTicketToken } from "../functions/_shared/ticket";
const { url, anonKey, serviceKey } = loadEnv();
const service = createClient(url, serviceKey, { auth: { persistSession: false } });
const staff = createClient(url, anonKey, { auth: { persistSession: false } });
// The local serve command loads this ignored file. An explicit environment
// override also supports a separately configured test runtime. Never log it.
const functionEnv = new URL("../functions/.env", import.meta.url);
const signingSecret = process.env.TICKET_SIGNING_SECRET
  ?? (existsSync(functionEnv) ? parse(readFileSync(functionEnv)).TICKET_SIGNING_SECRET : undefined)
  ?? "dev-secret";
let org: string, event: string, otherEvent: string, user: string, registration: string, ticket: string;
async function checked<T>(result: { data: T; error: unknown }): Promise<T> {
  if (result.error) throw result.error;
  return result.data;
}
async function scan(body: Record<string, unknown>) {
  const { data, error } = await staff.functions.invoke("check-in", { body });
  if (!error) return { status: 200, body: data };
  const response = error.context as Response;
  return { status: response.status, body: await response.json() };
}
beforeAll(async () => {
  const stamp = crypto.randomUUID();
  const u = await checked(await service.auth.admin.createUser({ email: `checkin-${stamp}@test.dev`, password: "password123", email_confirm: true }));
  user = u.user!.id;
  await checked(await staff.auth.signInWithPassword({ email: u.user!.email!, password: "password123" }));
  const o = await checked(await service.from("organizations").insert({ name: "Check-in station test", slug: stamp }).select().single()); org = o.id;
  await checked(await service.from("user_roles").insert({ user_id: user, role: "admin", org_id: org }));
  const events = await checked(await service.from("events").insert([{ org_id: org, name: "Race A" }, { org_id: org, name: "Race B" }]).select());
  event = events![0].id; otherEvent = events![1].id;
  const c = await checked(await service.from("categories").insert({ org_id: org, event_id: event, code: "10k", label: "10K", base_price: 10000, slots_total: 10 }).select().single());
  const r = await checked(await service.from("registrations").insert({ org_id: org, event_id: event, category_id: c.id, user_id: user, status: "paid", total_amount: 10000 }).select().single()); registration = r.id;
  ticket = await mintTicketToken({ rid: registration, eid: event, iat: Math.floor(Date.now() / 1000) }, signingSecret);
});
afterAll(async () => {
  if (org) await checked(await service.from("organizations").delete().eq("id", org));
  if (user) await checked(await service.auth.admin.deleteUser(user));
});
it("requires the station event and rejects a wrong-event ticket without inserting", async () => {
  expect(await scan({ ticket_token: ticket })).toMatchObject({ status: 400, body: { error: "event_id_required" } });
  expect(await scan({ ticket_token: ticket, event_id: {} })).toMatchObject({ status: 400, body: { error: "event_id_required" } });
  expect(await scan({ ticket_token: ticket, event_id: otherEvent })).toMatchObject({ status: 409, body: { error: "wrong_event" } });
  const mismatchedSignature = await mintTicketToken({ rid: registration, eid: otherEvent, iat: 1 }, signingSecret);
  expect(await scan({ ticket_token: mismatchedSignature, event_id: event })).toMatchObject({ status: 400, body: { error: "invalid_ticket" } });
  expect(await checked(await service.from("checkins").select("id").eq("registration_id", registration))).toHaveLength(0);
});
it("accepts the matching event once and preserves duplicate handling", async () => {
  expect(await scan({ ticket_token: ticket, event_id: event })).toMatchObject({ status: 200, body: { ok: true, registration_id: registration } });
  expect(await scan({ ticket_token: ticket, event_id: event })).toMatchObject({ status: 200, body: { already: true } });
  expect(await scan({ ticket_token: ticket, event_id: otherEvent })).toMatchObject({ status: 409, body: { error: "wrong_event" } });
  expect(await checked(await service.from("checkins").select("id").eq("registration_id", registration))).toHaveLength(1);
  await checked(await staff.rpc("checkin_undo", { p_registration_id: registration }));
  await checked(await staff.rpc("checkin_undo", { p_registration_id: registration }));
  const audit = await checked(await service.from("registration_audit").select("action,actor_id,detail").eq("registration_id", registration).order("created_at"));
  expect(audit!.map(a => a.action)).toEqual(["checked_in", "checkin_undone"]);
  expect(audit!.every(a => a.actor_id === user)).toBe(true);
  expect(audit![1].detail.checkin_id).toBe(audit![0].detail.checkin_id);
  expect(await checked(await staff.rpc("checkin_history", { p_event_id: event }))).toHaveLength(2);
  expect((await staff.rpc("checkin_record_tx", { p_registration_id: registration, p_event_id: event, p_actor_id: user })).error).toBeTruthy();
});
it("retains marshal scope and unpaid/refunded restrictions", async () => {
  await checked(await service.from("user_roles").update({ role: "marshal", event_scope: otherEvent }).eq("user_id", user));
  expect(await scan({ ticket_token: ticket, event_id: event })).toMatchObject({ status: 403, body: { error: "forbidden" } });
  expect(await checked(await staff.rpc("checkin_history", { p_event_id: event }))).toEqual([]);
  await checked(await service.from("user_roles").update({ event_scope: event }).eq("user_id", user));
  for (const status of ["pending", "refunded"]) {
    await checked(await service.from("registrations").update({ status }).eq("id", registration));
    expect(await scan({ ticket_token: ticket, event_id: event })).toMatchObject({ status: 409, body: { error: "not_paid" } });
  }
  expect(await checked(await service.from("checkins").select("id").eq("registration_id", registration))).toHaveLength(0);
});
