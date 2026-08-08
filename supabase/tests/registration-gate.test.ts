import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
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
 * What this suite does NOT cover, and why: asserting the function actually resolves
 * a genuine duplicate (earliest survives, losers expire, slots_taken drops by exactly
 * the paid-loser count) requires staging two live 'pending'/'paid' rows for the same
 * (event_id, user_id) -- which the partial unique index this migration creates makes
 * impossible through ANY client, including service_role, by design. Verified directly:
 * inserting two rows as 'cancelled' (outside the index's predicate) and then flipping
 * both to 'paid', either as one multi-row UPDATE or as two sequential single-row
 * UPDATEs, both 23505 on the second row -- Postgres checks each new partial-index
 * tuple as it's written, even mid-statement, so there is no window in which two live
 * rows for the same key coexist. The only way around that is DDL that drops or
 * disables the index (this repo has no `pg`/raw-Postgres dependency to run that from
 * a test, and none was added for this), which would mean shipping a path capable of
 * making the production index disappear, even briefly, purely to satisfy a test --
 * exactly the tradeoff the index exists to prevent. So this suite instead asserts the
 * function's behaviour on the ONE thing that's safe to construct: a single genuine
 * registration, confirming the function is a true no-op against it (idempotent, no
 * false-positive expiry, no false slots_taken adjustment). The duplicate-resolution
 * path itself (ranked/losers/released) was reviewed line-by-line against the original
 * inline CTE it was extracted from character-for-character, and its outcome IS
 * covered indirectly by the "allows a new registration once the previous one is
 * cancelled, refunded or expired" test above, which exercises the same status
 * transition semantics the dedupe relies on.
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
 * This is exactly the branch the "dedupe of pre-existing duplicates" describe block
 * above cannot reach: proving it requires two 'pending'/'paid' rows for the same
 * (event_id, user_id) to exist at once, which registrations_one_live_per_event forbids
 * unconditionally (see that block's header comment -- reconfirmed true here, the
 * ordering rule doesn't change that constraint at all).
 *
 * So this covers the ordering rule two ways, neither requiring DDL or two live rows for
 * the same event:
 *
 * 1. _dedupe_rank_probe (20260809100160_dedupe_rank_test_probes.sql) runs the exact
 *    deployed ORDER BY clause against two REAL registration rows with genuine 'pending'
 *    and 'paid' statuses -- just for two DIFFERENT events, so the unique index has
 *    nothing to object to. Proves the rule behaves correctly: paid outranks pending
 *    regardless of which was created first, and same-status pairs still tiebreak on
 *    created_at/id.
 * 2. _dedupe_source_contains asserts the REAL, deployed dedupe_live_registrations()
 *    function's source (via pg_get_functiondef) still contains the paid-wins ORDER BY.
 *    _dedupe_rank_probe's clause is a hand-kept copy of that ORDER BY, not a shared
 *    reference -- on its own it would keep passing even if someone reverted the real
 *    function back to `created_at, id` and forgot to touch the probe. This assertion is
 *    what actually fails in that scenario: it reads the real function's current body,
 *    not the probe's copy.
 */
describe("dedupe winner-selection order (paid always wins, then earliest)", () => {
  it("ranks a genuinely paid row ahead of an earlier abandoned pending row", async () => {
    const svc = service();
    const older = await makeEvent(`rankpending${Date.now()}`);
    const newer = await makeEvent(`rankpaid${Date.now()}`);
    const runner = await makeUser(`gate_rank_${Date.now()}@test.dev`);

    const earlier = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const later = new Date(Date.now() - 3_600_000).toISOString();

    const pendingRow = { ...regRow(older, runner.id), status: "pending", created_at: earlier };
    const paidRow = { ...regRow(newer, runner.id), status: "paid", created_at: later };

    const pending = await svc.from("registrations").insert(pendingRow).select().single();
    expect(pending.error).toBeNull();
    const paid = await svc.from("registrations").insert(paidRow).select().single();
    expect(paid.error).toBeNull();

    const probe = await svc.rpc("_dedupe_rank_probe", { id_a: pending.data!.id, id_b: paid.data!.id });
    expect(probe.error).toBeNull();
    const winner = probe.data!.find((r: { id: string; rn: number }) => r.rn === 1);
    expect(winner?.id, "the paid row must rank first even though the pending row is older").toBe(paid.data!.id);
  });

  it("still tiebreaks on created_at/id when both candidates share a status", async () => {
    const svc = service();
    const a = await makeEvent(`rankties_a${Date.now()}`);
    const b = await makeEvent(`rankties_b${Date.now()}`);
    const runner = await makeUser(`gate_rank_tie_${Date.now()}@test.dev`);

    const earlier = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const later = new Date(Date.now() - 3_600_000).toISOString();

    const first = await svc.from("registrations").insert({ ...regRow(a, runner.id), status: "pending", created_at: earlier }).select().single();
    expect(first.error).toBeNull();
    const second = await svc.from("registrations").insert({ ...regRow(b, runner.id), status: "pending", created_at: later }).select().single();
    expect(second.error).toBeNull();

    const probe = await svc.rpc("_dedupe_rank_probe", { id_a: first.data!.id, id_b: second.data!.id });
    expect(probe.error).toBeNull();
    const winner = probe.data!.find((r: { id: string; rn: number }) => r.rn === 1);
    expect(winner?.id, "with equal status, the earlier created_at must still win").toBe(first.data!.id);
  });

  it("the deployed dedupe_live_registrations() still contains the paid-wins ORDER BY", async () => {
    const svc = service();
    const check = await svc.rpc("_dedupe_source_contains", { needle: "(status = 'paid') desc" });
    expect(check.error).toBeNull();
    expect(check.data, "dedupe_live_registrations()'s ORDER BY must not regress to created_at,id").toBe(true);
  });
});
