import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { loadEnv } from "../../test/env";
const env = loadEnv(),
  db = new Client({ connectionString: env.dbUrl });
const svc = createClient(env.url, env.serviceKey, {
  auth: { persistSession: false },
});
const org = randomUUID(),
  event = randomUUID(),
  category = randomUUID(),
  waiver = randomUUID();
let actor: string, passport: string, registration: string;
async function code(input: Record<string, unknown> = {}) {
  const id = randomUUID();
  await db.query(
    `insert into discount_codes(id,org_id,code,kind,discount_type,value,coverage,created_by,max_uses,absorb_fees)
 values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      org,
      input.code ?? "SAVE20",
      input.kind ?? "regular",
      input.type ?? "percent",
      input.value ?? 2000,
      input.coverage ?? "subtotal",
      actor,
      input.max ?? null,
      input.absorb ?? false,
    ],
  );
  return id;
}
async function apply(value = "SAVE20", id = registration) {
  const r = await svc.rpc("discount_apply", {
    p_actor: actor,
    p_registration: id,
    p_code: value,
  });
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
beforeAll(async () => {
  await db.connect();
  await db.query(
    "select set_config('request.jwt.claim.role','service_role',false)",
  );
  const user = await svc.auth.admin.createUser({
    email: `discount-${randomUUID()}@example.com`,
    password: "password123",
    email_confirm: true,
  });
  if (user.error) throw user.error;
  actor = user.data.user.id;
  passport = (
    await db.query("select id from runner_passports where claimed_user_id=$1", [
      actor,
    ])
  ).rows[0].id;
  await db.query(
    "insert into organizations(id,name,slug,fee_mode,commission_rate) values($1::uuid,'Discount QA',$1::text,'pass_on',0.1)",
    [org],
  );
  await db.query(
    "insert into organizer_waiver_versions(id,org_id,title,body) values($1,$2,'QA','QA waiver')",
    [waiver, org],
  );
  await db.query(
    "insert into events(id,org_id,name,status,waiver_version_id) values($1,$2,'Discount QA','open',$3)",
    [event, org, waiver],
  );
  await db.query(
    "insert into categories(id,org_id,event_id,code,label,base_price,slots_total) values($1,$2,$3,'D','Discount',100000,100)",
    [category, org, event],
  );
});
beforeEach(async () => {
  await db.query("delete from discount_redemptions where org_id=$1", [org]);
  await db.query("delete from discount_codes where org_id=$1", [org]);
  for (const table of [
    "booking_order_deliveries",
    "booking_payment_allocations",
    "booking_payment_captures",
    "booking_payment_dispatches",
    "booking_payment_attempts",
  ])
    await db.query(`delete from ${table} where org_id=$1`, [org]);
  await db.query("delete from registration_audit where org_id=$1", [org]);
  await db.query("delete from payments where org_id=$1", [org]);
  await db.query("delete from registrations where org_id=$1", [org]);
  await db.query("delete from booking_orders where org_id=$1", [org]);
  await db.query("update categories set slots_taken=0 where org_id=$1", [org]);
  await db.query(
    "update organizations set fee_mode='pass_on',commission_type='percent',commission_rate=0.1,commission_flat_cents=0 where id=$1",
    [org],
  );
  registration = randomUUID();
  await db.query(
    `insert into registrations(id,org_id,event_id,category_id,user_id,booked_by_user_id,participant_passport_id,total_amount,waiver_version_id,waiver_accepted_at,expires_at)
 values($1,$2,$3,$4,$5,$5,$6,100000,$7,now(),now()+interval '1 hour')`,
    [registration, org, event, category, actor, passport, waiver],
  );
  await db.query(
    `insert into payments(org_id,registration_id,provider,amount,discount_checkout_state,checkout_request,checkout_fee_mode,checkout_platform_fee,checkout_provider_managed_fee)
 values($1,$2,'paymongo',110000,'prepared','{}','pass_on',10000,true)`,
    [org, registration],
  );
});
afterAll(async () => {
  await db.query("delete from discount_redemptions where org_id=$1", [org]);
  await db.query("delete from discount_codes where org_id=$1", [org]);
  for (const table of [
    "booking_order_deliveries",
    "booking_payment_allocations",
    "booking_payment_captures",
    "booking_payment_dispatches",
    "booking_payment_attempts",
  ])
    await db.query(`delete from ${table} where org_id=$1`, [org]);
  await db.query("delete from registrations where org_id=$1", [org]);
  await db.query("delete from booking_orders where org_id=$1", [org]);
  await db.query("delete from categories where org_id=$1", [org]);
  await db.query("delete from events where org_id=$1", [org]);
  await db.query("delete from organizer_waiver_versions where org_id=$1", [
    org,
  ]);
  await db.query("delete from organizations where id=$1", [org]);
  await svc.auth.admin.deleteUser(actor);
  await db.end();
});
it("prices percentage savings and commission from the reduced subtotal", async () => {
  await code();
  expect(await apply()).toMatchObject({
    discount_cents: 20000,
    total_cents: 80000,
  });
  expect(
    (
      await db.query(
        "select amount,checkout_platform_fee from payments where registration_id=$1",
        [registration],
      )
    ).rows[0],
  ).toEqual({ amount: 88000, checkout_platform_fee: 8000 });
});
it("replays an application without reserving twice", async () => {
  await code({ max: 1 });
  await Promise.all([apply(), apply()]);
  expect(
    (
      await db.query(
        "select count(*)::integer n from discount_redemptions where org_id=$1 and state='reserved'",
        [org],
      )
    ).rows[0].n,
  ).toBe(1);
});
it("removes a code and restores the original quote", async () => {
  await code();
  await apply();
  expect(await apply("")).toMatchObject({
    discount_cents: 0,
    total_cents: 100000,
    code: null,
  });
});
it("special absorption changes only checkout fees", async () => {
  await code({ kind: "special", max: 1, absorb: true });
  await apply();
  expect(
    (
      await db.query(
        "select amount,checkout_fee_mode,checkout_provider_managed_fee from payments where registration_id=$1",
        [registration],
      )
    ).rows[0],
  ).toEqual({
    amount: 80000,
    checkout_fee_mode: "absorb",
    checkout_provider_managed_fee: false,
  });
  expect(
    (await db.query("select fee_mode from organizations where id=$1", [org]))
      .rows[0].fee_mode,
  ).toBe("pass_on");
});
it("caps flat savings and returns zero commission for a free entry", async () => {
  await code({ type: "flat", value: 200000 });
  expect(await apply()).toMatchObject({
    discount_cents: 100000,
    total_cents: 0,
  });
  expect(
    (
      await db.query(
        "select checkout_platform_fee,amount from payments where registration_id=$1",
        [registration],
      )
    ).rows[0],
  ).toEqual({ checkout_platform_fee: 0, amount: 0 });
});
it("confirms a fully free entry without a provider identity and consumes its code once", async () => {
  await code({ value: 10000 });
  await apply();
  const args = {
    p_actor: actor,
    p_registration: registration,
    p_order: null,
    p_tokens: { [registration]: "signed-ticket-token-at-least-twenty" },
  };
  const a = await svc.rpc("discount_confirm_free", args);
  expect(a.error).toBeNull();
  expect(a.data).toBe("paid");
  const b = await svc.rpc("discount_confirm_free", args);
  expect(b.data).toBe("already");
  expect(
    (
      await db.query(
        "select provider,provider_ref,amount,status from payments where registration_id=$1",
        [registration],
      )
    ).rows[0],
  ).toEqual({
    provider: "complimentary",
    provider_ref: null,
    amount: 0,
    status: "paid",
  });
  expect(
    (
      await db.query(
        "select state from discount_redemptions where registration_id=$1",
        [registration],
      )
    ).rows[0].state,
  ).toBe("redeemed");
});
it("refuses edits after provider dispatch begins", async () => {
  await code();
  await db.query(
    "update payments set discount_checkout_state='creating' where registration_id=$1",
    [registration],
  );
  await expect(apply()).rejects.toThrow("discount_payment_locked");
});
it("rejects expired codes and foreign scopes", async () => {
  const id = await code();
  await db.query(
    "update discount_codes set ends_at=now()-interval '1 second' where id=$1",
    [id],
  );
  await expect(apply()).rejects.toThrow("discount_inactive");
});
it("rejects tiny positive balances without changing the quote", async () => {
  await code({ type: "flat", value: 99999 });
  await expect(apply()).rejects.toThrow("discount_balance_too_small");
  expect(
    (
      await db.query("select total_amount from registrations where id=$1", [
        registration,
      ])
    ).rows[0].total_amount,
  ).toBe(100000);
});
it("rejects a code assigned to a different Passport", async () => {
  const id = await code({ kind: "special", max: 1 });
  const other = randomUUID();
  await db.query(
    "insert into runner_passports(id,created_by_user_id) values($1,$2)",
    [other, actor],
  );
  await db.query(
    "update discount_codes set assigned_passport_id=$1 where id=$2",
    [other, id],
  );
  await expect(apply()).rejects.toThrow("discount_wrong_passport");
});
it("denies a forged actor and keeps inventory private", async () => {
  await code();
  const result = await svc.rpc("discount_apply", {
    p_actor: randomUUID(),
    p_registration: registration,
    p_code: "SAVE20",
  });
  expect(result.error?.message).toBe("registration_not_found");
  const anon = createClient(env.url, env.anonKey);
  expect((await anon.from("discount_codes").select("*")).error).not.toBeNull();
});

async function secondRegistration(order?: string) {
  const id = randomUUID(),
    guest = randomUUID();
  await db.query(
    "insert into runner_passports(id,created_by_user_id) values($1,$2)",
    [guest, actor],
  );
  await db.query(
    "insert into passport_managers(passport_id,user_id) values($1,$2)",
    [guest, actor],
  );
  await db.query(
    `insert into registrations(id,org_id,event_id,category_id,user_id,booked_by_user_id,participant_passport_id,total_amount,waiver_version_id,waiver_accepted_at,expires_at,booking_order_id,waiver_acceptance_method)
 values($1,$2,$3,$4,null,$5,$6,100000,$7,now(),now()+interval '1 hour',$8,'participant_on_helper_device')`,
    [id, org, event, category, actor, guest, waiver, order ?? null],
  );
  if (!order)
    await db.query(
      "insert into payments(org_id,registration_id,provider,amount,discount_checkout_state,checkout_request) values($1,$2,'paymongo',110000,'prepared','{}')",
      [org, id],
    );
  return id;
}
async function group() {
  const order = randomUUID();
  await db.query("delete from payments where registration_id=$1", [
    registration,
  ]);
  await db.query(
    `insert into booking_orders(id,org_id,event_id,category_id,booked_by_user_id,idempotency_key,entry_total_cents,status,reservation_request,expires_at)
 values($1,$2,$3,$4,$5,$6,200000,'pending','{"participants":[{},{}]}',now()+interval '1 hour')`,
    [order, org, event, category, actor, randomUUID()],
  );
  await db.query("delete from registrations where id=$1", [registration]);
  await db.query(
    `insert into registrations(id,org_id,event_id,category_id,user_id,booked_by_user_id,participant_passport_id,total_amount,waiver_version_id,waiver_accepted_at,expires_at,booking_order_id)
 values($1,$2,$3,$4,$5,$5,$6,100000,$7,now(),now()+interval '1 hour',$8)`,
    [registration, org, event, category, actor, passport, waiver, order],
  );
  const second = await secondRegistration(order);
  return { order, second };
}
const prepare = (order: string) =>
  svc.rpc("booking_order_prepare_payment", {
    p_actor: actor,
    p_order: order,
    p_key: randomUUID(),
    p_method: "card",
  });
it("serializes two Passports competing for the last use", async () => {
  const second = await secondRegistration();
  await code({ max: 1 });
  const results = await Promise.allSettled([apply(), apply("SAVE20", second)]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  expect(
    (
      await db.query(
        "select count(*)::int n from discount_redemptions where org_id=$1 and state='reserved'",
        [org],
      )
    ).rows[0].n,
  ).toBe(1);
});
it("expires only undispatched attempts and releases their reserved uses", async () => {
  await code();
  await apply();
  await db.query(
    "update registrations set expires_at=now()-interval '1 second' where id=$1",
    [registration],
  );
  const expired = await svc.rpc("discount_expire_prepared", {
    p_registration: registration,
  });
  expect(expired.error).toBeNull();
  expect(expired.data).toBe("expired");
  expect(
    (
      await db.query(
        "select state from discount_redemptions where registration_id=$1",
        [registration],
      )
    ).rows[0].state,
  ).toBe("released");
});
it("never releases a use after uncertain checkout dispatch", async () => {
  await code();
  await apply();
  await db.query(
    "update payments set discount_checkout_state='creating' where registration_id=$1",
    [registration],
  );
  await db.query(
    "update registrations set expires_at=now()-interval '1 second' where id=$1",
    [registration],
  );
  expect(
    (
      await svc.rpc("discount_expire_prepared", {
        p_registration: registration,
      })
    ).data,
  ).toBe("provider_unresolved");
  expect(
    (
      await db.query(
        "select state from discount_redemptions where registration_id=$1",
        [registration],
      )
    ).rows[0].state,
  ).toBe("reserved");
});
it("requires matching provider expiry evidence to restart and preserves the old checkout", async () => {
  await db.query(
    "update payments set discount_checkout_state='ready',provider_ref='cs_discount_test',checkout_url='https://checkout.paymongo.com/old' where registration_id=$1",
    [registration],
  );
  const args = {
    p_actor: actor,
    p_registration: registration,
    p_session: "cs_discount_test",
    p_evidence: { source: "paymongo_get", status: "active" },
  };
  expect((await svc.rpc("discount_restart_single", args)).error?.message).toBe(
    "discount_payment_locked",
  );
  expect(
    (
      await svc.rpc("discount_restart_single", {
        ...args,
        p_evidence: { source: "paymongo_get", status: "expired" },
      })
    ).data,
  ).toBe("prepared");
  expect(
    (
      await db.query(
        "select old_provider_ref from discount_checkout_restarts where registration_id=$1",
        [registration],
      )
    ).rows[0].old_provider_ref,
  ).toBe("cs_discount_test");
  await code();
  expect((await apply()).total_cents).toBe(80000);
});
it("prepares reduced group totals without changing the original order total", async () => {
  const { order, second } = await group();
  await code();
  await apply();
  await apply("SAVE20", second);
  const quote = await prepare(order);
  expect(quote.error).toBeNull();
  expect(quote.data).toMatchObject({
    base_cents: 160000,
    platform_fee_cents: 16000,
    gross_cents: 176000,
  });
  expect(
    (
      await db.query(
        "select entry_total_cents from booking_orders where id=$1",
        [order],
      )
    ).rows[0].entry_total_cents,
  ).toBe(200000);
});
it("rejects a paid group with mixed fee modes but allows its free participant", async () => {
  const { order } = await group();
  await code({ kind: "special", max: 1, absorb: true });
  await apply();
  expect((await prepare(order)).error?.message).toBe(
    "discount_mixed_fee_modes",
  );
  await code({ code: "FREE100", value: 10000 });
  await apply("FREE100");
  const quote = await prepare(order);
  expect(quote.error).toBeNull();
  expect(quote.data).toMatchObject({
    base_cents: 100000,
    platform_fee_cents: 10000,
  });
});
it("fulfills an entirely free group once with zero allocations and no provider dispatch", async () => {
  const { order, second } = await group();
  await code({ value: 10000 });
  await apply();
  await apply("SAVE20", second);
  const quote = await prepare(order);
  expect(quote.error).toBeNull();
  expect(quote.data.gross_cents).toBe(0);
  const args = {
    p_actor: actor,
    p_order: order,
    p_registration: null,
    p_tokens: {
      [registration]: "first-signed-token-at-least-twenty",
      [second]: "second-signed-token-at-least-twenty",
    },
  };
  const paid = await svc.rpc("discount_confirm_free", args);
  expect(paid.error).toBeNull();
  expect(paid.data).toBe("paid");
  expect((await svc.rpc("discount_confirm_free", args)).data).toBe("already");
  expect(
    (
      await db.query(
        "select gross_cents,platform_fee_cents,processor_fee_cents,net_to_org_cents from booking_payment_allocations where org_id=$1",
        [org],
      )
    ).rows,
  ).toEqual(
    Array(2).fill({
      gross_cents: 0,
      platform_fee_cents: 0,
      processor_fee_cents: 0,
      net_to_org_cents: 0,
    }),
  );
  expect(
    (
      await db.query(
        "select payment_id,settlement_kind from booking_payment_captures where org_id=$1",
        [org],
      )
    ).rows,
  ).toEqual([{ payment_id: null, settlement_kind: "complimentary" }]);
});
it("cancels a complimentary ticket without restoring its redeemed code", async () => {
  await code({ value: 10000 });
  await apply();
  expect(
    (
      await svc.rpc("discount_confirm_free", {
        p_actor: actor,
        p_registration: registration,
        p_order: null,
        p_tokens: { [registration]: "signed-ticket-at-least-twenty" },
      })
    ).error,
  ).toBeNull();
  await db.query(
    "insert into user_roles(user_id,org_id,role) values($1,$2,'admin') on conflict do nothing",
    [actor, org],
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    actor,
  ]);
  expect(
    (
      await db.query("select admin_cancel_registration($1) result", [
        registration,
      ])
    ).rows[0].result,
  ).toBe("cancelled");
  expect(
    (
      await db.query(
        "select state from discount_redemptions where registration_id=$1",
        [registration],
      )
    ).rows[0].state,
  ).toBe("redeemed");
});
it("allows admins to generate an assigned batch and denies editors and other tenants", async () => {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    actor,
  ]);
  await db.query("delete from user_roles where user_id=$1 and org_id=$2", [
    actor,
    org,
  ]);
  await db.query(
    "insert into user_roles(user_id,org_id,role) values($1,$2,'editor')",
    [actor, org],
  );
  const input = {
    kind: "special",
    discount_type: "percent",
    value: 10000,
    coverage: "entry",
    quantity: 1,
    passport_ids: [passport],
  };
  await expect(
    db.query("select * from discount_create($1,$2)", [org, input]),
  ).rejects.toThrow("forbidden");
  await db.query(
    "update user_roles set role='admin' where user_id=$1 and org_id=$2",
    [actor, org],
  );
  const created = await db.query("select * from discount_create($1,$2)", [
    org,
    input,
  ]);
  expect(created.rows).toHaveLength(1);
  expect(created.rows[0]).toMatchObject({
    coverage: "subtotal",
    max_uses: 1,
    assigned_passport_id: passport,
  });
  await expect(
    db.query("select * from discount_create($1,$2)", [randomUUID(), input]),
  ).rejects.toThrow("forbidden");
  await db.query("set role authenticated");
  try {
    expect(
      (await db.query("select id from discount_codes where org_id=$1", [org]))
        .rowCount,
    ).toBe(1);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      randomUUID(),
    ]);
    expect(
      (await db.query("select id from discount_codes where org_id=$1", [org]))
        .rowCount,
    ).toBe(0);
    await expect(
      db.query("select discount_apply($1,$2,$3)", [
        actor,
        registration,
        created.rows[0].code,
      ]),
    ).rejects.toThrow("permission denied");
  } finally {
    await db.query("reset role");
  }
});
it("applies entry-only discounts to frozen entry price and leaves add-ons payable", async () => {
  const addon = randomUUID();
  await db.query(
    "insert into addons(id,org_id,event_id,name,price) values($1,$2,$3,'Optional kit',20000)",
    [addon, org, event],
  );
  await db.query(
    "insert into registration_addons(registration_id,addon_id,price) values($1,$2,20000)",
    [registration, addon],
  );
  await code({ coverage: "entry", value: 5000 });
  expect(await apply()).toMatchObject({
    discount_cents: 40000,
    total_cents: 60000,
  });
});
it("rejects foreign category scopes and future dates without reserving a use", async () => {
  const id = await code();
  await db.query(
    "update discount_codes set scope='categories',category_ids=array[$1::uuid] where id=$2",
    [randomUUID(), id],
  );
  await expect(apply()).rejects.toThrow("discount_ineligible");
  await db.query(
    "update discount_codes set scope='organization',category_ids='{}',starts_at=now()+interval '1 day' where id=$1",
    [id],
  );
  await expect(apply()).rejects.toThrow("discount_inactive");
  expect(
    (
      await db.query(
        "select count(*)::int n from discount_redemptions where org_id=$1",
        [org],
      )
    ).rows[0].n,
  ).toBe(0);
});
