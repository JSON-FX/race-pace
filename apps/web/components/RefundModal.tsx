"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { refundRegistrationAction, previewRefundAction, type RefundResponse } from "@/lib/actions/registrations";
import { peso } from "@/lib/format";

export function RefundModal({ registration, onClose, onDone }: {
  registration: { id: string; full_name: string | null; total_amount: number };
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<RefundResponse | null>(null);
  useEffect(() => {
    let active = true;
    previewRefundAction(registration.id).then((result) => {
      if (active) { setPreview(result); if (!result.ok) setError(result.error ?? "Could not load refund."); }
    }).catch(() => { if (active) setError("Could not load refund. Close and try again."); });
    return () => { active = false; };
  }, [registration.id]);
  const ready = preview?.ok && !preview.pending && !preview.already && Number.isSafeInteger(preview.refund_amount);
  const canCheck = preview?.ok && preview.pending;
  const amount = ready ? peso(preview!.refund_amount!) : "";

  async function submit() {
    if ((!ready && !canCheck) || busy) return;
    setBusy(true); setError(null);
    let res: RefundResponse;
    try { res = await refundRegistrationAction(registration.id, note || undefined, preview!.refund_amount); }
    catch { res = { ok: false, error: "Could not confirm the result. Close and reopen to check before retrying." }; }
    setBusy(false);
    if (!res.ok) { setError(res.error ?? "Refund failed."); return; }
    if (res.pending) toast.info("Refund pending. The slot stays reserved until the provider confirms it.");
    else if (res.already) toast.info("This registration was already refunded. No new refund was issued.");
    else if (typeof res.refund_amount === "number") toast.success(`Refunded ${peso(res.refund_amount)}`);
    else toast.info("Refund request processed. Refresh the registration to check its status.");
    onDone();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[380px] rounded-xl">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-bold">{ready ? `Refund ${amount}?` : "Review refund"}</DialogTitle>
          <DialogDescription className="text-[13px] text-muted-foreground">
            A full refund releases {registration.full_name ?? "this runner"}&apos;s slot. A partial refund keeps the ticket and slot active. Completed refunds cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {ready ? <dl className="text-sm space-y-2">
          <div>Original payment: {peso(preview!.total_paid!)}</div>
          <div>Retained fees: {peso(preview!.retained_fees!)}</div>
          <div>Returned to runner: {amount}</div>
          <p>Platform and processing fees are retained, along with any organizer refund fee.</p>
        </dl> : !error ? <p>{preview?.pending ? "Refund pending. The slot stays reserved until the provider confirms it." : preview?.already ? "This registration was already refunded." : "Loading refund amount…"}</p> : null}
        <Input disabled={!!canCheck} aria-label="Refund note" placeholder="Reason (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        {error ? <span role="alert" className="text-[13px] text-destructive">{error}</span> : null}
        <DialogFooter>
          <Button variant="outline" className="rounded-pill" onClick={onClose}>Keep it</Button>
          <Button aria-label={canCheck ? "Check refund status" : "Confirm refund"} variant="destructive" className="rounded-pill" disabled={busy || (!ready && !canCheck)} onClick={submit}>
            {busy ? (canCheck ? "Checking…" : "Refunding…") : canCheck ? "Check refund status" : "Refund"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
