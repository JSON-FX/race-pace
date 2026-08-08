import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey, dbUrl } = loadEnv();
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
const service = () => createClient(url, serviceKey, { auth: { persistSession: false } });

/** Seed ids drifted out of seed.sql once already (see the Global Constraints
 *  note). Every fixture here is created by the test that needs it. */
async function makeUser(email: string) {
  const svc = service();
  const created = await svc.auth.admin.createUser({ email, password: "password123", email_confirm: true });
  const signedIn = await anon().auth.signInWithPassword({ email, password: "password123" });
  return { id: created.data.user!.id, token: signedIn.data.session!.access_token };
}

async function makeEvent(slug: string) {
  const svc = service();
  const org = await svc.from("organizations").insert({ name: `Gate ${slug}`, slug: `gate-${slug}` }).select().single();
  const ev = await svc.from("events")
    .insert({ org_id: org.data!.id, name: `Gate Race ${slug}`, status: "open" }).select().single();
  const cat = await svc.from("categories")
    .insert({ org_id: org.data!.id, event_id: ev.data!.id, code: "10k", label: "10K", base_price: 100000, slots_total: 10 })
    .select().single();
  return { orgId: org.data!.id, eventId: ev.data!.id, categoryId: cat.data!.id };
}

function regRow(f: { orgId: string; eventId: string; categoryId: string }, userId: string) {
  return { org_id: f.orgId, event_id: f.eventId, category_id: f.categoryId, user_id: userId, total_amount: 100000 };
}

describe("one live registration per event", () => {
  it("rejects a second live registration for the same event", async () => {
    const svc = service();
    const f = await makeEvent(`dup${Date.now()}`);
    const runner = await makeUser(`gate_dup_${Date.now()}@test.dev`);

    const first = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    expect(first.error).toBeNull();

    const second = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    expect(second.error).not.toBeNull();
    expect(second.error!.code).toBe("23505");
  });

  it("allows a new registration once the previous one is cancelled, refunded or expired", async () => {
    const svc = service();
    for (const exitStatus of ["cancelled", "refunded", "expired"] as const) {
      const f = await makeEvent(`re${exitStatus}${Date.now()}`);
      const runner = await makeUser(`gate_re_${exitStatus}_${Date.now()}@test.dev`);

      const first = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
      expect(first.error).toBeNull();
      await svc.from("registrations").update({ status: exitStatus }).eq("id", first.data!.id);

      const again = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
      expect(again.error, `re-entry after ${exitStatus} must be allowed`).toBeNull();
    }
  });

  it("scopes the gate to one event — the same runner may enter a different event", async () => {
    const svc = service();
    const a = await makeEvent(`ea${Date.now()}`);
    const b = await makeEvent(`eb${Date.now()}`);
    const runner = await makeUser(`gate_two_${Date.now()}@test.dev`);

    expect((await svc.from("registrations").insert(regRow(a, runner.id)).select().single()).error).toBeNull();
    expect((await svc.from("registrations").insert(regRow(b, runner.id)).select().single()).error).toBeNull();
  });

  it("stamps a 24-hour expiry on a new pending registration", async () => {
    const svc = service();
    const f = await makeEvent(`exp${Date.now()}`);
    const runner = await makeUser(`gate_exp_${Date.now()}@test.dev`);

    const reg = await svc.from("registrations").insert(regRow(f, runner.id)).select("created_at,expires_at").single();
    expect(reg.error).toBeNull();
    const hours = (Date.parse(reg.data!.expires_at!) - Date.parse(reg.data!.created_at)) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThan(24.1);
  });
});

