import { describe, it, expect, afterEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey, dbUrl } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });

async function signedIn(email: string) {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: "password123" });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

const trash: string[] = [];
// Ruling 2: `makeOrg` creates auth users with deterministic emails. Track them
// here so a second run of this file (without a full `db reset`) does not fail
// on a duplicate-email conflict from a prior run's leftovers.
const trashUsers: string[] = [];
afterEach(async () => {
  // Best-effort: a test that already deleted its org leaves a no-op here.
  for (const id of trash.splice(0)) await svc().from("organizations").delete().eq("id", id);
  for (const id of trashUsers.splice(0)) await svc().auth.admin.deleteUser(id);
});

/** An org with an event, TWO categories, and a registration in each. Two
 *  categories, not one: `delete_organization_tx` exists for reasons unpacked
 *  in the migration's header, not to dodge a foreign-key ordering hazard —
 *  that hazard was tested against exactly this shape and does not reproduce
 *  (a plain `delete from organizations` succeeds here; see the migration's
 *  §3 comment for what was actually verified and why the function still
 *  exists). Kept at two categories anyway so this fixture stays the same
 *  shape the money-guard tests below reuse. */
async function makeOrg(slug: string) {
  const db = svc();
  const { data: org } = await db.from("organizations")
    .insert({ name: `T ${slug}`, slug, commission_type: "percent", commission_rate: 0.03 })
    .select("id").single();
  trash.push(org!.id);

  const { data: ev } = await db.from("events")
    .insert({ org_id: org!.id, name: "T Race", status: "open" }).select("id").single();

  const cats = [];
  for (const code of ["10k", "21k"]) {
    const { data: c } = await db.from("categories")
      .insert({ org_id: org!.id, event_id: ev!.id, code, label: code.toUpperCase(), base_price: 100000 })
      .select("id").single();
    cats.push(c!.id);
  }

  const regs = [];
  for (const [i, catId] of cats.entries()) {
    const { data: u } = await db.auth.admin.createUser({
      email: `t-${slug}-${i}-${org!.id}@racepace.test`, password: "password123", email_confirm: true,
    });
    trashUsers.push(u!.user!.id);
    const { data: r } = await db.from("registrations")
      .insert({ org_id: org!.id, event_id: ev!.id, category_id: catId, user_id: u!.user!.id })
      .select("id").single();
    regs.push({ id: r!.id, userId: u!.user!.id });
  }

  return { orgId: org!.id, eventId: ev!.id, cats, regs };
}

describe("delete_organization_tx", () => {
  it("deletes an org whose registrations span several categories", async () => {
    const { orgId, regs } = await makeOrg("t-del-ok");

    const { data, error } = await svc().rpc("delete_organization_tx", { p_org_id: orgId });

    // Not a reproduction of a plain-delete failure — there isn't one (see
    // makeOrg's comment). This proves the RPC's actual job: the money guard
    // ran, nothing blocked it, and the counts it returns match what existed.
    expect(error).toBeNull();
    expect(data).toMatchObject({ events: 1, categories: 2, registrations: 2 });

    const after = await svc().from("organizations").select("id").eq("id", orgId);
    expect(after.data).toHaveLength(0);
    const orphans = await svc().from("registrations").select("id").in("id", regs.map((r) => r.id));
    expect(orphans.data).toHaveLength(0);
  });

  it.each(["paid", "refunded", "partially_refunded"])(
    "refuses to delete an org with a %s payment", async (status) => {
      const { orgId, regs } = await makeOrg(`t-del-${status.slice(0, 6)}`);
      await svc().from("payments").insert({
        org_id: orgId, registration_id: regs[0].id, amount: 100000, status,
      });

      const { error } = await svc().rpc("delete_organization_tx", { p_org_id: orgId });

      expect(error?.message).toMatch(/org_has_payments/);
      // The SQLSTATE, not only the message. `mapDeleteRpcError`
      // (_shared/orgAdmin.ts) discriminates on `error.code` FIRST and treats
      // the message text as a fallback, so a migration that dropped `using
      // errcode = 'P0001'` would silently turn every blocked delete into a
      // 500 while this test stayed green on the message alone.
      expect(error?.code).toBe("P0001");
      const still = await svc().from("organizations").select("id").eq("id", orgId);
      expect(still.data).toHaveLength(1);
    });

  it.each(["pending", "failed"])("allows deletion when payments are only %s", async (status) => {
    const { orgId, regs } = await makeOrg(`t-del-${status}`);
    await svc().from("payments").insert({
      org_id: orgId, registration_id: regs[0].id, amount: 100000, status,
    });

    const { error } = await svc().rpc("delete_organization_tx", { p_org_id: orgId });
    expect(error).toBeNull();
    // `error === null` alone would also pass against a function that returned
    // cleanly and deleted nothing — which is exactly the failure mode a broken
    // guard would produce here. Assert the row is actually gone.
    const after = await svc().from("organizations").select("id").eq("id", orgId);
    expect(after.data, `an org with only a ${status} payment must actually be deleted`).toHaveLength(0);
  });

  it("raises org_not_found for an id that matches nothing", async () => {
    const { error } = await svc().rpc("delete_organization_tx", {
      p_org_id: "00000000-0000-0000-0000-0000000000ff",
    });
    expect(error?.message).toMatch(/org_not_found/);
    // Same reason as the P0001 assertion above: `mapDeleteRpcError` reads the
    // SQLSTATE first, and spec §9 wants this to be a routine 404 (two
    // operators deleting the same org), not a 500.
    expect(error?.code).toBe("P0002");
  });
});

