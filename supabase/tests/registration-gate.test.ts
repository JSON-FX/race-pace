import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { createHmac } from "node:crypto";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey, dbUrl } = loadEnv();
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
const service = () => createClient(url, serviceKey, { auth: { persistSession: false } });

/** Edge Functions run in a separate process (`supabase functions serve`) that a plain
 *  `pnpm test` does not start -- see backend.test.ts, which is in the known-bad file
 *  set for exactly this reason (it has no guard and fails outright when serve is down).
 *  The webhook-path tests below probe for it up front, at module load (before `describe`
 *  registers any tests), and skip -- not fail -- when nothing answers. A skipped test is
 *  honest signal; a test that red's out because a second process isn't running trains
 *  everyone to ignore red. */
const FN = `${url}/functions/v1`;
async function probeFunctionsServe(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    // A deliberately-bad signature exercises payments-webhook's own signature check,
    // which only runs if the function itself is up and answering -- it responds 401.
    // When `supabase functions serve` is down, Kong is still up (it's a separate
    // container) but has nothing to proxy to, so it answers with a 503/502 of its own
    // rather than reaching the function. Checking for exactly 401 (not "any response")
    // is what tells the two apart -- a bare `res.status > 0` check was tried first and
    // wrongly reported "up" against Kong's 503, which is why this is exact-status, not
    // reachability-only.
    const res = await fetch(`${FN}/payments-webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "Paymongo-Signature": "t=1,te=deadbeef" },
      body: "{}",
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    return res.status === 401;
  } catch {
    return false;
  }
}
const functionsUp = await probeFunctionsServe();

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

    const swept = await svc.rpc("expire_stale_registrations");
    expect(swept.error).toBeNull();

    const after = await svc.from("registrations").select("status").eq("id", reg.data!.id).single();
    expect(after.data!.status, "the sweep must actually have expired this row").toBe("expired");

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

    const swept = await svc.rpc("expire_stale_registrations");
    expect(swept.error).toBeNull();

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

describe("late capture on an expired registration", () => {
  const confirmArgs = (id: string) => ({
    p_registration_id: id, p_method: "gcash", p_fee: 0, p_net: 100000,
    p_token: `tok_${id}`, p_raw: {},
  });

  it("resurrects an expired registration when the runner has no other entry", async () => {
    const svc = service();
    const f = await makeEvent(`resurrect${Date.now()}`);
    const runner = await makeUser(`gate_res_${Date.now()}@test.dev`);

    const reg = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    await svc.from("payments").insert({ org_id: f.orgId, registration_id: reg.data!.id, amount: 100000, status: "pending" });
    await svc.from("registrations").update({ status: "expired", expires_at: null }).eq("id", reg.data!.id);

    const res = await svc.rpc("confirm_payment_tx", confirmArgs(reg.data!.id));
    expect(res.data).toBe("paid");

    const after = await svc.from("registrations").select("status").eq("id", reg.data!.id).single();
    expect(after.data!.status).toBe("paid");
  });

  it("returns 'conflict' instead of confirming when a live entry already exists", async () => {
    const svc = service();
    const f = await makeEvent(`conflict${Date.now()}`);
    const runner = await makeUser(`gate_conf_${Date.now()}@test.dev`);

    const stale = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    await svc.from("payments").insert({ org_id: f.orgId, registration_id: stale.data!.id, amount: 100000, status: "pending" });
    await svc.from("registrations").update({ status: "expired", expires_at: null }).eq("id", stale.data!.id);

    // The runner gave up and registered again; that new entry is the live one.
    const fresh = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    expect(fresh.error).toBeNull();

    const res = await svc.rpc("confirm_payment_tx", confirmArgs(stale.data!.id));
    expect(res.data).toBe("conflict");

    const after = await svc.from("registrations").select("status").eq("id", stale.data!.id).single();
    expect(after.data!.status).toBe("expired");
  });

  it("still refuses to re-confirm a refunded registration", async () => {
    const svc = service();
    const f = await makeEvent(`replay${Date.now()}`);
    const runner = await makeUser(`gate_replay_${Date.now()}@test.dev`);

    const reg = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    await svc.from("registrations").update({ status: "refunded" }).eq("id", reg.data!.id);

    const res = await svc.rpc("confirm_payment_tx", confirmArgs(reg.data!.id));
    expect(res.data).toBe("not_pending");
  });

  /**
   * Fix round 1 (review finding): the v_live pre-check inside confirm_payment_tx is a
   * plain unlocked `select count(*)`, not a lock. Two late captures landing concurrently
   * for two DIFFERENT expired registrations of the same runner+event can both read
   * v_live = 0 before either has committed its 'paid' write, and both proceed to the
   * UPDATE. registrations_one_live_per_event (a plain, non-deferrable unique index --
   * see the header comment above `withRolledBackTx`) still prevents an actual
   * double-booking, but without the exception handler added in this fix round, the
   * second writer's UPDATE would raise a raw, uncaught unique_violation (23505) instead
   * of gracefully returning 'conflict'.
   *
   * This is staged as a genuine two-connection race, not merely asserted by reading the
   * function body: two raw `pg` connections each start a transaction and call
   * confirm_payment_tx for a different expired sibling of the same runner+event. Client
   * A's call is awaited to completion but NOT committed, so its 'paid' write to regA is
   * on-disk but invisible to any other transaction (ordinary MVCC/READ COMMITTED
   * visibility -- ROW LOCKS play no part in this: a plain, non-FOR-UPDATE select never
   * blocks on another transaction's row lock, it simply doesn't see the uncommitted
   * version). Client B's call is then dispatched -- its own pre-check therefore also
   * reads v_live = 0, for the same reason -- and it proceeds to attempt the same UPDATE.
   * That UPDATE has to insert a new tuple into registrations_one_live_per_event, which
   * DOES contend with A's not-yet-committed entry for the same (event_id, user_id): index
   * uniqueness enforcement in Postgres must account for concurrent uncommitted inserts
   * (otherwise two transactions could each insert the "same" key and only discover the
   * violation after both commit), so B's backend blocks on A's transaction, waiting to
   * learn whether A commits or aborts. The test polls pg_stat_activity for that lock wait
   * before committing A, so the collision is forced deterministically rather than hoped
   * for via a fixed sleep -- if B never actually blocks, the test fails loudly on that
   * assertion rather than passing for the wrong reason.
   */
  it("races two late captures for the same runner+event: exactly one 'paid', the other 'conflict', slots_taken +1 only", async () => {
    const svc = service();
    const f = await makeEvent(`race${Date.now()}`);
    const runner = await makeUser(`gate_race_${Date.now()}@test.dev`);

    // Two siblings, both eventually expired -- mirrors a runner whose first checkout
    // expired and who tried again, and that second attempt also expired before either
    // payment captured.
    const regA = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    await svc.from("payments").insert({ org_id: f.orgId, registration_id: regA.data!.id, amount: 100000, status: "pending" });
    await svc.from("registrations").update({ status: "expired", expires_at: null }).eq("id", regA.data!.id);

    const regB = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    await svc.from("payments").insert({ org_id: f.orgId, registration_id: regB.data!.id, amount: 100000, status: "pending" });
    await svc.from("registrations").update({ status: "expired", expires_at: null }).eq("id", regB.data!.id);

    const before = (await svc.from("categories").select("slots_taken").eq("id", f.categoryId).single()).data!.slots_taken;

    const clientA = new Client({ connectionString: dbUrl });
    const clientB = new Client({ connectionString: dbUrl });
    await clientA.connect();
    await clientB.connect();

    async function waitForLockWait(poller: Client, pid: number, timeoutMs = 5000): Promise<boolean> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const r = await poller.query<{ wait_event_type: string | null }>(
          "select wait_event_type from pg_stat_activity where pid = $1", [pid],
        );
        if (r.rows[0]?.wait_event_type === "Lock") return true;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return false;
    }

    try {
      await clientA.query("begin");
      const resA = await clientA.query<{ confirm_payment_tx: string }>(
        "select confirm_payment_tx($1,$2,$3,$4,$5,$6)",
        [regA.data!.id, "gcash", 0, 100000, `tok_${regA.data!.id}`, {}],
      );
      // regA's write is complete inside A's still-open (uncommitted) transaction.
      expect(resA.rows[0].confirm_payment_tx).toBe("paid");

      await clientB.query("begin");
      const bPid = (await clientB.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      // Dispatched, not awaited yet: B's pre-check will also read v_live = 0 (A's write
      // is still uncommitted and thus invisible), so B proceeds to the same UPDATE and
      // blocks on A's uncommitted conflicting index entry.
      const bPromise = clientB.query<{ confirm_payment_tx: string }>(
        "select confirm_payment_tx($1,$2,$3,$4,$5,$6)",
        [regB.data!.id, "gcash", 0, 100000, `tok_${regB.data!.id}`, {}],
      );

      const blocked = await waitForLockWait(clientA, bPid);
      expect(blocked, "test setup requires B to actually block on A's uncommitted write -- " +
        "if this is false the race was not reproduced and the assertions below are meaningless").toBe(true);

      await clientA.query("commit");
      const resB = await bPromise;
      expect(resB.rows[0].confirm_payment_tx).toBe("conflict");

      await clientB.query("commit");
    } finally {
      await clientA.end();
      await clientB.end();
    }

    const after = await svc.from("registrations").select("id,status").in("id", [regA.data!.id, regB.data!.id]);
    const byId = Object.fromEntries((after.data ?? []).map((r) => [r.id, r.status]));
    expect(byId[regA.data!.id]).toBe("paid");
    expect(byId[regB.data!.id]).toBe("expired"); // B's write was rolled back by the exception handler's implicit savepoint

    const afterCat = await svc.from("categories").select("slots_taken").eq("id", f.categoryId).single();
    expect(afterCat.data!.slots_taken).toBe(before + 1); // exactly one winner incremented the slot
  });
});

/**
 * Fix round 1 (review finding): every "late capture" test above calls
 * confirm_payment_tx directly via svc.rpc(...), which bypasses confirm.ts entirely.
 * The two changes made to confirm.ts beyond the brief -- narrowing the early
 * short-circuit so 'expired' actually reaches the RPC, and treating 'conflict' as
 * terminal so it can't fall through to the ticket-email step -- were the highest-risk
 * part of that diff (without them the SQL-level fix is dead code from the webhook's
 * point of view) and had zero coverage through the layer that would normally exercise
 * them. backend.test.ts is exactly that layer, but it's in the known-bad set because
 * `supabase functions serve` isn't up under a plain `pnpm test`.
 *
 * These two tests go through the real payments-webhook Edge Function (signed request,
 * same HMAC scheme as backend.test.ts's signHeader/postWebhook -- reused here rather
 * than reinvented, since duplicating it locally is simpler than exporting private
 * helpers from another test file) so confirm.ts's actual code path runs, not just the
 * SQL underneath it. They probe for the edge runtime at module load (see
 * `probeFunctionsServe` above) and skip -- not fail -- when it isn't answering.
 */
describe("late capture via the real payments-webhook (needs `supabase functions serve`)", () => {
  const WEBHOOK_SECRET = "whsec_test_localdev"; // must match supabase/functions/.env, same as backend.test.ts
  function signHeader(rawBody: string): string {
    const t = Math.floor(Date.now() / 1000).toString();
    const sig = createHmac("sha256", WEBHOOK_SECRET).update(`${t}.${rawBody}`).digest("hex");
    return `t=${t},te=${sig}`;
  }
  function postWebhook(payload: unknown) {
    const raw = JSON.stringify(payload);
    return fetch(`${FN}/payments-webhook`, {
      method: "POST",
      headers: { "content-type": "application/json", "Paymongo-Signature": signHeader(raw) },
      body: raw,
    });
  }
  const paidEvent = (registrationId: string) => ({
    data: {
      attributes: {
        type: "checkout_session.payment.paid",
        data: {
          attributes: {
            metadata: { registration_id: registrationId },
            payments: [{ attributes: { source: { type: "gcash" } } }],
          },
        },
      },
    },
  });

  it.skipIf(!functionsUp)(
    "resurrects an expired registration to paid through the real webhook path",
    async () => {
      const svc = service();
      const f = await makeEvent(`wh_res${Date.now()}`);
      const runner = await makeUser(`gate_wh_res_${Date.now()}@test.dev`);

      const reg = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
      await svc.from("payments").insert({ org_id: f.orgId, registration_id: reg.data!.id, amount: 100000, status: "pending" });
      await svc.from("registrations").update({ status: "expired", expires_at: null }).eq("id", reg.data!.id);

      const res = await postWebhook(paidEvent(reg.data!.id));
      expect(res.status).toBe(200);

      const after = await svc.from("registrations").select("status,ticket_token").eq("id", reg.data!.id).single();
      expect(after.data!.status).toBe("paid");
      expect(after.data!.ticket_token).toBeTruthy(); // proves confirm.ts's early short-circuit no longer eats 'expired'
    },
  );

  it.skipIf(!functionsUp)(
    "returns 200 without confirming (and without a ticket to email) when a live sibling exists",
    async () => {
      const svc = service();
      const f = await makeEvent(`wh_conf${Date.now()}`);
      const runner = await makeUser(`gate_wh_conf_${Date.now()}@test.dev`);

      const stale = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
      await svc.from("payments").insert({ org_id: f.orgId, registration_id: stale.data!.id, amount: 100000, status: "pending" });
      await svc.from("registrations").update({ status: "expired", expires_at: null }).eq("id", stale.data!.id);
      // The runner gave up and registered again; that new entry is the live one.
      const fresh = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
      expect(fresh.error).toBeNull();

      const res = await postWebhook(paidEvent(stale.data!.id));
      // 200/ok:true, not 500 -- a capture conflict is not a transient failure, so the
      // webhook must not signal PayMongo to retry it (confirm.ts's early-return on
      // 'conflict', not the generic error branch).
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);

      const after = await svc.from("registrations").select("status,ticket_token").eq("id", stale.data!.id).single();
      expect(after.data!.status).toBe("expired"); // untouched -- confirm_payment_tx never wrote
      // No ticket_token, so there is nothing a ticket email could have been built from.
      //
      // HONEST LIMIT OF THIS TEST -- read before trusting it as email coverage. These
      // assertions do NOT discriminate confirm.ts's `return` on 'conflict' from a
      // fall-through: if the early return were deleted, `already` would compute to false,
      // functions.invoke("send-ticket-email") WOULD fire -- and every assertion here
      // would still pass, because send-ticket-email refuses (409 not_paid) for any
      // registration that isn't 'paid', and supabase-js's invoke() returns that error
      // rather than throwing, so nothing observable outside the edge-runtime process
      // changes. There is no seam from a Node test to intercept a function-to-function
      // invoke inside that process.
      //
      // The early return is nonetheless load-bearing (defence in depth, and it keeps a
      // pointless cross-function call off the capture path), and it IS verified -- by a
      // counterfactual run recorded in task-4-report.md: with the return in place the
      // edge-runtime log shows only `serving the request with .../payments-webhook`;
      // with it deleted the same log gains `serving the request with
      // .../send-ticket-email`. Reproduce it by deleting the return, re-running this
      // test with `supabase functions serve` in the foreground, and grepping that log.
      //
      // What this test DOES prove on its own: 'expired' reaches confirm_payment_tx, a
      // conflict answers 200 (so PayMongo does not retry) rather than 500, and no
      // registration/payment state moves.
      expect(after.data!.ticket_token).toBeNull();
    },
  );
});

