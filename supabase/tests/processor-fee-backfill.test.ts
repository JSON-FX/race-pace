import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

/** One PayMongo payment object, the shape `payments[]` carries. */
const pmPayment = (status: string, amount: number, fee: number | string | null) => ({
  id: `pay_${status}`,
  attributes: {
    status,
    amount,
    fee,
    net_amount: typeof fee === "number" ? amount - fee : amount,
    source: { type: "gcash" },
  },
});

/** The checkout-session attributes object. */
const sessionAttrs = (payments: unknown[]) => ({ checkout_url: "https://x", payments });

/**
 * The four shapes that have ever reached payments.raw, plus the bare attributes
 * object. Only `bare` is what the task brief described; the two WRAPPERS are what
 * production actually holds, because _shared/confirm.ts is never handed a bare
 * PayMongo body — payment-verify wraps it as {source, session_id, session} and
 * payments-webhook as {source, event}, and confirm_payment_tx stores that wrapper
 * verbatim. A backfill that only read raw->'data'->'attributes' would match zero
 * real rows and report success, which is why each of these is asserted.
 */
const RAW_SHAPES = {
  verify: (payments: unknown[]) => ({
    source: "payment-verify",
    session_id: "cs_1",
    session: { data: { id: "cs_1", attributes: sessionAttrs(payments) } },
  }),
  webhook: (payments: unknown[]) => ({
    source: "webhook",
    event: {
      data: {
        attributes: {
          type: "checkout_session.payment.paid",
          data: { id: "cs_1", attributes: sessionAttrs(payments) },
        },
      },
    },
  }),
  bare: (payments: unknown[]) => ({ data: { attributes: sessionAttrs(payments) } }),
  resource: (payments: unknown[]) => ({ attributes: sessionAttrs(payments) }),
  attributes: (payments: unknown[]) => sessionAttrs(payments),
};

type PaymentCols = Record<string, unknown>;