/** An org with one open event and its own admin — purpose-built so the
 *  suspension tests never touch shared seed data. Root vitest.config.ts sets
 *  no fileParallelism:false, and backend.test.ts reads Muspo
 *  (00000000-0000-0000-0000-00000000a001) and its categories as anon in the
 *  same run; flipping that org's is_active here would race it. */
async function makeSuspendableOrg(slug: string) {
  const db = svc();
  const { data: org } = await db.from("organizations")
    .insert({ name: `T ${slug}`, slug, commission_type: "percent", commission_rate: 0.03 })
    .select("id").single();
  trash.push(org!.id);

  const { data: ev } = await db.from("events")
    .insert({ org_id: org!.id, name: "T Race", status: "open" }).select("id").single();

  const email = `t-${slug}-admin-${org!.id}@racepace.test`;
  const { data: u } = await db.auth.admin.createUser({
    email, password: "password123", email_confirm: true,
  });
  trashUsers.push(u!.user!.id);
  await db.from("user_roles").insert({ user_id: u!.user!.id, org_id: org!.id, role: "admin" });

  return { orgId: org!.id, eventId: ev!.id, adminEmail: email };
}

describe("a suspended organization", () => {
  it("is invisible to anon but still visible to its own admin and the super admin", async () => {
    const { orgId, adminEmail } = await makeSuspendableOrg("t-susp-org");
    await svc().from("organizations").update({ is_active: false }).eq("id", orgId);

    const asAnon = await anon().from("organizations").select("id").eq("id", orgId);
    expect(asAnon.data).toHaveLength(0);

    // The regression this guards: `orgs_read_active` used to be
    // `using (is_active = true)`, which hid a suspended org from the very page
    // a super admin would un-suspend it from, and broke the console for the
    // org's own staff.
    const asOrgAdmin = await (await signedIn(adminEmail))
      .from("organizations").select("id").eq("id", orgId);
    expect(asOrgAdmin.data).toHaveLength(1);

    const asSuper = await (await signedIn("admin@racepace.test"))
      .from("organizations").select("id").eq("id", orgId);
    expect(asSuper.data).toHaveLength(1);
  });

  it("has its events removed from the storefront but not from its own console", async () => {
    const { orgId, adminEmail } = await makeSuspendableOrg("t-susp-evt");
    const before = await anon().from("events").select("id").eq("org_id", orgId);
    expect(before.data!.length).toBeGreaterThan(0);

    await svc().from("organizations").update({ is_active: false }).eq("id", orgId);

    const asAnon = await anon().from("events").select("id").eq("org_id", orgId);
    expect(asAnon.data).toHaveLength(0);

    // events_read_org_admin is a separate permissive policy; policies are OR'd.
    const asOrgAdmin = await (await signedIn(adminEmail))
      .from("events").select("id").eq("org_id", orgId);
    expect(asOrgAdmin.data!.length).toBeGreaterThan(0);
  });
});

