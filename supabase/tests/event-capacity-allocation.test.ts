import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, it } from "vitest";

const dbUrl = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54522/postgres";

it("derives event capacity from categories while preserving legacy categoryless opening protection", async () => {
  const db = new Client({ connectionString: dbUrl });
  await db.connect();
  await db.query("begin");
  try {
    const org = randomUUID();
    const event = randomUUID();
    const slug = `capacity-${randomUUID().slice(0, 8)}`;
    await db.query("insert into public.organizations(id,name,slug) values($1,'Capacity QA',$2)", [org, slug]);
    await db.query(`insert into public.events(id,org_id,name,slug,status,discipline,hero_image_url,
      description,coming_soon_reserve_enabled,reservation_fee_cents,reservation_deadline_at,total_event_slots)
      values($1,$2,'Capacity QA',$3,'coming_soon','trail','https://example.test/hero.jpg',
      'Capacity QA',true,500,now()+interval '10 days',3)`, [event, org, slug]);

    await db.query("savepoint incomplete");
    await expect(db.query("update public.events set status='open' where id=$1", [event]))
      .rejects.toMatchObject({ message: "event_categories_below_total_capacity" });
    await db.query("rollback to savepoint incomplete");

    const first = (await db.query<{ id: string }>(
      "insert into public.categories(org_id,event_id,code,label,base_price,slots_total) values($1,$2,'A','A',1000,2) returning id",
      [org, event],
    )).rows[0]!.id;
    await db.query(
      "insert into public.categories(org_id,event_id,code,label,base_price,slots_total) values($1,$2,'B','B',1000,2)",
      [org, event],
    );
    expect((await db.query("select total_event_slots from events where id=$1", [event])).rows[0].total_event_slots).toBe(4);
    // Legacy browser writes cannot override the category-owned projection.
    await db.query("update events set total_event_slots=1 where id=$1", [event]);
    expect((await db.query("select total_event_slots from events where id=$1", [event])).rows[0].total_event_slots).toBe(4);
    await db.query("update events set total_event_slots=null where id=$1", [event]);
    expect((await db.query("select total_event_slots from events where id=$1", [event])).rows[0].total_event_slots).toBe(4);
    await db.query("update categories set slots_total=3 where id=$1", [first]);

    await db.query("select set_config('request.jwt.claim.role','service_role',true)");
    await db.query("update public.events set status='open' where id=$1", [event]);
    expect((await db.query<{ status: string; total_event_slots: number }>(
      "select status,total_event_slots from public.events where id=$1", [event],
    )).rows[0]).toMatchObject({ status: "open", total_event_slots: 5 });
  } finally {
    await db.query("rollback");
    await db.end();
  }
});
