"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { peso } from "@/lib/format";
import { fieldLabel } from "@/lib/field-labels";
import { groupByDay, type AuditRow } from "@/lib/audit";

// Data only ever lands here after the client-side fetch below resolves, so there is no
// server-rendered pass to disagree with — unlike fmtDateTime (lib/format.ts), this can use
// the viewer's own locale/zone without risking a hydration mismatch.
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

const actorLabel = (actorRole: string | null) => (actorRole === "admin" ? "Organiser" : "Runner");

/** Showing the PREVIOUS value is the point of this section: reconciling a box of printed
 *  shirts against a roster needs "M → L", not "shirt size changed". Non-field events
 *  collapse to one line so the section stays short in a 420px drawer. */
function Entry({ row }: { row: AuditRow }) {
  if (row.action === "field_changed") {
    const from = row.detail.from as string | null;
    const to = row.detail.to as string | null;
    return (
      <div className="rounded-lg bg-muted/40 p-2.5">
        <div className="text-[13px] font-medium">{fieldLabel(String(row.detail.field ?? ""))}</div>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="rounded bg-muted px-2 py-0.5 text-[12px] text-muted-foreground line-through">
            {from ?? "empty"}
          </span>
          <ArrowRight size={12} className="text-muted-foreground" aria-hidden="true" />
          {/* `--accent` is a pale background tint, not a foreground — reading it as text
              paints near-white on near-white. The legible pairing, used everywhere else in
              this app, is bg-accent with text-accent-foreground. */}
          <span className="rounded bg-accent px-2 py-0.5 text-[12px] font-medium text-accent-foreground">
            {to}
          </span>
        </div>
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          {actorLabel(row.actor_role)} · {time(row.created_at)}
        </div>
      </div>
    );
  }

  // paid / refunded / partially_refunded all carry a `detail.amount` in centavos (see the
  // RPCs in supabase/migrations/20260808140000_money_txn_audit.sql and
  // 20260808150000_partial_refund_audit.sql) — money events collapse to one line rather than
  // getting the from/to card above, since there is no "previous amount" to show.
  const amount = typeof row.detail.amount === "number" ? ` ${peso(row.detail.amount)}` : "";
  const label =
    row.action === "paid" ? `Paid${amount}`
    : row.action === "refunded" ? `Refunded${amount}`
    : row.action === "partially_refunded" ? `Partially refunded${amount}`
    // Falls back to the raw action rather than hiding an event type nobody has taught
    // this component about yet.
    : row.action;
  return (
    <div className="flex justify-between px-0.5 py-1">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="text-[11px] text-muted-foreground">{time(row.created_at)}</span>
    </div>
  );
}

export function RegistrationHistory({ registrationId }: { registrationId: string }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .from("registration_audit")
      .select("id,action,detail,actor_role,created_at")
      .eq("registration_id", registrationId)
      .order("created_at", { ascending: false })
      .then(({ data, error }: { data: AuditRow[] | null; error: unknown }) => {
        if (cancelled) return;
        setRows(error ? null : ((data ?? []) as AuditRow[]));
      });
    return () => {
      cancelled = true;
    };
  }, [registrationId]);

  // null covers both "still loading" and "the query failed". Rendering the empty state in
  // either case would assert "nothing ever happened to this registration", which is a
  // stronger claim than we can make — so render nothing until we actually know.
  if (rows === null) return null;
  if (rows.length === 0) return <p className="text-[13px] text-muted-foreground">No changes yet.</p>;

  return (
    <div className="flex flex-col gap-2.5">
      {groupByDay(rows).map((g) => (
        <div key={g.day}>
          <div className="mb-1 text-[11px] text-muted-foreground">{g.day}</div>
          <div className="flex flex-col gap-1.5">
            {g.rows.map((r) => (
              <Entry key={r.id} row={r} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
