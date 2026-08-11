import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";
import { reportedProcessorFee } from "../functions/_shared/confirm.ts";

const { url, anonKey, serviceKey } = loadEnv();
const svc = () => createClient(url, serviceKey, { auth: { persistSession: false } });

describe("processor fee columns", () => {
  it("defaults a new payment to zero fee from an unknown source", async () => {
    const s = svc();
    const stamp = `pfc-${Date.now()}`;
    const org = (await s.from("organizations").insert({
      name: "Fee Col Org", slug: stamp,
      commission_type: "percent", commission_rate: 0.03,
    }).select().single()).data!;
    try {
      const ev = (await s.from("events").insert({
        org_id: org.id, name: "Fee Col Race", status: "draft",
      }).select().single()).data!;
      const cat = (await s.from("categories").insert({
        org_id: org.id, event_id: ev.id, code: "10k", label: "10K",
        base_price: 200000, slots_total: 10, slots_taken: 0,
      }).select().single()).data!;
      const user = (await s.auth.admin.createUser({
        email: `${stamp}@test.dev`, password: "password123", email_confirm: true,
      })).data.user!;
      const reg = (await s.from("registrations").insert({
        org_id: org.id, event_id: ev.id, category_id: cat.id,
        user_id: user.id, total_amount: 200000, status: "pending",
      }).select().single()).data!;
      const pay = (await s.from("payments").insert({
        org_id: org.id, registration_id: reg.id, amount: 200000,
      }).select("processor_fee_cents,processor_fee_predicted_cents,processor_fee_source").single()).data!;

      expect(pay.processor_fee_cents).toBe(0);
      expect(pay.processor_fee_predicted_cents).toBeNull();
      expect(pay.processor_fee_source).toBe("none");

      await s.auth.admin.deleteUser(user.id);
    } finally {
      await s.from("organizations").delete().eq("id", org.id);
    }
  });

  it("defaults an organization to absorb mode", async () => {
    const s = svc();
    const stamp = `fm-${Date.now()}`;
    const org = (await s.from("organizations").insert({ name: "Mode Org", slug: stamp })
      .select("fee_mode").single()).data!;
    expect(org.fee_mode).toBe("absorb");
    await s.from("organizations").delete().eq("slug", stamp);
  });

  it("rejects an unknown fee mode", async () => {
    const s = svc();
    const stamp = `fmx-${Date.now()}`;
    const res = await s.from("organizations").insert({
      name: "Bad Mode Org", slug: stamp, fee_mode: "invoice_later",
    });
    expect(res.error).not.toBeNull();
  });

  it("rejects a negative processor fee", async () => {
    const s = svc();
    const stamp = `neg-${Date.now()}`;
    const org = (await s.from("organizations").insert({ name: "Neg Org", slug: stamp })
      .select().single()).data!;
    try {
      const ev = (await s.from("events").insert({
        org_id: org.id, name: "Neg Race", status: "draft",
      }).select().single()).data!;
      const cat = (await s.from("categories").insert({
        org_id: org.id, event_id: ev.id, code: "5k", label: "5K",
        base_price: 100000, slots_total: 10, slots_taken: 0,
      }).select().single()).data!;
      const user = (await s.auth.admin.createUser({
        email: `${stamp}@test.dev`, password: "password123", email_confirm: true,
      })).data.user!;
      const reg = (await s.from("registrations").insert({
        org_id: org.id, event_id: ev.id, category_id: cat.id,
        user_id: user.id, total_amount: 100000, status: "pending",
      }).select().single()).data!;
      const res = await s.from("payments").insert({
        org_id: org.id, registration_id: reg.id, amount: 100000, processor_fee_cents: -1,
      });
      expect(res.error).not.toBeNull();
      await s.auth.admin.deleteUser(user.id);
    } finally {
      await s.from("organizations").delete().eq("id", org.id);
    }
  });
});

/**
 * The fee only reaches the ledger if it can be found in the payload the callers
 * actually build. Neither caller hands confirmPayment a bare PayMongo object:
 * payment-verify wraps it as {source, session_id, session}, payments-webhook as
 * {source, event}. A reader that only understands the bare shapes silently finds
 * nothing, records every payment as 'predicted', and the whole point of reading
 * the ACTUAL fee is lost — invisibly, because 'predicted' is a legitimate value.
 */