/**
 * Task 5: registrations-checkout must turn a duplicate live entry into a
 * 409 the client can act on (existing registration id + checkout url),
 * instead of letting registrations_one_live_per_event's 23505 surface raw.
 * This exercises the real Edge Function, so it needs `supabase functions
 * serve` -- same probe/skip pattern as the webhook tests above.
 */
describe("registrations-checkout duplicate handling", () => {
  it.skipIf(!functionsUp)("returns already_registered with the existing entry", async () => {
    const svc = service();
    const f = await makeEvent(`co${Date.now()}`);
    const runner = await makeUser(`gate_co_${Date.now()}@test.dev`);

    const reg = await svc.from("registrations").insert(regRow(f, runner.id)).select().single();
    await svc.from("payments").insert({
      org_id: f.orgId, registration_id: reg.data!.id, amount: 100000,
      status: "pending", checkout_url: "https://checkout.test/abc",
    });

    const res = await fetch(`${FN}/registrations-checkout`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${runner.token}` },
      body: JSON.stringify({
        event_id: f.eventId, category_id: f.categoryId, addon_ids: [],
        custom_data: {}, waiver_accepted: true, idempotency_key: `k_${Date.now()}`,
      }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("already_registered");
    expect(body.registration_id).toBe(reg.data!.id);
    expect(body.checkout_url).toBe("https://checkout.test/abc");
  });
});
