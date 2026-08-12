import { describe, it, expect } from "vitest";
import { payoutRowState, payoutKpis, statementResidual, type PayoutStatementRow } from "./payouts";

const base = { status: "open", net_owed_cents: 100000, event_finished: true };

describe("payoutRowState", () => {
  it("is ready when the event finished and money is owed", () => {
    expect(payoutRowState(base)).toBe("ready");
  });

  it("is held while the event is still running", () => {
    // Greyed with a reason rather than hidden: when an organizer asks "where's
    // my money for Dumalinao?", the operator should read the answer off screen.
    expect(payoutRowState({ ...base, event_finished: false })).toBe("held");
  });

  it("is paid once settled", () => {
    expect(payoutRowState({ ...base, status: "paid" })).toBe("paid");
  });

  it("is owed_back when clawbacks exceed new earnings", () => {
    // A negative row must never render as a payment instruction — that is how
    // someone transfers the money in the wrong direction.
    expect(payoutRowState({ ...base, net_owed_cents: -270000 })).toBe("owed_back");
  });

  it("treats a settled negative statement as paid, not owed_back", () => {
    expect(payoutRowState({ status: "paid", net_owed_cents: -270000, event_finished: true })).toBe("paid");
  });
});

/* ------------------------------------------------------------------ *
 * The breakdown the payouts table prints
 * ------------------------------------------------------------------ */

/** One paid ₱2,000 GCash entry under 2026-08-11 terms: Race Pace's 3% is ₱60,
 *  PayMongo takes ₱30, the organizer is owed ₱1,910. Nothing refunded. */
const statement = (over: Partial<PayoutStatementRow> = {}): PayoutStatementRow => ({
  id: "s1", event_id: "e1", org_id: "o1", event_name: "Trail 40", org_name: "RunWithPoint",
  event_date: "2026-01-01", end_date: null, event_status: "completed",
  gross_cents: 200000, commission_cents: 6000, processing_cents: 3000,
  refunds_in_period_cents: 0, refunds_cents: 0, net_owed_cents: 191000,
  status: "open", reference: null, note: null,
  opened_at: "2026-01-02T00:00:00Z", paid_at: null, event_finished: true,
  ...over,
});

describe("statementResidual — the statement explains its own net owed", () => {
  it("reconciles a plain statement", () => {
    // 200000 - 6000 - 3000 = 191000. Before Task 13 the console selected neither
    // processing_cents nor refunds_in_period_cents, so the printed breakdown was
    // out by the processor's cut on every row.
    expect(statementResidual(statement())).toBe(0);
  });

  it("reconciles a statement carrying an in-period refund", () => {
    // Two entries, one partially refunded to a ₱300 retention: ₱1,610 went back
    // out of money this statement has NOT paid yet, so it is netted out of the
    // earnings rather than clawed back. Σ net_to_org = 191000 + 30000.
    const s = statement({
      gross_cents: 400000, commission_cents: 12000, processing_cents: 6000,
      refunds_in_period_cents: 161000, net_owed_cents: 221000,
    });
    expect(statementResidual(s)).toBe(0);
  });

  it("reconciles a CLAWBACK statement, which the four-term identity cannot", () => {
    // Money already transferred on an earlier statement (₱1,910) and since
    // refunded, with no new sales in this period. This is the case the design
    // note's `gross - commission - processing - refunds_in_period = net_owed`
    // does not cover: it is stated for a statement whose clawback is zero.
    const s = statement({
      gross_cents: 0, commission_cents: 0, processing_cents: 0,
      refunds_in_period_cents: 0, refunds_cents: 191000, net_owed_cents: -191000,
    });
    expect(statementResidual(s)).toBe(0);

    // What the four printed terms would have claimed instead: ₱0 owed, on a row
    // whose net says the organization owes ₱1,910 back. Off by exactly the
    // amount being recovered.
    const fourTerms =
      s.gross_cents - s.commission_cents - s.processing_cents - s.refunds_in_period_cents;
    expect(fourTerms).toBe(0);
    expect(fourTerms - s.net_owed_cents).toBe(s.refunds_cents);
  });

  it("reconciles new sales and a clawback on the same statement", () => {
    // The worst version to read: ₱1,910 of new earnings exactly cancelled by a
    // ₱1,910 recovery. Four terms print a breakdown that says "transfer
    // ₱1,910" beside a net owed of ₱0.
    const s = statement({ refunds_cents: 191000, net_owed_cents: 0 });
    expect(statementResidual(s)).toBe(0);
    expect(s.gross_cents - s.commission_cents - s.processing_cents).toBe(191000);
  });

  it("reports the shortfall rather than hiding it when a statement does not reconcile", () => {
    // The payouts page filters on this being non-zero and names the statement.
    // A breakdown that silently fails to add up is worse than one that says so —
    // this table is what a manual bank transfer gets keyed from.
    expect(statementResidual(statement({ net_owed_cents: 200000 }))).toBe(9000);
  });
});

describe("payoutKpis — processing", () => {
  it("totals processing across READY statements only", () => {
    const k = payoutKpis([statement(), statement({ id: "s2" })]);
    expect(k.readyCount).toBe(2);
    expect(k.processingCents).toBe(6000);
    expect(k.totalOwedCents).toBe(382000);
  });

  it("leaves held, paid and owed-back rows out of it, matching totalOwedCents", () => {
    // The caption this feeds sits under TOTAL OWED, which is READY-only. A
    // processing figure drawn from a wider set would caption a number with a
    // cost that is not inside it.
    const k = payoutKpis([
      statement(),
      statement({ id: "s2", event_finished: false }),
      statement({ id: "s3", status: "paid", paid_at: "2026-01-05T00:00:00Z" }),
      statement({ id: "s4", refunds_cents: 400000, net_owed_cents: -209000 }),
    ]);
    expect(k.readyCount).toBe(1);
    expect(k.processingCents).toBe(3000);
  });
});
