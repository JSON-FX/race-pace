import { afterAll, beforeAll, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";
const { url, anonKey, serviceKey } = loadEnv();
const s = createClient(url, serviceKey, { auth: { persistSession: false } });
const ck = <T>(r: { data: T; error: unknown }): T => {
  if (r.error) throw r.error;
  return r.data;
};
let org: string,
  event: string,
  other: string,
  rid: string,
  crew: string,
  admin: string,
  runner: string,
  request: string,
  kit: unknown;
let c: SupabaseClient, a: SupabaseClient, u: SupabaseClient;
const users: string[] = [];
async function person(role?: string) {
  const email = `kit-${crypto.randomUUID()}@test.dev`;
  const user = ck(
    await s.auth.admin.createUser({
      email,
      password: "password123",
      email_confirm: true,
    }),
  ).user!;
  users.push(user.id);
  if (role)
    ck(
      await s
        .from("user_roles")
        .insert({ user_id: user.id, org_id: org, role }),
    );
  const client = createClient(url, anonKey, {
    auth: { persistSession: false },
  });
  ck(await client.auth.signInWithPassword({ email, password: "password123" }));
  return { id: user.id, client };
}
const release = (extra = {}) =>
  s
    .rpc("kit_release_tx", {
      p_registration_id: rid,
      p_event_id: event,
      p_actor_id: crew,
      p_request_id: request,
      p_expected_kit: kit,
      ...extra,
    })
    .then(ck);
beforeAll(async () => {
  org = ck(
    await s
      .from("organizations")
      .insert({
        name: "Kit QA",
        slug: crypto.randomUUID(),
        refund_policy: "full",
      })
      .select()
      .single(),
  ).id;
  const events = ck(
    await s
      .from("events")
      .insert([
        { org_id: org, name: "Kit A" },
        { org_id: org, name: "Kit B" },
      ])
      .select(),
  )!;
  event = events[0].id;
  other = events[1].id;
  const cat = ck(
    await s
      .from("categories")
      .insert({
        org_id: org,
        event_id: event,
        code: "10k",
        label: "10K",
        base_price: 10000,
        slots_total: 10,
      })
      .select()
      .single(),
  );
  const ar = await person("admin"),
    cr = await person("claiming"),
    ur = await person();
  admin = ar.id;
  a = ar.client;
  crew = cr.id;
  c = cr.client;
  runner = ur.id;
  u = ur.client;
  rid = ck(
    await s
      .from("registrations")
      .insert({
        org_id: org,
        event_id: event,
        category_id: cat.id,
        user_id: runner,
        status: "paid",
        total_amount: 10000,
        custom_data: {
          full_name: "Kit Runner",
          shirt_size: "M",
          emergency_contact: "PRIVATE",
        },
      })
      .select()
      .single(),
  ).id;
  const ad = ck(
    await s
      .from("addons")
      .insert({
        org_id: org,
        event_id: event,
        name: "Finish towel",
        price: 100,
      })
      .select()
      .single(),
  );
  ck(
    await s
      .from("registration_addons")
      .insert({ registration_id: rid, addon_id: ad.id, price: 100 }),
  );
  ck(
    await s
      .from("payments")
      .insert({
        org_id: org,
        registration_id: rid,
        provider: "fake",
        provider_ref: `fake_${rid}`,
        amount: 10000,
        status: "paid",
        platform_fee: 0,
        net_to_org: 10000,
        processor_fee_cents: 0,
        processor_fee_source: "none",
      }),
  );
  kit = ck(await s.rpc("kit_snapshot", { p_registration_id: rid }));
  request = crypto.randomUUID();
});
afterAll(async () => {
  if (rid) ck(await s.from("registrations").delete().eq("id", rid));
  if (org) ck(await s.from("organizations").delete().eq("id", org));
  for (const id of users) ck(await s.auth.admin.deleteUser(id));
});
it("keeps kit staff scoped and exposes only operational data", async () => {
  const rows = ck(await c.rpc("kit_release_roster", { p_event_id: event }));
  expect(rows).toHaveLength(1);
  expect(JSON.stringify(rows)).not.toContain("PRIVATE");
  expect(rows[0].kit).toMatchObject({
    shirt_size: "M",
    addons: [{ name: "Finish towel" }],
  });
  expect(ck(await c.from("registrations").select("id").eq("id", rid))).toEqual(
    [],
  );
  expect(
    ck(await c.from("payments").select("id").eq("registration_id", rid)),
  ).toEqual([]);
  ck(
    await s
      .from("user_roles")
      .update({ event_scope: other })
      .eq("user_id", crew),
  );
  expect(ck(await c.rpc("kit_release_roster", { p_event_id: event }))).toEqual(
    [],
  );
  expect(await release()).toMatchObject({ error: "forbidden" });
  ck(
    await s
      .from("user_roles")
      .update({ event_scope: null })
      .eq("user_id", crew),
  );
  expect(await release({ p_event_id: other })).toMatchObject({
    error: "wrong_event",
  });
  expect(
    (
      await c.rpc("kit_release_tx", {
        p_registration_id: rid,
        p_event_id: event,
        p_actor_id: admin,
        p_request_id: request,
        p_expected_kit: kit,
      })
    ).error,
  ).toBeTruthy();
  expect(
    (await c.from("kit_releases").insert({ id: request })).error,
  ).toBeTruthy();
});
it("blocks unpaid/refunded entries, pending refunds, and stale kit details", async () => {
  for (const status of ["pending", "refunded"]) {
    ck(await s.from("registrations").update({ status }).eq("id", rid));
    expect(await release()).toMatchObject({ error: "not_paid" });
  }
  ck(await s.from("registrations").update({ status: "paid" }).eq("id", rid));
  const claim = ck(
    await s.rpc("refund_request_claim", {
      p_registration_id: rid,
      p_refunded_by: admin,
      p_note: "kit QA pending",
      p_provider_scope: "fake",
    }),
  );
  expect(claim.action).toBe("submit");
  expect(await release()).toMatchObject({ error: "refund_pending" });
  ck(
    await s
      .from("refund_requests")
      .update({ status: "failed" })
      .eq("id", claim.request.id),
  );
  ck(await s.from("payments").update({ raw: {} }).eq("registration_id", rid));
  expect(
    await release({ p_expected_kit: { shirt_size: "XL", addons: [] } }),
  ).toMatchObject({ error: "kit_changed" });
});
it("releases once under concurrent requests and locks runner shirt edits", async () => {
  const results = await Promise.all([
    release(),
    release(),
    release({ p_request_id: crypto.randomUUID() }),
  ]);
  expect(results.filter((r) => r.ok && !r.already)).toHaveLength(1);
  expect(results.every((r) => r.ok)).toBe(true);
  // The concurrent different request may win. Retain the actual active ID.
  const active = ck(
    await s
      .from("kit_releases")
      .select("*")
      .eq("registration_id", rid)
      .is("reversed_at", null)
      .single(),
  );
  request = active.id;
  expect(active).toMatchObject({
    recipient_name: "Kit Runner",
    kit,
    released_by: crew,
  });
  expect(
    ck(
      await s
        .from("registration_audit")
        .select("id")
        .eq("registration_id", rid)
        .eq("action", "kit_released"),
    ),
  ).toHaveLength(1);
  expect(
    ck(await u.from("kit_releases").select("id").eq("registration_id", rid)),
  ).toHaveLength(1);
  expect(
    ck(
      await u.rpc("update_registration_fields_tx", {
        p_registration_id: rid,
        p_changes: { shirt_size: "L" },
      }),
    ),
  ).toBe("collected");
});
it("allows only admin reversal with a reason; replay cannot release a reversed request", async () => {
  const args = {
    p_registration_id: rid,
    p_event_id: event,
    p_actor_id: crew,
    p_release_id: request,
    p_reason: "Wrong handoff",
  };
  expect(ck(await s.rpc("kit_release_reverse_tx", args))).toMatchObject({
    error: "forbidden",
  });
  expect(
    ck(
      await s.rpc("kit_release_reverse_tx", {
        ...args,
        p_actor_id: admin,
        p_reason: " ",
      }),
    ),
  ).toMatchObject({ error: "reason_required" });
  expect(
    ck(await s.rpc("kit_release_reverse_tx", { ...args, p_actor_id: admin })),
  ).toMatchObject({ ok: true });
  expect(
    ck(await s.rpc("kit_release_reverse_tx", { ...args, p_actor_id: admin })),
  ).toMatchObject({ already: true });
  expect(await release()).toMatchObject({ error: "release_reversed" });
  expect(
    ck(
      await s
        .from("registration_audit")
        .select("detail")
        .eq("registration_id", rid)
        .eq("action", "kit_release_reversed"),
    ),
  ).toMatchObject([{ detail: { reason: "Wrong handoff" } }]);
  expect(
    ck(
      await u.rpc("update_registration_fields_tx", {
        p_registration_id: rid,
        p_changes: { shirt_size: "L" },
      }),
    ),
  ).toBe("ok");
  const historical = ck(
    await u.from("kit_releases").select("kit").eq("id", request).single(),
  );
  expect(historical.kit.shirt_size).toBe("M");
});
it("requires runner presence at the Edge boundary and supports a new corrected release", async () => {
  kit = ck(await s.rpc("kit_snapshot", { p_registration_id: rid }));
  const id = crypto.randomUUID();
  const body = {
    action: "release",
    event_id: event,
    registration_id: rid,
    request_id: id,
    expected_kit: kit,
  };
  const invalid = await c.functions.invoke("kit-release", { body });
  expect(invalid.error?.context.status).toBe(400);
  const valid = await c.functions.invoke("kit-release", {
    body: { ...body, runner_present: true, recipient_name: "Injected proxy" },
  });
  expect(valid.error).toBeNull();
  expect(valid.data).toMatchObject({ ok: true });
  expect(
    ck(
      await s
        .from("kit_releases")
        .select("recipient_name,kit")
        .eq("id", id)
        .single(),
    ),
  ).toMatchObject({ recipient_name: "Kit Runner", kit: { shirt_size: "L" } });
});
it("denies other organizations, runner mutations and forged scans", async () => {
  const foreignOrg = ck(await s.from("organizations").insert({name:"Kit isolation",slug:crypto.randomUUID()}).select("id").single()).id;
  const outsider = await person();
  try {
    ck(await s.from("user_roles").insert({user_id:outsider.id,org_id:foreignOrg,role:"admin"}));
    expect(ck(await outsider.client.rpc("kit_release_events"))).toEqual([]);
    expect(ck(await outsider.client.rpc("kit_release_roster",{p_event_id:event}))).toEqual([]);
    expect(ck(await outsider.client.from("kit_releases").select("id").eq("registration_id",rid))).toEqual([]);
    expect(await release({p_actor_id:outsider.id})).toMatchObject({error:"forbidden"});
    const base={action:"release",registration_id:rid,event_id:event,request_id:crypto.randomUUID(),expected_kit:kit,runner_present:true};
    const denied = await u.functions.invoke("kit-release",{body:base});
    expect(denied.error?.context.status).toBe(403);
    const forged = await c.functions.invoke("kit-release",{body:{...base,ticket_token:"forged.signature"}});
    expect(forged.error?.context.status).toBe(400);
    expect((await u.from("kit_releases").update({reversed_at:new Date().toISOString()}).eq("registration_id",rid)).error).toBeTruthy();
    expect((await c.from("kit_releases").delete().eq("registration_id",rid)).error).toBeTruthy();
  } finally {
    ck(await s.from("organizations").delete().eq("id",foreignOrg));
  }
});
