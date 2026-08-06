"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { EventCombobox } from "@/components/EventCombobox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { peso } from "@/lib/format";
import type { OpenableEvent } from "@/lib/queries/payouts";
import { openPayoutStatementAction, markPayoutPaidAction } from "@/lib/actions/payouts";

/**
 * Cut a new statement for an event.
 *
 * Opening is manual by design (§8) — there is no automatic gate on event
 * completion — so unfinished events stay in the picker rather than being
 * filtered out. What guards the early case is a confirmation, not a
 * prohibition: an event still taking registrations has a growing net figure,
 * so an operator who cuts it now will owe a second, top-up statement later.
 * That is legitimate (a stage race that wants an interim transfer) but it
 * should be a decision, not a slip.
 */
export function OpenStatementControl({ events }: { events: OpenableEvent[] }) {
  const [eventId, setEventId] = useState<string>("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const selected = events.find((e) => e.id === eventId) ?? null;

  async function open(id: string) {
    setBusy(true);
    const res = await openPayoutStatementAction(id);
    setBusy(false);
    setConfirming(false);
    if (!res.ok) {
      toast.error(res.error ?? "Couldn't open the statement.");
      return;
    }
    toast.success("Statement opened.");
    setEventId("");
  }

  function submit() {
    if (!selected) return;
    // Finished events go straight through; unfinished ones stop for a
    // confirmation that names the consequence.
    if (selected.event_finished) void open(selected.id);
    else setConfirming(true);
  }

  if (events.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        Every event already has an open statement.
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {/* Searchable: this list spans EVERY organization on the platform, so it
            grows fastest of any picker in the console. The subtitle carries the
            org and the still-running warning, since two orgs can legitimately
            run events with similar names. */}
        <EventCombobox
          events={events.map((e) => ({
            id: e.id,
            name: e.name,
            subtitle: `${e.org_name}${e.event_finished ? "" : " · still running"}`,
          }))}
          value={eventId || null}
          onSelect={setEventId}
          label="Event to open a statement for"
          className="w-[290px]"
        />
        <Button className="rounded-pill" disabled={!selected || busy} onClick={submit}>
          <Plus />
          {busy ? "Opening…" : "Open statement"}
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={(o) => { if (!o && !busy) setConfirming(false); }}>
        <AlertDialogContent className="w-[420px] rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[17px] font-bold">
              {selected?.name} hasn&apos;t finished yet
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[13px] text-muted-foreground">
              It is still taking registrations, so the amount owed will keep growing after this
              statement is cut. Settling it now pays only what has come in so far — you&apos;ll
              need a second, top-up statement for the rest. Nothing is double-paid either way:
              each payment is stamped with the statement that settled it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-pill" disabled={busy}>Wait for the event</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-pill"
              disabled={busy}
              onClick={(e) => { e.preventDefault(); if (selected) void open(selected.id); }}
            >
              {busy ? "Opening…" : "Open it anyway"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Settle a statement.
 *
 * The SAME dialog serves both directions of money, but never with the same
 * words. `owed_back` means clawbacks exceeded new earnings, so the organizer
 * owes Race Pace — the button reads "Record recovery", the heading says money
 * is coming back, and the amount is shown as a positive figure labelled as
 * owed BY the organization. A negative amount under a "Mark paid" button is
 * exactly how someone sends the money the wrong way, so that combination is
 * never rendered.
 */
export function SettleStatementButton({ statement }: {
  statement: { id: string; event_name: string; org_name: string; net_owed_cents: number };
}) {
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const recovery = statement.net_owed_cents < 0;
  const amount = peso(Math.abs(statement.net_owed_cents));
  const verb = recovery ? "Record recovery" : "Mark paid";

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await markPayoutPaidAction(statement.id, reference, note);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Couldn't record the settlement.");
      return;
    }
    toast.success(recovery ? `Recorded ${amount} recovered from ${statement.org_name}.`
                           : `Recorded ${amount} paid to ${statement.org_name}.`);
    setOpen(false);
    setReference("");
    setNote("");
  }

  return (
    <>
      <Button
        size="sm"
        variant={recovery ? "outline" : "default"}
        className="rounded-pill"
        onClick={() => setOpen(true)}
      >
        {verb}
      </Button>

      <Dialog open={open} onOpenChange={(o) => { if (!busy) setOpen(o); }}>
        <DialogContent className="w-[420px] rounded-xl">
          <DialogHeader>
            <DialogTitle className="text-[17px] font-bold">
              {recovery ? `Recover ${amount} from ${statement.org_name}?` : `Pay ${amount} to ${statement.org_name}?`}
            </DialogTitle>
            <DialogDescription className="text-[13px] text-muted-foreground">
              {recovery
                ? <>Refunds on already-settled payments left {statement.org_name} owing Race Pace {amount} for{" "}
                    <span className="font-semibold">{statement.event_name}</span>. Record this once the money has
                    actually come back — it closes the statement and marks those refunds recovered, so they are
                    never deducted again.</>
                : <>Record the transfer for <span className="font-semibold">{statement.event_name}</span>. This
                    closes the statement and stamps every payment it covered, so the same money can never appear
                    in a later statement.</>}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <Label htmlFor="payout-reference" className="text-[12.5px]">
              {recovery ? "Recovery reference" : "Transfer reference"}
            </Label>
            <Input
              id="payout-reference"
              placeholder="e.g. BPI-4471"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="payout-note" className="text-[12.5px]">Note (optional)</Label>
            <Input
              id="payout-note"
              placeholder="Anything worth remembering"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {error ? <span role="alert" className="text-[13px] text-destructive">{error}</span> : null}

          <DialogFooter>
            <Button variant="outline" className="rounded-pill" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button className="rounded-pill" disabled={busy} onClick={submit}>
              {busy ? "Recording…" : verb}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
