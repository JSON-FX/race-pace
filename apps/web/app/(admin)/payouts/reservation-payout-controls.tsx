"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
      <Button variant="outline" type="submit" name="mode" value="refresh" disabled={pending}
        className="border px-3 py-1.5">Refresh</Button>
      <Label className="sr-only" htmlFor={`reservation-reference-${statement.id}`}>Transfer reference</Label>
      <Input id={`reservation-reference-${statement.id}`} name="reference" placeholder="Transfer reference"
        className="w-36 border px-2 py-1.5" />
      <Button variant="default" type="submit" name="mode" value="pay" disabled={pending}
        className="px-3 py-1.5">Record payout</Button>
    </> : <Button variant="default" type="submit" name="mode" value="open" disabled={pending}
      className="px-3 py-1.5">Open statement</Button>}
    {state.error ? <Alert variant="destructive" role="alert" className="w-full"><AlertDescription>{state.error}</AlertDescription></Alert> : null}
  </form>;
}
