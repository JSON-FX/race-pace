"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[380px] rounded-xl">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-bold">Cancel “{event.name}”?</DialogTitle>
          <DialogDescription className="text-[13px] text-muted-foreground">Registrations are kept; refunds are handled from Payments.</DialogDescription>
        </DialogHeader>
        <Input aria-label="Cancel note" placeholder="Reason (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        {error ? <span role="alert" className="text-[13px] text-destructive">{error}</span> : null}
        <DialogFooter>
          <Button variant="outline" className="rounded-pill" onClick={onClose}>Keep it</Button>
          <Button variant="destructive" className="rounded-pill" disabled={busy} onClick={submit}>
            {busy ? "Cancelling…" : "Cancel event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