describe("reportedProcessorFee — what the provider actually reported", () => {
  const paidPayment = {
    id: "pay_1",
    attributes: {
      status: "paid", amount: 200000, fee: 3000, net_amount: 197000,
      source: { type: "gcash" },
    },
  };
  const sessionAttrs = (payments: unknown[]) => ({ checkout_url: "x", payments });
  /** payment-verify: confirmPayment(rid, method, {source, session_id, session}). */
  const verifyRaw = (payments: unknown[]) => ({
    source: "payment-verify",
    session_id: "cs_1",
    session: { data: { id: "cs_1", attributes: sessionAttrs(payments) } },
  });
  /** payments-webhook: confirmPayment(rid, method, {source, event}). */
  const webhookRaw = (payments: unknown[]) => ({
    source: "webhook",
    event: {
      data: {
        attributes: {
          type: "checkout_session.payment.paid",
          data: { id: "cs_1", attributes: sessionAttrs(payments) },
        },
      },
    },
  });

  it("reads the fee out of the payment-verify wrapper", () => {
    expect(reportedProcessorFee(verifyRaw([paidPayment])))
      .toEqual({ fee: 3000, netAmount: 197000, amount: 200000 });
  });

  it("reads the fee out of the payments-webhook wrapper", () => {
    expect(reportedProcessorFee(webhookRaw([paidPayment])))
      .toEqual({ fee: 3000, netAmount: 197000, amount: 200000 });
  });

  it("still reads a bare PayMongo body and a bare attributes object", () => {
    expect(reportedProcessorFee({ data: { attributes: sessionAttrs([paidPayment]) } }))
      .toEqual({ fee: 3000, netAmount: 197000, amount: 200000 });
    expect(reportedProcessorFee(sessionAttrs([paidPayment])))
      .toEqual({ fee: 3000, netAmount: 197000, amount: 200000 });
  });

  it("returns null when the payload carries no payment data at all", () => {
    expect(reportedProcessorFee({ source: "fake-checkout" })).toBeNull();
    expect(reportedProcessorFee({})).toBeNull();
    expect(reportedProcessorFee(null)).toBeNull();
  });

  /**
   * The (A) guard. pmFeeFromAttributes falls back to payments[0] when nothing in
   * the session is paid, so a FAILED attempt carrying typed zeros yields a
   * perfectly plausible {fee: 0, ...} that even passes the amount-fee=net
   * integrity check. Recorded as 'actual' that overpays the organizer by exactly
   * the processor's cut, on a session where nothing was ever captured.
   */
  it("refuses a failed-only session, even though its figures look well-formed", () => {
    const failed = {
      id: "pay_f",
      attributes: { status: "failed", amount: 200000, fee: 0, net_amount: 200000 },
    };
    expect(reportedProcessorFee(verifyRaw([failed]))).toBeNull();
    expect(reportedProcessorFee(webhookRaw([failed]))).toBeNull();
  });

  it("picks the captured payment, not an earlier abandoned attempt", () => {
    const failed = {
      id: "pay_f",
      attributes: { status: "failed", amount: 200000, fee: 0, net_amount: 200000 },
    };
    expect(reportedProcessorFee(verifyRaw([failed, paidPayment])))
      .toEqual({ fee: 3000, netAmount: 197000, amount: 200000 });
  });
});

