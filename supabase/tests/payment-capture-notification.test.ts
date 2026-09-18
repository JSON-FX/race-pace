import { afterAll, beforeAll, expect, it } from "vitest";
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { loadEnv } from "../../test/env";

const db = new Client({ connectionString: loadEnv().dbUrl });
beforeAll(() => db.connect());
afterAll(() => db.end());

it("alerts platform staff once when a captured charge needs review", async () => {
  const user = randomUUID(), org = randomUUID(), event = randomUUID();
  const category = randomUUID(), registration = randomUUID();
  const session = `cs_${randomUUID().replaceAll("-", "")}`;
  const paymentId = `pay_${randomUUID().replaceAll("-", "")}`;
  await db.query("begin");
  const warnings: string[] = [];
  const onNotice = (notice: { message: string }) => { warnings.push(notice.message); };
  db.on("notice", onNotice);
  try {
    await db.query(
      "insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) " +
        "values($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$2,'x',now(),now(),now())",
      [user, `capture-alert-${user}@example.com`],
    );
    await db.query("insert into public.user_roles(user_id,role) values($1,'super_admin')", [user]);
    await db.query("insert into public.organizations(id,name,slug) values($1,'Capture alert QA',$2)", [org, `capture-alert-${org}`]);
    await db.query("insert into public.events(id,org_id,name,status) values($1,$2,'Capture alert QA','open')", [event, org]);
    await db.query("insert into public.categories(id,org_id,event_id,code,label,base_price,slots_total) values($1,$2,$3,'QA','QA',10000,10)", [category, org, event]);
    await db.query("insert into public.registrations(id,org_id,event_id,category_id,user_id,status,total_amount) values($1,$2,$3,$4,$5,'pending',10000)", [registration, org, event, category, user]);
    await db.query("insert into public.payments(org_id,registration_id,provider,provider_ref,amount,status,checkout_fee_mode,checkout_request) values($1,$2,'paymongo',$3,10000,'pending','absorb','{}'::jsonb)", [org, registration, session]);
    await db.query("set local role service_role");
    const observe = (amount: number) => db.query<{ state: string }>(
      "select public.single_capture_observe($1,$2,$3,$4,250,$5,false,null,'{}'::jsonb) as state",
      [registration, paymentId, session, amount, amount - 250],
    );
    expect((await observe(10000)).rows[0]!.state).toBe("observed");
    expect((await observe(10100)).rows[0]!.state).toBe("reconciliation_required");
    expect((await observe(10100)).rows[0]!.state).toBe("reconciliation_required");

    const notices = await db.query<{ type: string; reason: string; count: number }>(
      "select type::text,data->>'reason' as reason,count(*)::integer as count " +
        "from public.notifications where user_id=$1 and dedup_key like 'payment-review:%' group by type,data->>'reason'",
      [user],
    );
    expect({ rows: notices.rows, warnings }).toEqual({ rows: [{ type: "payment_review", reason: "payment_identity_conflict", count: 1 }], warnings: [] });
  } finally { db.off("notice", onNotice); await db.query("rollback"); }
});