describe("delete_organization_tx / confirm_payment_tx lock ordering", () => {
  /**
   * Fix round 2 (review finding): an earlier version of `delete_organization_tx`
   * locked `payments` before `registrations`, the opposite order from
   * `confirm_payment_tx` (which locks the registration row first, via its own
   * `for update`, and only touches `payments` afterward through a plain
   * `update`). Two sessions taking locks in opposite orders is a textbook
   * deadlock, and the reviewer reproduced one on the local DB between these
   * two functions. The fix makes `delete_organization_tx` lock registrations
   * first too.
   *
   * Round 3 (review finding): this test does NOT prove that fix prevents a
   * deadlock, and its name and comment used to claim it did -- wrongly. The
   * reviewer proved it by temporarily reverting the lock order in the live DB
   * and re-running this test: it still passed. The reason it can't
   * discriminate: connection A runs `confirm_payment_tx` to full, synchronous
   * completion -- acquiring every lock it will ever take -- before connection
   * B starts at all. A is never mid-acquisition when B begins, so B can only
   * ever be a one-way waiter behind locks A already holds. A genuine deadlock
   * needs two transactions simultaneously holding-and-waiting on each other,
   * which this interleaving structurally cannot produce.
   *
   * What it DOES prove, and is kept for: a delete that arrives while a settle
   * is genuinely in flight resolves to a clean `org_has_payments`, not a hang
   * or a raw error surfacing to the caller -- a real, useful behaviour, just
   * not the deadlock-avoidance one. The `waitForLockWait` polling on
   * `pg_stat_activity` is real and not decorative: it proves B actually
   * blocks on A's lock rather than racing past it, which is what makes the
   * "in flight" framing true rather than assumed.
   *
   * The lock-order regression guard itself now lives in the structural test
   * below, which CAN discriminate the two orders (verified by the same
   * revert-and-rerun method — see this file's fix-round-3 report entry).
   *
   * Staged as a genuine two-connection interleaving, not merely asserted by
   * reading the function bodies -- same pattern as
   * registration-gate.test.ts's `waitForLockWait`: two raw `pg` connections,
   * one polling `pg_stat_activity` for the other's lock-wait state so the
   * block is forced deterministically rather than hoped for via a fixed
   * sleep.
   */
  it("a delete blocked behind an in-flight settle resolves to org_has_payments", async () => {
    const { orgId, regs } = await makeOrg("t-lockrace");
    const regId = regs[0].id;
    await svc().from("payments").insert({
      org_id: orgId, registration_id: regId, amount: 100000, status: "pending",
    });

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

    const clientA = new Client({ connectionString: dbUrl });
    const clientB = new Client({ connectionString: dbUrl });
    await clientA.connect();
    await clientB.connect();

    try {
      // A: settle the payment, to completion, and leave the transaction open
      // (uncommitted) afterward. Its `for update` lock on the registration
      // row is still held, and the 'paid' write is not yet visible to any
      // other transaction's snapshot.
      await clientA.query("begin");
      const resA = await clientA.query<{ confirm_payment_tx: string }>(
        "select confirm_payment_tx($1,$2,$3,$4,$5,$6)",
        [regId, "gcash", 0, 100000, `tok_${regId}`, {}],
      );
      expect(resA.rows[0]!.confirm_payment_tx).toBe("paid");

      // B: delete_organization_tx locks registrations first too (post-fix),
      // so it blocks on the SAME row A is still holding.
      await clientB.query("begin");
      const bPid = (await clientB.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      const bPromise = clientB.query("select delete_organization_tx($1)", [orgId]);

      const blocked = await waitForLockWait(clientA, bPid);
      expect(
        blocked,
        "test setup requires B to actually block on A's uncommitted registrations lock " +
          "-- if this is false the race was not reproduced and the assertion below is meaningless",
      ).toBe(true);

      // Commit A: the payment is now durably 'paid'. B unblocks and must see it.
      await clientA.query("commit");

      await expect(bPromise).rejects.toThrow(/org_has_payments/);
      await clientB.query("rollback");
    } finally {
      await clientA.end();
      await clientB.end();
    }

    // The delete was refused, not partially applied -- the org is still there.
    const still = await svc().from("organizations").select("id").eq("id", orgId);
    expect(still.data).toHaveLength(1);
    trash.push(orgId);
  });

  /**
   * Round 3 (review finding): the behavioural test above cannot discriminate
   * lock order (see its comment) -- the reviewer proved that by reverting the
   * fix and watching it still pass. The coordinator ruled against hand-rolling
   * `confirm_payment_tx`'s own sub-statements on a second connection to force
   * a genuine deadlock instead: that would test an imitation of the function
   * rather than the function, and would go stale silently the moment
   * `confirm_payment_tx`'s internals change -- the exact failure mode this
   * migration has already been bitten by twice (round 1's false ordering
   * claim, round 2's misattributed comment).
   *
   * So this reads the function's actual, live definition out of the catalog
   * instead -- `pg_get_functiondef`, the same escape hatch
   * function-grants.test.ts (`_function_grant_audit`) and
   * processor-fee-ledger.test.ts (`has_column_privilege`) already use for
   * catalog-level invariants -- and asserts the textual order of the two
   * `for update` lock statements directly. Deterministic, no timing
   * dependency, and it IS a real regression guard: reverting the lock order
   * flips the match order and fails this test immediately. (Verified: see
   * this file's fix-round-3 report entry for the revert-and-rerun that
   * confirms this test actually fails against the old order, the same way
   * the reviewer checked the behavioural test above.)
   */
  it("takes the registrations lock before the payments lock (structural)", async () => {
    const c = new Client({ connectionString: dbUrl });
    await c.connect();
    try {
      const { rows } = await c.query<{ src: string }>(
        `select pg_get_functiondef(p.oid) as src
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'delete_organization_tx'`,
      );
      expect(rows).toHaveLength(1);
      const src = rows[0]!.src;

      const lockOrder = [...src.matchAll(
        /perform 1 from public\.(registrations|payments)\s+where org_id = p_org_id\s+for update/g,
      )].map((m) => m[1]);

      expect(
        lockOrder,
        "expected exactly one `for update` lock statement each on registrations and payments, " +
          "registrations first",
      ).toEqual(["registrations", "payments"]);
    } finally {
      await c.end();
    }
  });
});

describe("registrations-checkout on a suspended org", () => {
  // Own throwaway org, not the seeded Muspo org -- same reason as
  // makeSuspendableOrg's header comment: flipping is_active on shared seed
  // data would race backend.test.ts, which reads Muspo as anon in the same
  // vitest run.
  it("refuses a direct call with an event id already in hand", async () => {
    const { orgId, eventId } = await makeSuspendableOrg("t-susp-checkout");
    const db = svc();
    const { data: cat } = await db.from("categories")
      .insert({ org_id: orgId, event_id: eventId, code: "10k", label: "10K", base_price: 100000 })
      .select("id").single();

    const email = `t-susp-checkout-runner-${orgId}@racepace.test`;
    const { data: u } = await db.auth.admin.createUser({
      email, password: "password123", email_confirm: true,
    });
    trashUsers.push(u!.user!.id);
    const runner = await signedIn(email);

    await db.from("organizations").update({ is_active: false }).eq("id", orgId);

    const { data, error } = await runner.functions.invoke("registrations-checkout", {
      body: {
        event_id: eventId,
        category_id: cat!.id,
        waiver_accepted: true,
        // registrationInputSchema requires idempotency_key (min 8 chars) --
        // omitting it fails schema validation before this check ever runs.
        idempotency_key: "susp-checkout-test-key",
      },
    });

    const code = data?.error ?? await (error as { context?: Response })?.context
      ?.clone().json().then((b: { error?: string }) => b?.error).catch(() => undefined);
    expect(code).toBe("org_suspended");
  });
});

/** A suspended org, one open event, a category, and a runner holding a PAID
 *  registration in it. Separate from `makeSuspendableOrg` because the ticket
 *  path needs the registration row itself — the whole finding below is that
 *  `events`/`organizations` were readable to nobody but org staff once the org
 *  went inactive, and a paying runner is not org staff. */
async function makeSuspendedOrgWithTicket(slug: string) {
  const db = svc();
  const { orgId, eventId } = await makeSuspendableOrg(slug);
  const { data: cat } = await db.from("categories")
    .insert({ org_id: orgId, event_id: eventId, code: "10k", label: "10K", base_price: 100000 })
    .select("id").single();

  const email = `t-${slug}-runner-${orgId}@racepace.test`;
  const { data: u } = await db.auth.admin.createUser({
    email, password: "password123", email_confirm: true,
  });
  trashUsers.push(u!.user!.id);
  await db.from("registrations").insert({
    org_id: orgId, event_id: eventId, category_id: cat!.id,
    user_id: u!.user!.id, status: "paid",
  });

  // A second runner with an account but NO registration anywhere in this org,
  // to prove the new predicate is scoped to the caller's own entries and is
  // not just "any signed-in user".
  const strangerEmail = `t-${slug}-stranger-${orgId}@racepace.test`;
  const { data: s } = await db.auth.admin.createUser({
    email: strangerEmail, password: "password123", email_confirm: true,
  });
  trashUsers.push(s!.user!.id);

  await db.from("organizations").update({ is_active: false }).eq("id", orgId);
  return { orgId, eventId, runnerEmail: email, strangerEmail };
}

/**
 * Spec decision 3: "Existing paid entries, tickets ... keep working", and the
 * suspend dialog promises "Paid entries stay valid".
 *
 * They did not. `events` had exactly two SELECT policies —
 * `events_read_published` (which this migration taught to require an active
 * org) and `events_read_org_admin` — and a runner holding a paid entry is
 * neither. So apps/site/lib/registration.ts's REG_SELECT returned the
 * registration with a NULL `events` embed and a NULL `organizations` embed:
 * /ticket/<id> rendered the literal string "Event" with no hero, no date and
 * no inclusions, and `mapReg`'s `org?.fee_mode ?? "absorb"` fallback showed a
 * pass_on org's runner the sticker price instead of what they were actually
 * charged.
 */
describe("a suspended organization's own runners", () => {
  it("can still read the event and the org they hold a registration for", async () => {
    const { orgId, eventId, runnerEmail } = await makeSuspendedOrgWithTicket("t-susp-ticket");
    const runner = await signedIn(runnerEmail);

    const ev = await runner.from("events").select("id,name").eq("id", eventId);
    expect(ev.data, "a paid runner's ticket cannot render without its event").toHaveLength(1);

    // fee_mode rides on this row. Without it mapReg defaults to 'absorb' and a
    // pass_on org's runner is shown a total they were never charged.
    const org = await runner.from("organizations").select("id,name,fee_mode").eq("id", orgId);
    expect(org.data).toHaveLength(1);
  });

  it("does not open the suspended org to a signed-in stranger", async () => {
    const { orgId, eventId, strangerEmail } = await makeSuspendedOrgWithTicket("t-susp-strange");
    const stranger = await signedIn(strangerEmail);

    expect((await stranger.from("events").select("id").eq("id", eventId)).data).toHaveLength(0);
    expect((await stranger.from("organizations").select("id").eq("id", orgId)).data).toHaveLength(0);
  });

  it("still hides both from anon", async () => {
    const { orgId, eventId } = await makeSuspendedOrgWithTicket("t-susp-anonstill");

    expect((await anon().from("events").select("id").eq("id", eventId)).data).toHaveLength(0);
    expect((await anon().from("organizations").select("id").eq("id", orgId)).data).toHaveLength(0);
  });
});

/**
 * Final whole-branch review finding: `delete_organization_tx`'s residual-race
 * comment claimed the race was unreachable because "the console only offers
 * delete on an org that has already been suspended". It does not — the Delete
 * menu item is unconditional — and even for an org that IS suspended,
 * `payment-session` had no `is_active` check at all. A registration created
 * before the suspension could still be handed a fresh PayMongo session, paid,
 * and settled by the webhook after the delete's guard had already run.
 *
 * `registrations-checkout` closes the front door (no NEW entries); this closes
 * the one behind it (no new CHARGE on an existing entry). Same code and status
 * as checkout's refusal, deliberately — apps/site/lib/errors.ts maps
 * `org_suspended` once and both paths land on it.
 */
describe("payment-session on a suspended org", () => {
  it("refuses to mint a checkout session for an entry created before the suspension", async () => {
    const { orgId, eventId } = await makeSuspendableOrg("t-susp-paysess");
    const db = svc();
    const { data: cat } = await db.from("categories")
      .insert({ org_id: orgId, event_id: eventId, code: "10k", label: "10K", base_price: 100000 })
      .select("id").single();

    const email = `t-susp-paysess-runner-${orgId}@racepace.test`;
    const { data: u } = await db.auth.admin.createUser({
      email, password: "password123", email_confirm: true,
    });
    trashUsers.push(u!.user!.id);

    // The entry exists and is payable BEFORE the org is switched off — that is
    // the whole scenario. Suspending afterwards must not leave it chargeable.
    const { data: reg } = await db.from("registrations").insert({
      org_id: orgId, event_id: eventId, category_id: cat!.id,
      user_id: u!.user!.id, status: "pending", total_amount: 100000,
    }).select("id").single();
    await db.from("payments").insert({
      org_id: orgId, registration_id: reg!.id, amount: 100000, status: "pending",
    });

    const runner = await signedIn(email);
    await db.from("organizations").update({ is_active: false }).eq("id", orgId);

    const { data, error } = await runner.functions.invoke("payment-session", {
      body: { registration_id: reg!.id, method: "gcash" },
    });

    const code = data?.error ?? await (error as { context?: Response })?.context
      ?.clone().json().then((b: { error?: string }) => b?.error).catch(() => undefined);
    expect(code).toBe("org_suspended");

    // Refused, not half-done: no checkout_url was written onto the payment row.
    const after = await db.from("payments").select("checkout_url").eq("registration_id", reg!.id).single();
    expect(after.data!.checkout_url).toBeNull();
  });
});