/**
 * The migration's one-time cleanup (20260809100100_one_registration_per_event.sql)
 * ran once, irreversibly, against hosted data that genuinely had duplicates. That
 * SQL is not re-runnable as written, so it was extracted into
 * public.dedupe_live_registrations() (20260809100050_dedupe_live_registrations_fn.sql)
 * -- same CTE, callable and testable on demand, and reusable by Task 10 to confirm
 * the hosted push left zero stragglers.
 *
 * This block only covers the no-duplicate-data path (idempotence, no false-positive
 * expiry, no false slots_taken adjustment) via the normal supabase-js/PostgREST client,
 * because staging two live 'pending'/'paid' rows for the same (event_id, user_id)
 * through that client is impossible by design -- the partial unique index this
 * migration creates forbids it, full stop. The duplicate-RESOLUTION path itself
 * (ranked/losers/released, and specifically the paid-wins-then-earliest ordering) is
 * covered directly, against real conflicting rows, by the
 * "dedupe winner-selection order" describe block further down -- that one opens a
 * direct Postgres connection and drops the index inside a transaction it always rolls
 * back, which is the only way to construct that state at all. See that block's header
 * for the full reasoning and fix-round history.
 */
describe("dedupe of pre-existing duplicates", () => {
  it("is idempotent and leaves a genuine single registration untouched", async () => {
    const svc = service();
    const f = await makeEvent(`dedupe${Date.now()}`);
    const runner = await makeUser(`gate_dedupe_${Date.now()}@test.dev`);

    await svc.from("categories").update({ slots_taken: 5 }).eq("id", f.categoryId);

    const reg = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    expect(reg.error).toBeNull();
    // confirm_payment_tx (a later task) is what clears expires_at on a real payment;
    // set both explicitly here to simulate a genuine paid registration's end state
    // without depending on that wiring.
    const paid = await svc.from("registrations").update({ status: "paid", expires_at: null }).eq("id", reg.data!.id);
    expect(paid.error).toBeNull();

    const first = await svc.rpc("dedupe_live_registrations");
    expect(first.error).toBeNull();
    expect(first.data).toBe(0);

    const afterFirst = await svc.from("registrations").select("status,expires_at").eq("id", reg.data!.id).single();
    expect(afterFirst.data!.status).toBe("paid");
    expect(afterFirst.data!.expires_at).toBeNull();

    const catAfterFirst = await svc.from("categories").select("slots_taken").eq("id", f.categoryId).single();
    expect(catAfterFirst.data!.slots_taken).toBe(5);

    const second = await svc.rpc("dedupe_live_registrations");
    expect(second.error).toBeNull();
    expect(second.data).toBe(0);

    const catAfterSecond = await svc.from("categories").select("slots_taken").eq("id", f.categoryId).single();
    expect(catAfterSecond.data!.slots_taken).toBe(5);
  });
});

/**
 * Fix round 1: CRITICAL finding on dedupe_live_registrations()'s winner selection.
 * `row_number() over (partition by event_id, user_id order by created_at, id)` ranked
 * candidates purely by recency, ignoring status. The realistic way a duplicate forms is
 * a first checkout going 'pending' and being abandoned, then a later attempt actually
 * completing payment -- in that order, the OLD abandoned pending row ranked first and
 * survived, while the row the runner actually PAID for was expired and its slot
 * released. Ruled fix (20260809100150_dedupe_paid_wins_tiebreak.sql): PAID ALWAYS WINS,
 * THEN EARLIEST -- `order by (status = 'paid') desc, created_at, id`.
 *
 * Fix round 2: this used to be covered by two test-only probe functions shipped in a
 * permanent migration (20260809100160). Review correctly rejected that: shipping
 * test-only functions into the production schema forever is schema pollution, and one
 * of the two probes (`_dedupe_source_contains`) asserted on the function's SOURCE TEXT
 * rather than its behaviour -- a tripwire that passes on a semantically-broken rewrite
 * and fails on harmless reformatting, not a real test. That migration has been deleted
 * entirely (confirmed via a fresh `supabase db reset` that neither probe function
 * exists anymore).
 *
 * The real fix: `pg` is now a devDependency (root package.json, `pnpm add -D -w`), so
 * this suite can open a direct connection to the same local Postgres instance
 * (`DB_URL`, already in `.env.local`) and exercise `dedupe_live_registrations()` for
 * real, against real conflicting rows, inside a transaction that always ROLLBACKs.
 * `registrations_one_live_per_event` is a plain (non-deferrable) unique index, so even
 * within one transaction there is no way to have two live rows for the same
 * (event_id, user_id) coexist while it exists -- confirmed in fix round 1 by trying to
 * flip two 'cancelled' rows to 'paid' and hitting 23505 immediately, and that finding
 * still holds. So each test here DROPs the index first. Because DDL is transactional in
 * Postgres, DROP INDEX only ever takes effect for the lifetime of that one transaction;
 * ROLLBACK restores it (and undoes every row this test wrote) with no trace left in the
 * database, hosted or local. Nothing here weakens the index outside the test's own,
 * always-rolled-back transaction.
 */
