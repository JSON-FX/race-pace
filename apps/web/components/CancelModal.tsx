"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { useState } from "react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogCancel } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cancelEventAction } from "../lib/actions/events";

export function CancelModal({ event, onClose, onDone }: { event: { id: string; name: string }; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setError(null);
    const { error } = await cancelEventAction(event.id, note);
    setBusy(false);
    if (error) { setError(error); return; }
    toast.success(`"${event.name}" cancelled`);
    onDone();
    onClose();
  }

  return (
    <AlertDialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent className="w-[380px]">
        <AlertDialogHeader>
          <AlertDialogTitle className="">Cancel “{event.name}”?</AlertDialogTitle>
          <AlertDialogDescription className="text-[13px] text-muted-foreground">Registrations are kept; refunds are handled from Payments.</AlertDialogDescription>
        </AlertDialogHeader>
        <Input aria-label="Cancel note" placeholder="Reason (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        {error ? <Alert variant="destructive" role="alert" className=""><AlertDescription>{error}</AlertDescription></Alert> : null}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Keep it</AlertDialogCancel>
          <Button variant="destructive" className="" disabled={busy} onClick={submit}>
            {busy ? "Cancelling…" : "Cancel event"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
