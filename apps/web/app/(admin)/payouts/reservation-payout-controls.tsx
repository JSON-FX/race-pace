"use client";

import { useActionState } from "react";
import { reservationPayoutAction } from "@/lib/actions/reservation-payouts";

export function ReservationPayoutControls({ eventId, statement }: {
  eventId: string;
  statement: { id: string; status: "open" | "paid"; revision: number } | null;
}) {
  const [state, action, pending] = useActionState(reservationPayoutAction, {});
  if (statement?.status === "paid") return <span className="text-xs font-semibold text-primary">Paid</span>;
  return <form action={action} className="flex flex-wrap items-center gap-2">
    <input type="hidden" name="id" value={statement?.id ?? eventId} />
    {statement ? <>
      <input type="hidden" name="revision" value={statement.revision} />
      <button type="submit" name="mode" value="refresh" disabled={pending}
        className="rounded-md border border-divider px-3 py-1.5 text-xs font-semibold">Refresh</button>
      <label className="sr-only" htmlFor={`reservation-reference-${statement.id}`}>Transfer reference</label>
      <input id={`reservation-reference-${statement.id}`} name="reference" placeholder="Transfer reference"
        className="w-36 rounded-md border border-divider bg-card px-2 py-1.5 text-xs" />
      <button type="submit" name="mode" value="pay" disabled={pending}
        className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white">Record payout</button>
    </> : <button type="submit" name="mode" value="open" disabled={pending}
      className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-white">Open statement</button>}
    {state.error ? <span role="alert" className="w-full text-xs text-destructive">{state.error}</span> : null}
  </form>;
}