async function withRolledBackTx<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    await client.query("begin");
    // Transactional DDL: only visible inside this transaction, gone the instant it
    // ends (commit OR rollback) -- see this describe block's header comment.
    await client.query("drop index registrations_one_live_per_event");
    return await fn(client);
  } finally {
    await client.query("rollback");
    await client.end();
  }
}

async function stageFixture(client: Client) {
  const user = await client.query<{ id: string }>("insert into auth.users (id) values (gen_random_uuid()) returning id");
  const org = await client.query<{ id: string }>(
    "insert into organizations (name, slug) values ($1, $2) returning id",
    [`Gate TX ${Date.now()}`, `gate-tx-${Date.now()}-${Math.random().toString(36).slice(2)}`],
  );
  const event = await client.query<{ id: string }>(
    "insert into events (org_id, name, status) values ($1, $2, 'open') returning id",
    [org.rows[0].id, "Gate TX Race"],
  );
  const category = await client.query<{ id: string }>(
    "insert into categories (org_id, event_id, code, label, base_price, slots_total, slots_taken) " +
      "values ($1, $2, '10k', '10K', 100000, 10, 5) returning id",
    [org.rows[0].id, event.rows[0].id],
  );
  return { userId: user.rows[0].id, eventId: event.rows[0].id, orgId: org.rows[0].id, categoryId: category.rows[0].id };
}

async function insertRegistration(
  client: Client,
  f: { orgId: string; eventId: string; categoryId: string; userId: string },
  status: "pending" | "paid",
  createdAt: string,
) {
  const res = await client.query<{ id: string }>(
    "insert into registrations (org_id, event_id, category_id, user_id, total_amount, status, created_at) " +
      "values ($1, $2, $3, $4, 100000, $5, $6) returning id",
    [f.orgId, f.eventId, f.categoryId, f.userId, status, createdAt],
  );
  return res.rows[0].id;
}

describe("dedupe winner-selection order (paid always wins, then earliest)", () => {
  it("a genuinely paid row survives over an earlier abandoned pending row, and slots_taken is untouched", async () => {
    await withRolledBackTx(async (client) => {
      const f = await stageFixture(client);
      const earlier = new Date(Date.now() - 2 * 3_600_000).toISOString();
      const later = new Date(Date.now() - 3_600_000).toISOString();

      const pendingId = await insertRegistration(client, f, "pending", earlier);
      const paidId = await insertRegistration(client, f, "paid", later);

      await client.query("select dedupe_live_registrations()");

      const rows = await client.query<{ id: string; status: string; expires_at: string | null }>(
        "select id, status, expires_at from registrations where id in ($1, $2)",
        [pendingId, paidId],
      );
      const pendingAfter = rows.rows.find((r) => r.id === pendingId)!;
      const paidAfter = rows.rows.find((r) => r.id === paidId)!;

      expect(paidAfter.status, "the paid row must survive even though it was created later").toBe("paid");
      expect(pendingAfter.status, "the abandoned pending row must lose").toBe("expired");
      expect(pendingAfter.expires_at).toBeNull();

      const cat = await client.query<{ slots_taken: number }>("select slots_taken from categories where id = $1", [f.categoryId]);
      expect(cat.rows[0].slots_taken, "the loser was pending -- it never held a slot, so none should be released").toBe(5);
    });
  });

  it("with two paid rows, the earlier survives and slots_taken drops by exactly one", async () => {
    await withRolledBackTx(async (client) => {
      const f = await stageFixture(client);
      const earlier = new Date(Date.now() - 2 * 3_600_000).toISOString();
      const later = new Date(Date.now() - 3_600_000).toISOString();

      const earlierId = await insertRegistration(client, f, "paid", earlier);
      const laterId = await insertRegistration(client, f, "paid", later);

      await client.query("select dedupe_live_registrations()");

      const rows = await client.query<{ id: string; status: string; expires_at: string | null }>(
        "select id, status, expires_at from registrations where id in ($1, $2)",
        [earlierId, laterId],
      );
      const earlierAfter = rows.rows.find((r) => r.id === earlierId)!;
      const laterAfter = rows.rows.find((r) => r.id === laterId)!;

      expect(earlierAfter.status, "between two paid rows, the earlier one wins the tiebreak").toBe("paid");
      expect(laterAfter.status).toBe("expired");
      expect(laterAfter.expires_at).toBeNull();

      const cat = await client.query<{ slots_taken: number }>("select slots_taken from categories where id = $1", [f.categoryId]);
      expect(cat.rows[0].slots_taken, "exactly one paid loser -- slots_taken must drop by exactly 1").toBe(4);
    });
  });
});

