import { useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { refundRegistration } from "../lib/registrations";

export function RefundModal({ registration, onClose, onDone }: {
  registration: { id: string; full_name: string | null; total_amount: number };
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const peso = `₱${(registration.total_amount / 100).toLocaleString()}`;

  async function submit() {
    setBusy(true); setError(null);
    const res = await refundRegistration(registration.id, note || undefined);
    setBusy(false);
    if (!res.ok) { setError(res.error ?? "Refund failed."); return; }
    toast.success(`Refunded ${peso}`);
    onDone();
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-[380px]">
        <DialogHeader>
          <DialogTitle>Refund {peso}?</DialogTitle>
          <DialogDescription>
            Refunds {registration.full_name ?? "this runner"} and reopens their slot. This can't be undone.
          </DialogDescription>
        </DialogHeader>
        <Input aria-label="Refund note" placeholder="Reason (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        {error ? <span role="alert" className="text-[13px] text-destructive">{error}</span> : null}
        <DialogFooter>
          <Button variant="outline" className="rounded-pill" onClick={onClose}>Keep it</Button>
          <Button aria-label="Confirm refund" variant="destructive" className="rounded-pill" disabled={busy} onClick={submit}>
            {busy ? "Refunding…" : "Refund"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
