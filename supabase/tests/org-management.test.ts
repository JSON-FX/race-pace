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
  });

  it("raises org_not_found for an id that matches nothing", async () => {
    const { error } = await svc().rpc("delete_organization_tx", {
      p_org_id: "00000000-0000-0000-0000-0000000000ff",
    });
    expect(error?.message).toMatch(/org_not_found/);
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

/**
 * Fix round 2 (review finding): an earlier version of `delete_organization_tx`
 * locked `payments` before `registrations`, the opposite order from
 * `confirm_payment_tx` (which locks the registration row first, via its own
 * `for update`, and only touches `payments` afterward through a plain
 * `update`). Two sessions taking locks in opposite orders is a textbook
 * deadlock, and the reviewer reproduced one on the local DB between these two
 * functions. The fix makes `delete_organization_tx` lock registrations first
 * too, so the two functions can never deadlock against each other — whichever
 * one gets there first just makes the other wait.
 *
 * This is staged as a genuine two-connection race, not merely asserted by
 * reading the function bodies -- same pattern as
 * registration-gate.test.ts's `waitForLockWait`: two raw `pg` connections,
 * one polling `pg_stat_activity` for the other's lock-wait state so the
 * collision is forced deterministically rather than hoped for via a fixed
 * sleep. Connection A starts (but does not commit) a settle; connection B's
 * delete is dispatched once A is confirmed to hold the registration lock, and
 * is polled to confirm it actually blocks on that lock (not racing past it).
 * A then commits, B unblocks, and the assertion is that B raises
 * `org_has_payments` -- a clean refusal -- rather than a deadlock error
 * (40P01) or a hang.
 */
describe("delete_organization_tx / confirm_payment_tx lock ordering", () => {
  it("a settle that commits while a delete is waiting produces org_has_payments, not a deadlock", async () => {
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
      // A: settle the payment. confirm_payment_tx's first statement locks the
      // registration row `for update`; the transaction is left open
      // (uncommitted) afterward, so the lock is still held and the 'paid'
      // write is not yet visible to any other transaction's snapshot.
      await clientA.query("begin");
      const resA = await clientA.query<{ confirm_payment_tx: string }>(
        "select confirm_payment_tx($1,$2,$3,$4,$5,$6)",
        [regId, "gcash", 0, 100000, `tok_${regId}`, {}],
      );
      expect(resA.rows[0]!.confirm_payment_tx).toBe("paid");

      // B: delete_organization_tx also locks registrations first (matching
      // order, post-fix), so it blocks on the SAME row A is still holding.
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
});
