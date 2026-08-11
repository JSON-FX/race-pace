import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

/**
 * payout_open_statement, payout_mark_paid and payout_unreconciled_count all gate on
 * auth_is_super_admin(), which reads auth.uid(). The service role has no uid, so none
 * of them can be driven with the service key — and `opened_by` is NOT NULL referencing
 * auth.users, so a real session is required regardless. Signing in is not a workaround;
 * it is what makes these tests exercise the authorization path the console uses.
 */
async function signedInAs(email: string, password = "password123"): Promise<SupabaseClient> {
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

/** A fresh signed-in user carrying `role` on `orgId` — or no role at all when both are
 *  null, i.e. a plain runner. Returns the uid so the caller can delete it. */
async function staff(s: SupabaseClient, tag: string, role: string | null, orgId: string | null) {
  const email = `pv2_${tag}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@test.dev`;
  const uid = (await s.auth.admin.createUser({
    email, password: "password123", email_confirm: true,
  })).data.user!.id;
  if (role) {
    const r = await s.from("user_roles").insert({ user_id: uid, role, org_id: orgId });
    if (r.error) throw new Error(`grant ${role}: ${r.error.message}`);
  }
  return { uid, client: await signedInAs(email) };
}

/** The canonical ₱2,000 GCash entry under 2026-08-11 terms: the runner pays ₱2,000,
 *  Race Pace earns 3% = ₱60, PayMongo takes ₱30, the organizer is owed ₱1,910. */
const ENTRY = {
  amount: 200000,
  platform_fee: 6000,
  processor_fee_cents: 3000,
  processor_fee_source: "actual",
  net_to_org: 191000,
} as const;

/** Org + event + N paid ₱2,000 GCash entries, plus a super admin who can open and
 *  settle statements. Exception-safe: anything created before a mid-way failure is torn
 *  down here before rethrowing, since the caller's finally only runs once this returns. */
async function fixture(tag: string, count: number) {
  const s = svc();
  const stamp = `${tag}-${Date.now()}`;
  const cleanups: Array<() => Promise<unknown>> = [];
  try {
    const org = (await s.from("organizations").insert({
      name: "PayoutV2 Org", slug: stamp,
      commission_type: "percent", commission_rate: 0.03,
    }).select().single()).data!;
    cleanups.push(() => s.from("organizations").delete().eq("id", org.id));
    const ev = (await s.from("events").insert({
      org_id: org.id, name: "PayoutV2 Race", status: "draft",
    }).select().single()).data!;
    const cat = (await s.from("categories").insert({
      org_id: org.id, event_id: ev.id, code: "40k", label: "40K",
      base_price: 200000, slots_total: 100, slots_taken: count,
    }).select().single()).data!;

    const adminEmail = `pv2_${stamp}@test.dev`;
    const adminId = (await s.auth.admin.createUser({
      email: adminEmail, password: "password123", email_confirm: true,
    })).data.user!.id;
    cleanups.push(() => s.auth.admin.deleteUser(adminId));
    await s.from("user_roles").insert({ user_id: adminId, role: "super_admin", org_id: null });

    const users: string[] = [adminId];
    const regIds: string[] = [];

    /** One more paid registration + payment on this event, with the entry's money
     *  columns overridable so a test can pose a 'historical' or odd-shaped row. */
    async function addEntry(overrides: Record<string, unknown> = {}): Promise<string> {
      const i = regIds.length;
      const uid = (await s.auth.admin.createUser({
        email: `pv2_r${i}_${stamp}@test.dev`, password: "password123", email_confirm: true,
      })).data.user!.id;
      users.push(uid);
      cleanups.push(() => s.auth.admin.deleteUser(uid));
      const reg = (await s.from("registrations").insert({
        org_id: org.id, event_id: ev.id, category_id: cat.id,
        user_id: uid, total_amount: 200000, status: "paid",
      }).select().single()).data!;
      regIds.push(reg.id);
      const pay = await s.from("payments").insert({
        org_id: org.id, registration_id: reg.id, status: "paid", method: "gcash",
        ...ENTRY, ...overrides,
      });
      if (pay.error) throw new Error(`seed payment: ${pay.error.message}`);
      return reg.id;
    }

    for (let i = 0; i < count; i++) await addEntry();

    return {
      s, org, ev, regIds, adminEmail, addEntry,
      cleanup: async () => {
        // Org first: payout_statements, events, registrations and payments all cascade
        // off it, and auth.users cannot be deleted while a registration still points at it.
        await s.from("organizations").delete().eq("id", org.id);
        for (const id of users) await s.auth.admin.deleteUser(id);
      },
    };
  } catch (err) {
    for (const fn of cleanups.reverse()) await fn();
    throw err;
  }
}

/** Fails loudly. A silent null surfaces as "cannot read gross_cents of null" three lines
 *  later, which hides whatever the RPC actually said. */
async function openStatement(as: SupabaseClient, eventId: string): Promise<string> {
  const r = await as.rpc("payout_open_statement", { p_event_id: eventId });
  if (r.error) throw new Error(`payout_open_statement: ${r.error.message} (${r.error.code})`);
  return r.data as string;
}

async function stmt(s: SupabaseClient, id: string) {
  const r = await s.from("payout_statements")
    .select("gross_cents,commission_cents,processing_cents,refunds_in_period_cents,refunds_cents,net_owed_cents")
    .eq("id", id).single();
  if (r.error) throw new Error(`read statement ${id}: ${r.error.message}`);
  // bigint columns arrive as strings over PostgREST for values past 2^53; normalise so
  // toMatchObject compares numbers to numbers regardless of magnitude.
  return Object.fromEntries(
    Object.entries(r.data!).map(([k, v]) => [k, Number(v)]),
  ) as Record<string, number>;
}

describe("payout_open_statement v2", () => {
  it("sums net_to_org and breaks the total down into gross, commission and processing", async () => {
    const f = await fixture("pv2a", 3);
    try {
      const admin = await signedInAs(f.adminEmail);
      const st = await stmt(f.s, await openStatement(admin, f.ev.id));

      expect(st).toMatchObject({
        gross_cents: 600000,       // 3 x ₱2,000
        commission_cents: 18000,   // 3 x ₱60
        processing_cents: 9000,    // 3 x ₱30
        refunds_in_period_cents: 0,
        refunds_cents: 0,
        net_owed_cents: 573000,    // 3 x ₱1,910
      });
      // The breakdown must explain the total, not merely accompany it. Under the OLD
      // arithmetic this line read 600000 - 18000 - 0 = 582000, over-paying by the ₱90
      // PayMongo had already taken.
      expect(st.gross_cents - st.commission_cents - st.processing_cents - st.refunds_in_period_cents)
        .toBe(st.net_owed_cents);
    } finally {
      await f.cleanup();
    }
  });

  it("subtracts an already-settled entry's net_to_org when it is later refunded", async () => {
    const f = await fixture("pv2b", 2);
    try {
      const admin = await signedInAs(f.adminEmail);
      const first = await openStatement(admin, f.ev.id);
      const marked = await admin.rpc("payout_mark_paid", {
        p_statement_id: first, p_reference: "ref-1", p_note: null,
      });
      expect(marked.data).toBe("paid");

      // One of the two settled entries is refunded afterwards, through the real RPC.
      const refund = await f.s.rpc("refund_registration_tx", {
        p_registration_id: f.regIds[0], p_refunded_by: null, p_note: null,
        p_provider_refund: {}, p_refunded_amount: 191000, p_retained_net: 0,
      });
      expect(refund.error).toBeNull();
      expect(refund.data).toBe("refunded");

      const second = await stmt(f.s, await openStatement(admin, f.ev.id));

      // No new sales, one clawback: the organizer owes ₱1,910 back — exactly what the
      // runner received, and exactly what the first statement transferred for that row.
      expect(second.gross_cents).toBe(0);
      expect(second.refunds_cents).toBe(191000);
      expect(second.net_owed_cents).toBe(-191000);
      // A CLAWBACK, not an in-period refund. The two must never be conflated: this
      // money was transferred on the first statement and is being recovered on the
      // second, whereas refunds_in_period_cents nets a refund out of earnings that
      // have not been transferred at all. Counting it in both would double it.
      expect(second.refunds_in_period_cents).toBe(0);
    } finally {
      await f.cleanup();
    }
  });

  it("a partially refunded entry contributes its RETENTION, not its original charge", async () => {
    const f = await fixture("pv2d", 1);
    try {
      // ₱1,910 was the organizer's; they keep ₱300 and ₱1,610 goes back to the runner.
      const refund = await f.s.rpc("refund_registration_tx", {
        p_registration_id: f.regIds[0], p_refunded_by: null, p_note: null,
        p_provider_refund: {}, p_refunded_amount: 161000, p_retained_net: 30000,
      });
      expect(refund.error).toBeNull();
      expect(refund.data).toBe("partially_refunded");

      const admin = await signedInAs(f.adminEmail);
      const st = await stmt(f.s, await openStatement(admin, f.ev.id));

      // The whole point of summing net_to_org: the RPC already dropped it to the
      // retention, so the payout is right without the statement knowing a refund happened.
      // The old arithmetic paid 200000 - 6000 - 0 = 194000 here, ₱1,640 too much.
      expect(st.net_owed_cents).toBe(30000);
      expect(st.refunds_cents).toBe(0); // a clawback needs a PRIOR statement stamp

      // The presentational lines still describe the ORIGINAL charge — Task 7 deliberately
      // leaves amount/platform_fee/processor_fee_cents immutable on a partial refund.
      expect(st.gross_cents).toBe(200000);
      expect(st.commission_cents).toBe(6000);
      expect(st.processing_cents).toBe(3000);
      // The fourth line is what makes them add up: ₱1,610 went back to the runner out of
      // money this statement has not transferred yet. Without it the statement read
      // ₱2,000 - ₱60 - ₱30 beside a net owed of ₱300 and contradicted itself by ₱1,610 —
      // on the document an operator makes the bank transfer from.
      expect(st.refunds_in_period_cents).toBe(161000);
      expect(st.gross_cents - st.commission_cents - st.processing_cents - st.refunds_in_period_cents)
        .toBe(st.net_owed_cents);
    } finally {
      await f.cleanup();
    }
  });

  it("claws back a PARTIAL refund on an entry that was already settled", async () => {
    const f = await fixture("pv2i", 1);
    try {
      const admin = await signedInAs(f.adminEmail);

      // Statement A transfers the organizer's ₱1,910 and stamps the row.
      const first = await openStatement(admin, f.ev.id);
      expect((await stmt(f.s, first)).net_owed_cents).toBe(191000);
      expect((await admin.rpc("payout_mark_paid", {
        p_statement_id: first, p_reference: "ref-1", p_note: null,
      })).data).toBe("paid");

      // THEN the runner cancels under a flat_fee policy: ₱1,610 goes back to them out
      // of money the organizer has already been paid, and ₱300 is retained.
      const refund = await f.s.rpc("refund_registration_tx", {
        p_registration_id: f.regIds[0], p_refunded_by: null, p_note: null,
        p_provider_refund: {}, p_refunded_amount: 161000, p_retained_net: 30000,
      });
      expect(refund.error).toBeNull();
      expect(refund.data).toBe("partially_refunded");

      const secondId = await openStatement(admin, f.ev.id);
      const second = await stmt(f.s, secondId);

      // THE LEAK. The row matches neither of the old filters — the earn filter wants an
      // unstamped row and this one is stamped; the clawback filter wanted status
      // 'refunded' and this one is 'partially_refunded' — so this read 0 and Race Pace
      // ate the ₱1,610 it had already paid the runner.
      expect(second.gross_cents).toBe(0);
      expect(second.refunds_cents).toBe(161000);
      expect(second.net_owed_cents).toBe(-161000);
      // A CLAWBACK, not an in-period refund, exactly as on the full-refund path. The two
      // are disjoint by the stamp: refunds_in_period_cents only ever sums UNSTAMPED rows,
      // and this row carries statement A's stamp. Counting it in both would double it.
      expect(second.refunds_in_period_cents).toBe(0);

      // ONCE ONLY. Settling the recovery stamps payout_clawback_id, which is the same
      // gate the full-refund path uses, so a third statement finds nothing left.
      expect((await admin.rpc("payout_mark_paid", {
        p_statement_id: secondId, p_reference: "rec-1", p_note: null,
      })).data).toBe("paid");

      const third = await stmt(f.s, await openStatement(admin, f.ev.id));
      expect(third.refunds_cents).toBe(0);
      expect(third.net_owed_cents).toBe(0);
    } finally {
      await f.cleanup();
    }
  });

  it("does not clawback-stamp a partial refund it is settling for the FIRST time", async () => {
    const f = await fixture("pv2j", 1);
    try {
      const admin = await signedInAs(f.adminEmail);

      // Refunded BEFORE any statement, so the ₱1,610 is netted out of earnings that have
      // not been transferred — refunds_in_period, not a clawback.
      expect((await f.s.rpc("refund_registration_tx", {
        p_registration_id: f.regIds[0], p_refunded_by: null, p_note: null,
        p_provider_refund: {}, p_refunded_amount: 161000, p_retained_net: 30000,
      })).data).toBe("partially_refunded");

      const first = await openStatement(admin, f.ev.id);
      expect(await stmt(f.s, first)).toMatchObject({
        net_owed_cents: 30000, refunds_in_period_cents: 161000, refunds_cents: 0,
      });
      expect((await admin.rpc("payout_mark_paid", {
        p_statement_id: first, p_reference: "ref-1", p_note: null,
      })).data).toBe("paid");

      // THE ORDERING HAZARD. payout_mark_paid's earn UPDATE stamps this row first; the
      // clawback UPDATE runs next and now sees a stamped 'partially_refunded' row. If it
      // claimed that row too, the refund would be marked "recovered" when it was only
      // netted — and the clawback stamp, once set, can never be set again, so a LATER
      // refund on the same row would be silently unrecoverable forever.
      const p = (await f.s.from("payments")
        .select("payout_statement_id,payout_clawback_id")
        .eq("registration_id", f.regIds[0]).single()).data!;
      expect(p.payout_statement_id).toBe(first);
      expect(p.payout_clawback_id).toBeNull();

      // Prove the consequence, not just the column: a SECOND partial refund on the now
      // settled row — ₱200 more back, ₱100 retained — must still be recoverable.
      expect((await f.s.rpc("refund_registration_tx", {
        p_registration_id: f.regIds[0], p_refunded_by: null, p_note: null,
        p_provider_refund: {}, p_refunded_amount: 20000, p_retained_net: 10000,
      })).data).toBe("partially_refunded");

      const second = await stmt(f.s, await openStatement(admin, f.ev.id));
      // refunded_amount is the delta since settlement, which is what makes it the right
      // size here: the organizer was paid ₱300 on statement A and keeps ₱100.
      expect(second.refunds_cents).toBe(20000);
      expect(second.net_owed_cents).toBe(-20000);
    } finally {
      await f.cleanup();
    }
  });

  it("excludes a 'historical' row's processor fee from processing, but pays its full net_to_org", async () => {
    const f = await fixture("pv2e", 0);
    try {
      // Pre-2026-08-11 terms: PayMongo really took ₱30, but the PLATFORM absorbed it, so
      // net_to_org is amount - platform_fee with no processor deduction. Charging it to
      // the organizer here would bill them for a cost they never bore.
      await f.addEntry({
        processor_fee_source: "historical", processor_fee_cents: 3000, net_to_org: 194000,
      });

      const admin = await signedInAs(f.adminEmail);
      const st = await stmt(f.s, await openStatement(admin, f.ev.id));

      expect(st.gross_cents).toBe(200000);
      expect(st.commission_cents).toBe(6000);
      expect(st.processing_cents).toBe(0);       // absorbed by Race Pace, not shown as a cost
      expect(st.net_owed_cents).toBe(194000);    // the stored net_to_org, undisturbed
      // The filter keeps the breakdown honest rather than breaking it: 0 processing is
      // exactly what makes the identity hold for a row whose net_to_org never lost a fee.
      expect(st.gross_cents - st.commission_cents - st.processing_cents - st.refunds_in_period_cents)
        .toBe(st.net_owed_cents);
    } finally {
      await f.cleanup();
    }
  });
});

describe("payout_unreconciled_count", () => {
  it("counts payments whose processing fee is still an estimate", async () => {
    const f = await fixture("pv2c", 2);
    try {
      await f.s.from("payments").update({ processor_fee_source: "predicted" })
        .eq("registration_id", f.regIds[0]);
      const admin = await signedInAs(f.adminEmail);
      const { data, error } = await admin.rpc("payout_unreconciled_count", { p_event_id: f.ev.id });
      expect(error).toBeNull();
      expect(data).toBe(1);
    } finally {
      await f.cleanup();
    }
  });

  it("stops counting a row once its statement has been settled", async () => {
    const f = await fixture("pv2f", 1);
    try {
      await f.s.from("payments").update({ processor_fee_source: "predicted" })
        .eq("registration_id", f.regIds[0]);
      const admin = await signedInAs(f.adminEmail);
      expect((await admin.rpc("payout_unreconciled_count", { p_event_id: f.ev.id })).data).toBe(1);

      const id = await openStatement(admin, f.ev.id);
      await admin.rpc("payout_mark_paid", { p_statement_id: id, p_reference: "ref", p_note: null });

      // The warning is about money NOT yet transferred. Once it is out the door the
      // estimate is water under the bridge — Task 10's drift view is what looks back.
      expect((await admin.rpc("payout_unreconciled_count", { p_event_id: f.ev.id })).data).toBe(0);
    } finally {
      await f.cleanup();
    }
  });

  it("lets an editor or admin of the event's OWN org read the count", async () => {
    const f = await fixture("pv2h", 1);
    const extra: string[] = [];
    try {
      await f.s.from("payments").update({ processor_fee_source: "predicted" })
        .eq("registration_id", f.regIds[0]);

      // Both halves of manage_org. This RPC is deliberately WIDER than its two payout
      // siblings: the organizer-facing per-event settlement page reads this count and is
      // gated on manage_org, not on super admin. Super-admin-only would leave that banner
      // silently unrendered for everyone it is for — its caller destructures `{ data }`
      // and coerces with `?? 0`, so a 42501 never surfaces.
      for (const role of ["admin", "editor"]) {
        const u = await staff(f.s, `own_${role}`, role, f.org.id);
        extra.push(u.uid);
        const r = await u.client.rpc("payout_unreconciled_count", { p_event_id: f.ev.id });
        expect(r.error, `${role} of the event's own org was refused`).toBeNull();
        expect(r.data).toBe(1);
      }
    } finally {
      for (const uid of extra) await f.s.auth.admin.deleteUser(uid);
      await f.cleanup();
    }
  });

  it("refuses an admin of an UNRELATED org, and a signed-in runner with no role", async () => {
    const f = await fixture("pv2g", 1);
    const extra: string[] = [];
    let otherOrg: string | undefined;
    try {
      // Same capability, wrong org — the case that separates "manage_org" from
      // "manage_org ON THIS EVENT'S ORG". The function is security definer, so nothing
      // scopes it but the gate: an invoker version would have leaked a truncated count
      // here instead of refusing, which reads identically to "nothing to warn about".
      const org = (await f.s.from("organizations").insert({
        name: "PayoutV2 Unrelated Org", slug: `pv2-other-${Date.now()}`,
      }).select().single()).data!;
      otherOrg = org.id;
      const outsider = await staff(f.s, "otherorg", "admin", org.id);
      extra.push(outsider.uid);
      const r1 = await outsider.client.rpc("payout_unreconciled_count", { p_event_id: f.ev.id });
      expect(r1.error).toBeTruthy();
      expect(r1.error!.code).toBe("42501");

      // Signed in, no role anywhere — the same set payments_read_org_admin refuses SELECT
      // to on the rows this counts. The two rules agree by construction: the gate calls
      // auth_can_admin_org rather than restating it.
      const runner = await staff(f.s, "runner", null, null);
      extra.push(runner.uid);
      const r2 = await runner.client.rpc("payout_unreconciled_count", { p_event_id: f.ev.id });
      expect(r2.error).toBeTruthy();
      expect(r2.error!.code).toBe("42501");
    } finally {
      for (const uid of extra) await f.s.auth.admin.deleteUser(uid);
      if (otherOrg) await f.s.from("organizations").delete().eq("id", otherOrg);
      await f.cleanup();
    }
  });
});
