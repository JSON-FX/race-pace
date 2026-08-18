import { describe, it, expect, afterEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
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

/** An org with an event, TWO categories, and a registration in each.
 *  Two categories is the point: one category cannot reproduce the ordering
 *  hazard this RPC exists to avoid. */
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

    // A plain `delete from organizations` fails here: registrations.category_id
    // is ON DELETE NO ACTION while both tables cascade from the org, so
    // Postgres may reach the categories before the registrations.
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

describe("a suspended organization", () => {
  const MUSPO = "00000000-0000-0000-0000-00000000a001";

  afterEach(async () => {
    await svc().from("organizations").update({ is_active: true }).eq("id", MUSPO);
  });

  it("is invisible to anon but still visible to its own admin and the super admin", async () => {
    await svc().from("organizations").update({ is_active: false }).eq("id", MUSPO);

    const asAnon = await anon().from("organizations").select("id").eq("id", MUSPO);
    expect(asAnon.data).toHaveLength(0);

    // The regression this guards: `orgs_read_active` used to be
    // `using (is_active = true)`, which hid a suspended org from the very page
    // a super admin would un-suspend it from, and broke the console for the
    // org's own staff.
    const asOrgAdmin = await (await signedIn("muspo@racepace.test"))
      .from("organizations").select("id").eq("id", MUSPO);
    expect(asOrgAdmin.data).toHaveLength(1);

    const asSuper = await (await signedIn("admin@racepace.test"))
      .from("organizations").select("id").eq("id", MUSPO);
    expect(asSuper.data).toHaveLength(1);
  });

  it("has its events removed from the storefront but not from its own console", async () => {
    const before = await anon().from("events").select("id").eq("org_id", MUSPO);
    expect(before.data!.length).toBeGreaterThan(0);

    await svc().from("organizations").update({ is_active: false }).eq("id", MUSPO);

    const asAnon = await anon().from("events").select("id").eq("org_id", MUSPO);
    expect(asAnon.data).toHaveLength(0);

    // events_read_org_admin is a separate permissive policy; policies are OR'd.
    const asOrgAdmin = await (await signedIn("muspo@racepace.test"))
      .from("events").select("id").eq("org_id", MUSPO);
    expect(asOrgAdmin.data!.length).toBeGreaterThan(0);
  });
});