/** Org + event + category + runner + paid registration + ONE payment row. */
async function entry(tag: string, opts: {
  payment: PaymentCols;
  org?: PaymentCols;
  amount?: number;
} = { payment: {} }) {
  const s = svc();
  const stamp = `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const total = opts.amount ?? 200000;
  const cleanups: Array<() => Promise<unknown>> = [];
  try {
    const org = (await s.from("organizations").insert({
      name: "Backfill Org", slug: stamp,
      commission_type: "percent", commission_rate: 0.10,
      ...(opts.org ?? {}),
    }).select().single()).data!;
    cleanups.push(() => s.from("organizations").delete().eq("id", org.id));
    const ev = (await s.from("events").insert({
      org_id: org.id, name: "Backfill Race", status: "draft",
    }).select().single()).data!;
    const cat = (await s.from("categories").insert({
      org_id: org.id, event_id: ev.id, code: "40k", label: "40K",
      base_price: total, slots_total: 10, slots_taken: 1,
    }).select().single()).data!;
    const uid = (await s.auth.admin.createUser({
      email: `${stamp}@test.dev`, password: "password123", email_confirm: true,
    })).data.user!.id;
    cleanups.push(() => s.auth.admin.deleteUser(uid));
    const reg = (await s.from("registrations").insert({
      org_id: org.id, event_id: ev.id, category_id: cat.id,
      user_id: uid, total_amount: total, status: "paid",
    }).select().single()).data!;
    const ins = await s.from("payments").insert({
      org_id: org.id, registration_id: reg.id, amount: total,
      status: "paid", method: "gcash",
      ...opts.payment,
    });
    if (ins.error) throw new Error(`seed payment: ${ins.error.message}`);

    return {
      s, org, ev, reg, uid,
      read: async (cols = "processor_fee_cents,processor_fee_source,net_to_org,platform_fee,amount,refunded_amount,status") =>
        (await s.from("payments").select(cols).eq("registration_id", reg.id).single()).data! as PaymentCols,
      cleanup: async () => {
        // Org first — events/registrations/payments/payout_statements all cascade
        // off it, and an auth user cannot be deleted while a registration points at it.
        for (const fn of cleanups) await fn();
      },
    };
  } catch (err) {
    for (const fn of cleanups.reverse()) await fn();
    throw err;
  }
}

async function backfill(s: SupabaseClient): Promise<number> {
  const r = await s.rpc("backfill_processor_fees_once");
  if (r.error) throw new Error(`backfill_processor_fees_once: ${r.error.message} (${r.error.code})`);
  return r.data as number;
}

describe("processor fee backfill", () => {
  it("recovers the fee from raw and marks it historical WITHOUT repricing net_to_org", async () => {
    const f = await entry("bf", {
      payment: {
        // A pre-migration row: 10% commission, platform absorbed the ₱30 processing.
        platform_fee: 20000, net_to_org: 180000,
        processor_fee_cents: 0, processor_fee_source: "none",
        raw: RAW_SHAPES.bare([pmPayment("paid", 200000, 3000)]),
      },
    });
    try {
      await backfill(f.s);
      const pay = await f.read();

      expect(pay.processor_fee_cents).toBe(3000);
      expect(pay.processor_fee_source).toBe("historical");
      // THE POINT OF THE TEST: settled money is not repriced.
      expect(pay.net_to_org).toBe(180000);
      expect(pay.platform_fee).toBe(20000);
      expect(pay.amount).toBe(200000);
      // A historical row deliberately violates the ledger invariant, and that
      // violation IS the record that the platform paid for processing here.
      expect(
        (pay.amount as number) - (pay.processor_fee_cents as number) - (pay.platform_fee as number),
      ).not.toBe(pay.net_to_org);
    } finally {
      await f.cleanup();
    }
  });

  it("leaves a row with no recoverable fee as 'none'", async () => {
    const f = await entry("bfn", {
      amount: 100000,
      payment: { platform_fee: 10000, net_to_org: 90000, raw: { fake: true } },
    });
    try {
      await backfill(f.s);
      expect(await f.read("processor_fee_cents,processor_fee_source"))
        .toMatchObject({ processor_fee_cents: 0, processor_fee_source: "none" });
    } finally {
      await f.cleanup();
    }
  });

  /**
   * The shape that actually reached production. Reading only the bare
   * data->attributes path would leave every real historical payment at 'none'
   * while the migration reported success — a silent no-op, not a loud failure.
   */
  it.each([
    ["payment-verify wrapper", RAW_SHAPES.verify],
    ["payments-webhook wrapper", RAW_SHAPES.webhook],
    ["bare PayMongo body", RAW_SHAPES.bare],
    ["bare resource", RAW_SHAPES.resource],
    ["an attributes object already", RAW_SHAPES.attributes],
  ])("finds the fee inside the %s", async (tag, shape) => {
    // The tag becomes an org slug and an email local-part, so strip the spaces.
    const f = await entry(`bfw${tag.replace(/[^a-z0-9]/gi, "").slice(0, 8)}`, {
      payment: {
        platform_fee: 20000, net_to_org: 180000,
        raw: shape([pmPayment("paid", 200000, 3000)]),
      },
    });
    try {
      await backfill(f.s);
      expect(await f.read("processor_fee_cents,processor_fee_source"))
        .toMatchObject({ processor_fee_cents: 3000, processor_fee_source: "historical" });
    } finally {
      await f.cleanup();
    }
  });

  /**
   * Mirrors _shared/paymongo.ts#pmFeeFromAttributes: take the PAID element. A
   * session can carry an abandoned attempt followed by a successful one, and
   * element 0 would report the fee on the attempt the runner did NOT complete.
   */
  it("picks the captured payment, not an earlier abandoned attempt", async () => {
    const f = await entry("bfp", {
      payment: {
        platform_fee: 20000, net_to_org: 180000,
        raw: RAW_SHAPES.verify([
          pmPayment("failed", 200000, 0),
          pmPayment("paid", 200000, 3000),
        ]),
      },
    });
    try {
      await backfill(f.s);
      expect(await f.read("processor_fee_cents,processor_fee_source"))
        .toMatchObject({ processor_fee_cents: 3000, processor_fee_source: "historical" });
    } finally {
      await f.cleanup();
    }
  });

  /**
   * Unlike pmFeeFromAttributes, the backfill never falls back to payments[0].
   * A failed attempt's typed zeros are a perfectly plausible {fee: 0}, and
   * recording one as a real fee would claim the processor charged nothing on a
   * session where nothing was ever captured.
   */
  it("refuses a session with no captured payment", async () => {
    const f = await entry("bff", {
      payment: {
        platform_fee: 20000, net_to_org: 180000,
        raw: RAW_SHAPES.verify([pmPayment("failed", 200000, 0)]),
      },
    });
    try {
      await backfill(f.s);
      expect(await f.read("processor_fee_cents,processor_fee_source"))
        .toMatchObject({ processor_fee_cents: 0, processor_fee_source: "none" });
    } finally {
      await f.cleanup();
    }
  });

  it.each([
    ["a non-numeric fee", "3,000"],
    ["a decimal fee", 30.5],
    ["a JSON null fee", null],
  ])("leaves %s unrecovered rather than fabricating one", async (_tag, fee) => {
    const f = await entry("bfg", {
      payment: {
        platform_fee: 20000, net_to_org: 180000,
        raw: RAW_SHAPES.verify([pmPayment("paid", 200000, fee as number | string | null)]),
      },
    });
    try {
      await backfill(f.s);
      expect(await f.read("processor_fee_cents,processor_fee_source"))
        .toMatchObject({ processor_fee_cents: 0, processor_fee_source: "none" });
    } finally {
      await f.cleanup();
    }
  });

  it("is idempotent — a second run changes nothing and reports zero rows", async () => {
    const f = await entry("bfi", {
      payment: {
        platform_fee: 20000, net_to_org: 180000,
        raw: RAW_SHAPES.webhook([pmPayment("paid", 200000, 3000)]),
      },
    });
    try {
      const first = await backfill(f.s);
      expect(first).toBeGreaterThan(0);
      const after = await f.read();
      expect(after).toMatchObject({ processor_fee_cents: 3000, processor_fee_source: "historical" });

      // Every row the UPDATE touches leaves processor_fee_source = 'historical',
      // and the candidate set is processor_fee_source = 'none' — so an updated
      // row can never be a candidate again. Rows that were skipped are skipped by
      // a predicate over immutable stored data, so they are skipped identically.
      const second = await backfill(f.s);
      expect(second).toBe(0);
      expect(await f.read()).toEqual(after);
    } finally {
      await f.cleanup();
    }
  });
});

/**
 * (A) THE TABLE-WIDE INVARIANT.
 *
 * payout_open_statement's processing sum filters on
 * `processor_fee_source in ('actual','predicted')`, so a non-zero fee left tagged
 * 'none' is silently dropped from the statement's processing line — a real cost
 * that appears nowhere, with nothing to flag it. The backfill writes both columns
 * in one UPDATE precisely so the pair can never come apart, and _shared/confirm.ts
 * only leaves 'none' when the fee is 0. This asserts that across every row in the
 * table, not just the ones this file created.
 */
describe("no payment carries a fee with no source", () => {
  it("has no row with processor_fee_cents <> 0 and processor_fee_source = 'none'", async () => {
    const s = svc();
    await backfill(s);
    const { data, error } = await s.from("payments")
      .select("id,registration_id,processor_fee_cents,processor_fee_source")
      .eq("processor_fee_source", "none")
      .neq("processor_fee_cents", 0);
    expect(error).toBeNull();
    expect(data, `orphaned fees: ${JSON.stringify(data)}`).toEqual([]);
  });
});

/**
 * (B) LEGACY PARTIAL REFUNDS — a live over-recovery hazard this backfill
 * deliberately does NOT correct.
 *
 * The pre-2026-08-11 partial branch (20260807090400, carried by 20260808140000 /
 * 20260808150000) wrote refunded_amount off the GROSS `amount`, rewrote `amount`
 * down to the retention, re-struck platform_fee on it, and stashed the original in
 * raw.original_amount. 20260811095700's clawback sizes recovery from
 * refunded_amount unconditionally, because under the NEW rule
 * refund_registration_tx enforces refunded_amount = net_before - net_after. A
 * legacy row does not satisfy that identity, so a legacy row carrying a
 * payout_statement_id claws a GROSS-scale figure back against a NET-scale payment.
 *
 * THE DECISION, recorded here rather than in prose: leave them alone. The
 * corrective needs platform_fee_before — the commission frozen at capture — and
 * the legacy branch OVERWROTE that column with the re-struck retention fee. It is
 * not derivable from raw.original_amount plus the stored columns; every route to
 * it (current organizations.commission_*, inverting platform_fee/amount) assumes
 * terms that the row no longer carries. The migration therefore REFUSES TO DEPLOY
 * while a hazardous row exists rather than guessing at a money figure.
 *
 * The second test below asserts the CURRENT, hazardous number on purpose. If
 * someone later corrects these rows, it fails — which is the point: the fix
 * should be deliberate, not a side effect.
 */
describe("legacy partially_refunded rows", () => {
  /** Exactly what the old branch left behind on a ₱2,000 entry with a ₱300 retention. */
  const LEGACY = {
    status: "partially_refunded",
    amount: 30000,           // rewritten DOWN from 200000 to the retention
    platform_fee: 3000,      // RE-STRUCK: computeFee(30000, 10%) — the ₱200 original is gone
    net_to_org: 27000,       // retained - retainedFee
    refunded_amount: 170000, // GROSS scale: 200000 - 30000
  } as const;
  const ORIGINAL_AMOUNT = 200000;
  const PLATFORM_FEE_BEFORE = 20000; // knowable only because this fixture built it
  const NET_BEFORE = ORIGINAL_AMOUNT - PLATFORM_FEE_BEFORE; // 180000; processing was absorbed
  const TRUE_OWED_BACK = NET_BEFORE - LEGACY.net_to_org;    // 153000

  const legacyRaw = (payments: unknown[]) => ({
    ...RAW_SHAPES.verify(payments),
    refunded_at: "2026-08-09T00:00:00.000Z",
    partial: true,
    // The old branch's stash, and the only marker that distinguishes these rows.
    // 20260811094000 stopped writing it, so nothing since produces this key.
    original_amount: ORIGINAL_AMOUNT,
  });

  it("leaves the money columns alone and recovers only the processor fee", async () => {
    const f = await entry("bfl", {
      payment: { ...LEGACY, raw: legacyRaw([pmPayment("paid", ORIGINAL_AMOUNT, 3000)]) },
    });
    try {
      const before = await f.read();
      await backfill(f.s);
      const after = await f.read();

      // The two columns the backfill is allowed to write.
      expect(after.processor_fee_cents).toBe(3000);
      expect(after.processor_fee_source).toBe("historical");
      // Everything else is byte-identical. No repricing, no "helpful" repair.
      expect({ ...after, processor_fee_cents: 0, processor_fee_source: "none" })
        .toEqual({ ...before, processor_fee_cents: 0, processor_fee_source: "none" });
      expect(after.amount).toBe(LEGACY.amount);
      expect(after.platform_fee).toBe(LEGACY.platform_fee);
      expect(after.net_to_org).toBe(LEGACY.net_to_org);
      expect(after.refunded_amount).toBe(LEGACY.refunded_amount);

      // WHY it is not corrected: the row does not carry platform_fee_before.
      // raw.original_amount gives the gross; platform_fee holds the RE-STRUCK
      // retention fee, not the commission that was frozen at capture. Without it
      // net_before is not computable, and a guessed net_before is a guessed debt.
      expect(after.platform_fee).not.toBe(PLATFORM_FEE_BEFORE);
      const rawCols = (await f.s.from("payments").select("raw").eq("registration_id", f.reg.id).single()).data!;
      expect(Object.keys(rawCols.raw as object)).not.toContain("platform_fee_before");
      expect((rawCols.raw as Record<string, unknown>).original_amount).toBe(ORIGINAL_AMOUNT);
    } finally {
      await f.cleanup();
    }
  });

  /**
   * The hazard itself, end to end: settle the entry, then pose the legacy shape on
   * it, then open the next statement and read what it would recover.
   */
  it("would be over-recovered by the payout clawback — quantified", async () => {
    const s = svc();
    const stamp = `bfh-${Date.now()}`;
    const f = await entry("bfh", {
      payment: {
        platform_fee: PLATFORM_FEE_BEFORE, net_to_org: NET_BEFORE,
        raw: RAW_SHAPES.verify([pmPayment("paid", ORIGINAL_AMOUNT, 3000)]),
      },
      org: { refund_policy: "flat_fee", refund_fee_cents: 30000 },
    });
    let adminId: string | null = null;
    try {
      const adminEmail = `${stamp}@test.dev`;
      adminId = (await s.auth.admin.createUser({
        email: adminEmail, password: "password123", email_confirm: true,
      })).data.user!.id;
      await s.from("user_roles").insert({ user_id: adminId, role: "super_admin", org_id: null });
      const admin = createClient(url, anonKey, { auth: { persistSession: false } });
      const signIn = await admin.auth.signInWithPassword({ email: adminEmail, password: "password123" });
      if (signIn.error) throw new Error(`sign-in: ${signIn.error.message}`);

      // 1) Settle it. The organizer is transferred NET_BEFORE and the row is stamped.
      const a = await admin.rpc("payout_open_statement", { p_event_id: f.ev.id });
      if (a.error) throw new Error(`open A: ${a.error.message} (${a.error.code})`);
      const stmtA = (await s.from("payout_statements").select("net_owed_cents").eq("id", a.data).single()).data!;
      expect(stmtA.net_owed_cents).toBe(NET_BEFORE);
      const mark = await admin.rpc("payout_mark_paid", { p_statement_id: a.data, p_reference: "ref", p_note: null });
      if (mark.error) throw new Error(`mark paid: ${mark.error.message}`);
      expect(mark.data).toBe("paid");

      // 2) Pose the legacy partial refund. The old function no longer exists —
      //    20260811094000 replaced it — so this writes the row it used to write.
      const up = await s.from("payments")
        .update({ ...LEGACY, raw: legacyRaw([pmPayment("paid", ORIGINAL_AMOUNT, 3000)]) })
        .eq("registration_id", f.reg.id);
      expect(up.error).toBeNull();

      await backfill(s);

      // 3) The next statement. The row is stamped and un-clawed, so the clawback
      //    term picks it up and sizes recovery from refunded_amount.
      const b = await admin.rpc("payout_open_statement", { p_event_id: f.ev.id });
      if (b.error) throw new Error(`open B: ${b.error.message} (${b.error.code})`);
      const stmtB = (await s.from("payout_statements")
        .select("gross_cents,commission_cents,processing_cents,refunds_cents,net_owed_cents")
        .eq("id", b.data).single()).data!;

      // What it WOULD recover: the gross-scale figure the legacy branch stored.
      expect(stmtB.refunds_cents).toBe(LEGACY.refunded_amount); // 170000
      expect(stmtB.net_owed_cents).toBe(-LEGACY.refunded_amount);
      // What it SHOULD recover: what the organizer was paid, less what they keep.
      expect(TRUE_OWED_BACK).toBe(153000);
      // The gap is the platform's commission on the refunded portion — 10% here.
      // Billed to an organizer who never received it. This is the unsafe direction,
      // and it is why the migration REFUSES to deploy while such a row exists.
      expect(LEGACY.refunded_amount - TRUE_OWED_BACK).toBe(17000);
      expect(stmtB.refunds_cents).toBeGreaterThan(TRUE_OWED_BACK);

      // The processing line stays 0: 'historical' is excluded from it by design,
      // so the recovered fee never appears as a cost the organizer bore.
      expect(stmtB.processing_cents).toBe(0);
    } finally {
      await f.cleanup();
      if (adminId) await s.auth.admin.deleteUser(adminId);
    }
  });
});