describe("confirm_payment_tx with a processor fee", () => {
  /** Fresh org + event + category + pending registration + payment row. */
  async function fixture(tag: string, feeMode = "absorb") {
    const s = svc();
    const stamp = `${tag}-${Date.now()}`;
    const org = (await s.from("organizations").insert({
      name: "Confirm Org", slug: stamp, fee_mode: feeMode,
      commission_type: "percent", commission_rate: 0.03,
    }).select().single()).data!;
    // 'open', not the brief's 'published' — the event_status enum is
    // (draft, open, almost_full, closed, completed, cancelled) and there has
    // never been a 'published' member.
    const ev = (await s.from("events").insert({
      org_id: org.id, name: "Confirm Race", status: "open",
    }).select().single()).data!;
    const cat = (await s.from("categories").insert({
      org_id: org.id, event_id: ev.id, code: "40k", label: "40K",
      base_price: 200000, slots_total: 100, slots_taken: 0,
    }).select().single()).data!;
    const user = (await s.auth.admin.createUser({
      email: `${stamp}@test.dev`, password: "password123", email_confirm: true,
    })).data.user!;
    const reg = (await s.from("registrations").insert({
      org_id: org.id, event_id: ev.id, category_id: cat.id,
      user_id: user.id, total_amount: 200000, status: "pending",
    }).select().single()).data!;
    await s.from("payments").insert({
      org_id: org.id, registration_id: reg.id, amount: 200000, status: "pending",
    });
    return {
      s, org, reg,
      cleanup: async () => {
        await s.from("organizations").delete().eq("id", org.id);
        await s.auth.admin.deleteUser(user.id);
      },
    };
  }

  it("stores the actual fee and leaves net_to_org = amount - fee - commission", async () => {
    const f = await fixture("cfa");
    try {
      // ₱2,000 GCash: RP 3% = ₱60, PayMongo 1.5% = ₱30, organizer ₱1,910.
      const { data } = await f.s.rpc("confirm_payment_tx", {
        p_registration_id: f.reg.id, p_method: "gcash",
        p_fee: 6000, p_net: 191000, p_token: "tok", p_raw: {},
        p_processor_fee: 3000, p_processor_fee_predicted: 3000, p_processor_fee_source: "actual",
      });
      expect(data).toBe("paid");

      const pay = (await f.s.from("payments")
        .select("amount,platform_fee,net_to_org,processor_fee_cents,processor_fee_source")
        .eq("registration_id", f.reg.id).single()).data!;
      expect(pay).toMatchObject({
        amount: 200000, platform_fee: 6000, net_to_org: 191000,
        processor_fee_cents: 3000, processor_fee_source: "actual",
      });
      // The ledger invariant.
      expect(pay.amount - pay.processor_fee_cents - pay.platform_fee).toBe(pay.net_to_org);
    } finally {
      await f.cleanup();
    }
  });

  it("records a predicted fee when the provider did not report one", async () => {
    const f = await fixture("cfp");
    try {
      await f.s.rpc("confirm_payment_tx", {
        p_registration_id: f.reg.id, p_method: "card",
        p_fee: 6000, p_net: 185500, p_token: "tok", p_raw: {},
        p_processor_fee: 8500, p_processor_fee_predicted: 8500, p_processor_fee_source: "predicted",
      });
      const pay = (await f.s.from("payments")
        .select("processor_fee_cents,processor_fee_source").eq("registration_id", f.reg.id).single()).data!;
      expect(pay).toMatchObject({ processor_fee_cents: 8500, processor_fee_source: "predicted" });
    } finally {
      await f.cleanup();
    }
  });

  it("keeps the old 6-arg behaviour available to callers not yet taught about fees", async () => {
    const f = await fixture("cfo");
    try {
      const { data, error } = await f.s.rpc("confirm_payment_tx", {
        p_registration_id: f.reg.id, p_method: "gcash",
        p_fee: 6000, p_net: 194000, p_token: "tok", p_raw: {},
      });
      expect(error).toBeNull();
      expect(data).toBe("paid");
      const pay = (await f.s.from("payments")
        .select("processor_fee_cents,processor_fee_source").eq("registration_id", f.reg.id).single()).data!;
      expect(pay).toMatchObject({ processor_fee_cents: 0, processor_fee_source: "none" });
    } finally {
      await f.cleanup();
    }
  });
});

/**
 * The organizer settlement page (`app/(admin)/events/[id]/settlement`) reads
 * `payments` with NO org filter of its own, on purpose: `payments_read_org_admin`
 * (20260808161720) already scopes SELECT to the caller's own organizations, and
 * a second filter in the query would be a copy of an authorization rule that can
 * drift from the original.
 *
 * That decision is only safe if the policy genuinely holds, so this is the test
 * that owes it. It asserts BOTH directions — an admin of org A reads none of org
 * B's payments, and does read their own — because a policy that denied everyone
 * everything would pass the isolation half on its own and take the page's whole
 * purpose down with it, silently, as an empty table.
 *
 * It carries the page's STATUS FILTER for the same reason. `COUNTED_STATUSES`
 * sits in `lib/queries/settlement.ts`, which no unit test can import, so without
 * an assertion here the rule that keeps abandoned checkouts out of an
 * organizer's revenue would have no permanent proof anywhere.
 */
