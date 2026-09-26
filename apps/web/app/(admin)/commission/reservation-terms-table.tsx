"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { saveReservationFeeTermsAction } from "@/lib/actions/commission";
import type { OrgCommissionRow } from "@/lib/queries/commission";

function ReservationTermRow({ org }: { org: OrgCommissionRow }) {
  const [type, setType] = useState(org.reservation_commission_type ?? "fixed");
  const [percent, setPercent] = useState(String((org.reservation_commission_rate ?? 0) * 100));
  const [flat, setFlat] = useState(String((org.reservation_commission_flat_cents ?? 0) / 100));
  const [state, formAction, pending] = useActionState(saveReservationFeeTermsAction, {});

  return (
    <form action={formAction} className="grid gap-3 border-t border-divider p-4 first:border-t-0 md:grid-cols-[minmax(160px,1fr)_auto_auto_auto] md:items-center">
      <input type="hidden" name="orgId" value={org.id} />
      <input type="hidden" name="reservation_commission_type" value={type} />
      <input type="hidden" name="reservation_commission_percent" value={percent} />
      <input type="hidden" name="reservation_commission_flat_pesos" value={flat} />
      <div>
        <p className="text-sm font-bold">{org.name}</p>
        <p className="text-xs text-muted-foreground">Charged for each reserved Race Passport when the reservation is paid.</p>
      </div>
      <fieldset className="flex items-center gap-3 text-sm" aria-label={`Reservation Platform Fees type for ${org.name}`}>
        <label className="flex items-center gap-1"><input type="radio" checked={type === "fixed"} onChange={() => setType("fixed")} /> Fixed</label>
        <label className="flex items-center gap-1"><input type="radio" checked={type === "percent"} onChange={() => setType("percent")} /> Percent</label>
      </fieldset>
      <label className="flex items-center gap-1 text-sm">
        <span>{type === "fixed" ? "₱" : "%"}</span>
        <input
          aria-label={`Reservation Platform Fees for ${org.name}`}
          type="number" min="0" max={type === "percent" ? "100" : undefined} step="0.01"
          value={type === "fixed" ? flat : percent}
          onChange={(event) => type === "fixed" ? setFlat(event.target.value) : setPercent(event.target.value)}
          className="h-9 w-28 rounded-lg border bg-card px-2 text-right tabular-nums"
        />
      </label>
      <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
      {state.error ? <p role="alert" className="text-xs text-destructive md:col-span-4">{state.error}</p> : null}
      {state.success ? <p role="status" className="text-xs text-forest md:col-span-4">{state.success}</p> : null}
    </form>
  );
}

export function ReservationTermsTable({ orgs }: { orgs: OrgCommissionRow[] }) {
  return <div>{orgs.map((org) => <ReservationTermRow key={org.id} org={org} />)}</div>;
}
