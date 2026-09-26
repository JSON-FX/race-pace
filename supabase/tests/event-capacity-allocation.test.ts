import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, it } from "vitest";

const dbUrl = process.env.DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54522/postgres";

it("keeps category allocations within event capacity and requires a complete split before opening", async () => {
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
    await db.query("savepoint overflow");
    await expect(db.query(
      "insert into public.categories(org_id,event_id,code,label,base_price,slots_total) values($1,$2,'B','B',1000,2)",
      [org, event],
    )).rejects.toMatchObject({ message: "event_categories_exceed_total_capacity" });
    await db.query("rollback to savepoint overflow");

    await db.query("savepoint total_reduction");
    await expect(db.query("update public.events set total_event_slots=1 where id=$1", [event]))
      .rejects.toMatchObject({ message: "event_categories_exceed_total_capacity" });
    await db.query("rollback to savepoint total_reduction");

    await db.query("savepoint null_capacity");
    await expect(db.query("update public.events set total_event_slots=null where id=$1", [event]))
      .rejects.toMatchObject({ message: "published_event_capacity_required" });
    await db.query("rollback to savepoint null_capacity");

    await db.query(
      "insert into public.categories(org_id,event_id,code,label,base_price,slots_total) values($1,$2,'B','B',1000,1)",
      [org, event],
    );
    await db.query("savepoint category_growth");
    await expect(db.query("update public.categories set slots_total=3 where id=$1", [first]))
      .rejects.toMatchObject({ message: "event_categories_exceed_total_capacity" });
    await db.query("rollback to savepoint category_growth");

    await db.query("select set_config('request.jwt.claim.role','service_role',true)");
    await db.query("update public.events set status='open' where id=$1", [event]);
    expect((await db.query<{ status: string; total_event_slots: number }>(
      "select status,total_event_slots from public.events where id=$1", [event],
    )).rows[0]).toMatchObject({ status: "open", total_event_slots: 3 });
  } finally {
    await db.query("rollback");
    await db.end();
  }
});