describe("expiry of unpaid entries", () => {
  it("expires a pending entry past its hold window and fails its payment", async () => {
    const svc = service();
    const f = await makeEvent(`sweep${Date.now()}`);
    const runner = await makeUser(`gate_sweep_${Date.now()}@test.dev`);

    const reg = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    await svc.from("payments").insert({
      org_id: f.orgId, registration_id: reg.data!.id, amount: 100000, status: "pending",
    });
    await svc.from("registrations")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", reg.data!.id);

    const swept = await svc.rpc("expire_stale_registrations");
    expect(swept.error).toBeNull();

    const after = await svc.from("registrations").select("status,expires_at").eq("id", reg.data!.id).single();
    expect(after.data!.status).toBe("expired");
    expect(after.data!.expires_at).toBeNull();

    const pay = await svc.from("payments").select("status").eq("registration_id", reg.data!.id).single();
    expect(pay.data!.status).toBe("failed");
  });

  it("leaves slots_taken untouched — expiry must never manufacture capacity", async () => {
    const svc = service();
    const f = await makeEvent(`slots${Date.now()}`);
    const runner = await makeUser(`gate_slots_${Date.now()}@test.dev`);

    await svc.from("categories").update({ slots_taken: 4 }).eq("id", f.categoryId);
    const reg = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    await svc.from("registrations")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", reg.data!.id);

    await svc.rpc("expire_stale_registrations");

    const cat = await svc.from("categories").select("slots_taken").eq("id", f.categoryId).single();
    expect(cat.data!.slots_taken).toBe(4);
  });

  it("leaves a paid entry alone no matter how old", async () => {
    const svc = service();
    const f = await makeEvent(`paid${Date.now()}`);
    const runner = await makeUser(`gate_paid_${Date.now()}@test.dev`);

    const reg = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    await svc.from("registrations")
      .update({ status: "paid", expires_at: new Date(Date.now() - 86_400_000).toISOString() })
      .eq("id", reg.data!.id);

    await svc.rpc("expire_stale_registrations");

    const after = await svc.from("registrations").select("status").eq("id", reg.data!.id).single();
    expect(after.data!.status).toBe("paid");
  });

  it("expires pending entries the moment the event closes", async () => {
    const svc = service();
    const f = await makeEvent(`close${Date.now()}`);
    const runner = await makeUser(`gate_close_${Date.now()}@test.dev`);
    const reg = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();

    await svc.from("events").update({ status: "closed" }).eq("id", f.eventId);

    const after = await svc.from("registrations").select("status").eq("id", reg.data!.id).single();
    expect(after.data!.status).toBe("expired");
  });

  it("frees the runner to register again after expiry", async () => {
    const svc = service();
    const f = await makeEvent(`free${Date.now()}`);
    const runner = await makeUser(`gate_free_${Date.now()}@test.dev`);

    const reg = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    await svc.from("registrations")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", reg.data!.id);
    await svc.rpc("expire_stale_registrations");

    const again = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    expect(again.error).toBeNull();
  });
});
