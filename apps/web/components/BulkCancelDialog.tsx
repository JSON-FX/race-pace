"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cancelRegistrationsAction } from "@/lib/actions/registrations";

/** Confirms the Registrations bulk "Cancel" action (destructive — see the
 *  visual parity spec's "Bulk selection" section) and surfaces the server's
 *  real error rather than swallowing it, per the same rule RefundModal
 *  already follows for the per-row refund flow. */
export function BulkCancelDialog({ ids, onDone, onClose }: {
  ids: string[];
  onDone: () => void;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    setError(null);
    const res = await cancelRegistrationsAction(ids);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Cancel failed.");
      return;
    }
    if (res.error) {
      // Partial success — some ids weren't cancellable, but at least one was.
      toast.warning(res.error);
    } else {
      toast.success(`Cancelled ${res.cancelled} registration${res.cancelled === 1 ? "" : "s"}.`);
    }
    onDone();
    onClose();
  }

  return (
    <AlertDialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <AlertDialogContent className="w-[380px] rounded-xl">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-[17px] font-bold">
            Cancel {ids.length} registration{ids.length === 1 ? "" : "s"}?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-[13px] text-muted-foreground">
            This releases their category slot. Paid registrations can&apos;t be cancelled this
            way — refund them individually instead. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <span role="alert" className="text-[13px] text-destructive">{error}</span> : null}
        <AlertDialogFooter>
          <AlertDialogCancel className="rounded-pill" disabled={busy}>Keep them</AlertDialogCancel>
          <AlertDialogAction
            className="rounded-pill"
            variant="destructive"
            disabled={busy}
            onClick={(e) => { e.preventDefault(); void confirm(); }}
          >
            {busy ? "Cancelling…" : "Cancel registrations"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
