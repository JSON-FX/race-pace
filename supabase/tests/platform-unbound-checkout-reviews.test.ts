import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { loadEnv } from "../../test/env";

const db = new Client({ connectionString: loadEnv().dbUrl });
beforeAll(() => db.connect());
afterAll(() => db.end());

async function asActor<T>(role: "authenticated" | "anon", userId: string | null, query: () => Promise<T>) {
  await db.query("savepoint actor");
  try {
    await db.query(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId ?? ""]);
    return await query();
  } finally {
    await db.query("rollback to savepoint actor");
    await db.query("release savepoint actor");
  }
}

it("shows only active unbound single checkouts to platform staff without changing their holds", async () => {
  const platform = randomUUID(), organizer = randomUUID();
  const runners = Array.from({ length: 6 }, () => randomUUID());
  const org = randomUUID(), event = randomUUID(), category = randomUUID();
  const untried = randomUUID(), attempted = randomUUID(), bound = randomUUID();
  const providerPaymentId = `pay_${randomUUID().replaceAll("-", "")}`;
  const checkoutReady = randomUUID(), failed = randomUUID(), expired = randomUUID();
  await db.query("begin");
  try {
    for (const [id, label] of [[platform, "platform"], [organizer, "organizer"], ...runners.map((id) => [id, "runner"])]) {
      await db.query(
        "insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) " +
          "values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'x',now(),now(),now())",
        [id, `unbound-${label}-${id}@example.com`],
      );
    }
    await db.query("insert into public.organizations(id,name,slug) values($1,'Unbound Org',$2)", [org, `unbound-${org}`]);
    await db.query("insert into public.events(id,org_id,name,status) values($1,$2,'Unbound Race','closed')", [event, org]);
    await db.query("insert into public.categories(id,org_id,event_id,code,label,base_price,slots_total) values($1,$2,$3,'QA','QA',10000,10)", [category, org, event]);
    await db.query("insert into public.user_roles(user_id,role) values($1,'super_admin')", [platform]);
    await db.query("insert into public.user_roles(user_id,org_id,role) values($1,$2,'admin')", [organizer, org]);

    for (const [index, [id, providerRef, checkoutUrl, paymentStatus, registrationStatus]] of ([
      [untried, null, null, "pending", "pending"],
      [attempted, null, null, "pending", "pending"],
      [bound, "cs_bound", null, "pending", "pending"],
      [checkoutReady, null, "https://checkout.example/ready", "pending", "pending"],
      [failed, null, null, "failed", "pending"],
      [expired, null, null, "pending", "expired"],
    ] as const).entries()) {
      await db.query(
        "insert into public.registrations(id,org_id,event_id,category_id,user_id,status,total_amount,expires_at) " +
          "values($1,$2,$3,$4,$5,$6,12345,now()-interval '1 hour')",
        [id, org, event, category, runners[index], registrationStatus],
      );
      await db.query(
        "insert into public.payments(org_id,registration_id,provider,provider_ref,checkout_url,amount,status,checkout_request) " +
          "values($1,$2,'paymongo',$3,$4,12345,$5,$6::jsonb)",
        [org, id, providerRef, checkoutUrl, paymentStatus, JSON.stringify({ secret: "never expose" })],
      );
    }
    await db.query(
      "insert into public.provider_session_expiry_attempts(registration_id,outcome,attempts,detail) " +
        "values($1,'no_session_id',2,$2::jsonb)",
      [attempted, JSON.stringify({ secret: "never expose" })],
    );
    await db.query(
      "insert into public.single_payment_captures(provider_payment_id,registration_id,org_id,event_id,provider_resource,state) " +
        "values($1,$2,$3,$4,$5::jsonb,'reconciliation_required')",
      [providerPaymentId, attempted, org, event, JSON.stringify({ secret: "never expose" })],
    );

    const grants = await db.query(
      "select has_function_privilege('authenticated','public.platform_unbound_checkout_reviews()','execute') as authenticated, " +
        "has_function_privilege('anon','public.platform_unbound_checkout_reviews()','execute') as anon",
    );
    expect(grants.rows[0]).toEqual({ authenticated: true, anon: false });

    const captureGrants = await db.query(
      "select has_function_privilege('authenticated','public.platform_single_capture_reviews()','execute') as authenticated, " +
        "has_function_privilege('anon','public.platform_single_capture_reviews()','execute') as anon",
    );
    expect(captureGrants.rows[0]).toEqual({ authenticated: true, anon: false });

    const captureReviews = await asActor("authenticated", platform, () =>
      db.query("select * from public.platform_single_capture_reviews() where provider_payment_id=$1", [providerPaymentId]),
    );
    expect(captureReviews.rows).toHaveLength(1);
    expect(captureReviews.rows[0]).toMatchObject({
      provider_payment_id: providerPaymentId,
      registration_id: attempted,
      event_name: "Unbound Race",
      org_name: "Unbound Org",
      amount_cents: null,
      registration_status: "pending",
      payment_status: "pending",
    });
    expect(JSON.stringify(captureReviews.rows)).not.toContain("never expose");

    for (const id of [organizer, runners[0]]) {
      await expect(asActor("authenticated", id, () =>
        db.query("select * from public.platform_single_capture_reviews()"),
      )).rejects.toMatchObject({ code: "42501" });
    }
    await expect(asActor("anon", null, () =>
      db.query("select * from public.platform_single_capture_reviews()"),
    )).rejects.toMatchObject({ code: "42501" });

    const rows = await asActor("authenticated", platform, () =>
      db.query("select * from public.platform_unbound_checkout_reviews()"),
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.map((row) => row.registration_id).sort()).toEqual([untried, attempted].sort());
    expect(rows.rows.find((row) => row.registration_id === untried)).toMatchObject({
      event_id: event, event_name: "Unbound Race", org_id: org, org_name: "Unbound Org",
      amount_cents: 12345, latest_outcome: null, attempts: 0, last_attempt_at: null,
      capture_count: 0,
    });
    expect(rows.rows.find((row) => row.registration_id === attempted)).toMatchObject({
      latest_outcome: "no_session_id", attempts: 2, capture_count: 1,
    });
    expect(rows.rows.every((row) => row.expires_at instanceof Date)).toBe(true);
    expect(Object.keys(rows.rows[0]).sort()).toEqual([
      "registration_id", "event_id", "event_name", "org_id", "org_name", "amount_cents",
      "expires_at", "latest_outcome", "attempts", "last_attempt_at", "capture_count",
    ].sort());

    for (const id of [organizer, runners[0]]) {
      await expect(asActor("authenticated", id, () =>
        db.query("select * from public.platform_unbound_checkout_reviews()"),
      )).rejects.toMatchObject({ code: "42501" });
    }
    await expect(asActor("anon", null, () =>
      db.query("select * from public.platform_unbound_checkout_reviews()"),
    )).rejects.toMatchObject({ code: "42501" });

    const hold = await db.query(
      "select r.status as registration_status,r.expires_at,p.status as payment_status,p.provider_ref,p.checkout_url " +
        "from public.registrations r join public.payments p on p.registration_id=r.id where r.id=$1",
      [attempted],
    );
    expect(hold.rows[0]).toMatchObject({
      registration_status: "pending", payment_status: "pending", provider_ref: null, checkout_url: null,
    });
    expect(hold.rows[0].expires_at).toBeInstanceOf(Date);
    const attempts = await db.query("select attempts,outcome from public.provider_session_expiry_attempts where registration_id=$1", [attempted]);
    expect(attempts.rows[0]).toEqual({ attempts: 2, outcome: "no_session_id" });
  } finally {
    await db.query("rollback");
    const leftovers = await db.query("select count(*)::integer as count from public.registrations where id = any($1::uuid[])", [
      [untried, attempted, bound, checkoutReady, failed, expired],
    ]);
    expect(leftovers.rows[0]).toEqual({ count: 0 });
  }
});
