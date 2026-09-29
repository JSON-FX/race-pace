"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { refundRegistrationAction, previewRefundAction, type RefundResponse } from "@/lib/actions/registrations";
import { peso } from "@/lib/format";

export function RefundModal({ registration, onClose, onDone }: {
  registration: { id: string; full_name: string | null; total_amount: number; booking_order_id?: string | null };
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<RefundResponse | null>(null);
  useEffect(() => {
    let active = true;
    const request = registration.booking_order_id
      ? previewRefundAction(registration.id, registration.booking_order_id)
      : previewRefundAction(registration.id);
    request.then((result) => {
      if (active) { setPreview(result); if (!result.ok) setError(result.error ?? "Could not load refund."); }
    }).catch(() => { if (active) setError("Could not load refund. Close and try again."); });
    return () => { active = false; };
  }, [registration.id, registration.booking_order_id]);
  const ready = preview?.ok && !preview.pending && !preview.already && !preview.existing_request && Number.isSafeInteger(preview.refund_amount);
  const canCheck = preview?.ok && (preview.pending || preview.existing_request);
  const amount = ready ? peso(preview!.refund_amount!) : "";

  async function submit() {
    if ((!ready && !canCheck) || busy) return;
    setBusy(true); setError(null);
    let res: RefundResponse;
    try { res = registration.booking_order_id
      ? await refundRegistrationAction(registration.id, undefined, preview!.refund_amount, registration.booking_order_id)
      : await refundRegistrationAction(registration.id, note || undefined, preview!.refund_amount); }
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
    <AlertDialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent className="w-[380px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="">{ready ? `Refund ${amount}?` : "Review refund"}</AlertDialogTitle>
          <AlertDialogDescription className="text-[13px] text-muted-foreground">
            {registration.booking_order_id
              ? `This refunds only ${registration.full_name ?? "this runner"}'s entry. Once confirmed, their ticket is cancelled and their slot is released, even when fees are retained. Other participants stay registered. Completed refunds cannot be undone.`
              : <>A full refund releases {registration.full_name ?? "this runner"}&apos;s slot. A partial refund keeps the ticket and slot active. Completed refunds cannot be undone.</>}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {ready ? <dl className="text-sm space-y-2">
          <div>Original payment: {peso(preview!.total_paid!)}</div>
          <div>Retained fees: {peso(preview!.retained_fees!)}</div>
          <div>Returned to runner: {amount}</div>
          <p>Platform and processing fees are retained, along with any organizer refund fee.</p>
        </dl> : !error ? <p>{preview?.existing_request ? "An earlier refund request exists. Check its current status before taking further action." : preview?.pending ? "Refund pending. The slot stays reserved until the provider confirms it." : preview?.already ? "This registration was already refunded." : "Loading refund amount…"}</p> : null}
        {!registration.booking_order_id && <Input disabled={!!canCheck} aria-label="Refund note" placeholder="Reason (optional)" value={note} onChange={(e) => setNote(e.target.value)} />}
        {error ? <Alert variant="destructive" role="alert" className=""><AlertDescription>{error}</AlertDescription></Alert> : null}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Keep it</AlertDialogCancel>
          <Button aria-label={canCheck ? "Check refund status" : "Confirm refund"} variant="destructive" className="" disabled={busy || (!ready && !canCheck)} onClick={submit}>
            {busy ? (canCheck ? "Checking…" : "Refunding…") : canCheck ? "Check refund status" : "Refund"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