describe("settlement RLS isolation", () => {
  it("an org admin reads their own event's real money and nothing else", async () => {
    const s = svc();
    const stamp = `iso-${Date.now()}`;

    const orgA = (await s.from("organizations").insert({ name: "Iso A", slug: `${stamp}-a` })
      .select().single()).data!;
    const orgB = (await s.from("organizations").insert({ name: "Iso B", slug: `${stamp}-b` })
      .select().single()).data!;
    const users: string[] = [];
    try {
      /**
       * One org's event + category + a paid registration and payment, PLUS the
       * two rows a settlement must never count as revenue.
       *
       * `registrations-checkout` upserts a payments row at full sticker price
       * with status 'pending' the moment a runner opens checkout, and
       * `expire_stale_registrations` flips abandoned ones to 'failed' with
       * `amount` left intact. Both are seeded here at the SAME ₱1,000 as the
       * real sale, so a page that forgot to filter would report triple the
       * gross.
       *
       * Their registrations are 'cancelled' rather than 'pending' only to stay
       * clear of `registrations_one_live_per_event`, which is unique on
       * (event_id, user_id) for live statuses — the payment status is what this
       * test is about.
       */
      const seedEvent = async (org: { id: string }, tag: string) => {
        const ev = (await s.from("events").insert({
          org_id: org.id, name: `Iso ${tag} Race`, status: "draft",
        }).select().single()).data!;
        const cat = (await s.from("categories").insert({
          org_id: org.id, event_id: ev.id, code: "10k", label: "10K",
          base_price: 100000, slots_total: 10, slots_taken: 1,
        }).select().single()).data!;
        const runner = (await s.auth.admin.createUser({
          email: `${stamp}-run-${tag}@test.dev`, password: "password123", email_confirm: true,
        })).data.user!;
        users.push(runner.id);
        const mkReg = async (status: "paid" | "cancelled") => (await s.from("registrations").insert({
          org_id: org.id, event_id: ev.id, category_id: cat.id,
          user_id: runner.id, total_amount: 100000, status,
        }).select().single()).data!;

        const reg = await mkReg("paid");
        await s.from("payments").insert({
          org_id: org.id, registration_id: reg.id, amount: 100000, status: "paid",
          platform_fee: 3000, processor_fee_cents: 1500, processor_fee_source: "actual",
          net_to_org: 95500,
        });
        for (const status of ["pending", "failed"] as const) {
          const abandoned = await mkReg("cancelled");
          await s.from("payments").insert({
            org_id: org.id, registration_id: abandoned.id, amount: 100000, status,
            platform_fee: 0, processor_fee_cents: 0, processor_fee_source: "none", net_to_org: 0,
          });
        }
        return { ev, reg };
      };

      const b = await seedEvent(orgB, "b");
      const a = await seedEvent(orgA, "a");

      // An admin of org A only.
      const adminA = (await s.auth.admin.createUser({
        email: `${stamp}-admin@test.dev`, password: "password123", email_confirm: true,
      })).data.user!;
      users.push(adminA.id);
      await s.from("user_roles").insert({ user_id: adminA.id, role: "admin", org_id: orgA.id });

      const asA = createClient(url, anonKey, { auth: { persistSession: false } });
      await asA.auth.signInWithPassword({ email: `${stamp}-admin@test.dev`, password: "password123" });

      const { data, error } = await asA.from("payments")
        .select("id,processor_fee_cents").eq("org_id", orgB.id);
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);

      // The shape the settlement page actually issues: scoped by the event
      // through the registrations join, with no org predicate at all. This is the
      // one that would leak if the policy were wrong, and the org_id filter above
      // would not have caught it.
      const byEvent = (eventId: string) => asA.from("payments")
        .select("registration_id,amount,net_to_org,status,registrations!inner(event_id)")
        .eq("registrations.event_id", eventId);
      // COUNTED_STATUSES in apps/web/lib/queries/settlement.ts. Kept in step with
      // it deliberately: that constant lives in a module no test can import (it
      // reaches next/headers through the Supabase server client), so this is the
      // only place the filter is exercised against a real database.
      const asPage = (eventId: string) => byEvent(eventId)
        .in("status", ["paid", "partially_refunded", "refunded"]);

      // `toHaveLength(0)` on its own passes VACUOUSLY if the query errors — a
      // renamed column or a malformed embed would return no rows and read as
      // perfect isolation. The error assertion is what makes the empty result
      // mean "RLS filtered them", same as the sibling assertion above.
      const other = await asPage(b.ev.id);
      expect(other.error).toBeNull();
      expect(other.data ?? []).toHaveLength(0);

      // The control. Same query, own event — must return the row, or the
      // isolation assertion above proves nothing.
      const mine = (await asPage(a.ev.id)).data ?? [];
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ registration_id: a.reg.id, net_to_org: 95500 });

      // …and the abandoned checkouts really are there, visible to this same
      // admin, and excluded only by the status filter. Without this control the
      // assertion above would pass just as well if the seed had never written
      // them: three rows unfiltered, ₱3,000 of "gross" on offer, one of which is
      // money.
      const unfiltered = await byEvent(a.ev.id);
      expect(unfiltered.error).toBeNull();
      expect(unfiltered.data ?? []).toHaveLength(3);
      expect((unfiltered.data ?? []).map((r) => r.status).sort())
        .toEqual(["failed", "paid", "pending"]);
      expect((unfiltered.data ?? []).reduce((sum, r) => sum + r.amount, 0)).toBe(300000);
    } finally {
      await s.from("organizations").delete().eq("id", orgA.id);
      await s.from("organizations").delete().eq("id", orgB.id);
      for (const id of users) await s.auth.admin.deleteUser(id);
    }
  });
});
