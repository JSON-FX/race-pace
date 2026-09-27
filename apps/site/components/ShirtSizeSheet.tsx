"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { useRef, useState } from "react";
import { ChoiceGroup } from "@race-pace/ui";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { SHIRT_SIZES } from "@race-pace/shared";
import { Button } from "@/components/ui/button";
import { updateShirtSize, kitEditMessage, type KitEditResult } from "@/lib/kit";

/** Bottom sheet opened from RaceKitCard's "Change" button. Success and no-op both close
 *  the sheet via onSaved; every other result (most importantly 'locked' — the runner who
 *  saved just past the cutoff) stays open and shows kitEditMessage instead, so a missed
 *  deadline reads as "sizes are closed", not a generic failure or a silent success. */
export function ShirtSizeSheet({
  registrationId,
  current,
  onClose,
  onSaved,
}: {
  registrationId: string;
  current: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const returnFocus = useRef(typeof document === "undefined" ? null : document.activeElement as HTMLElement | null);
  const [picked, setPicked] = useState(current);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function save() {
    if (!picked) return;
    setSaving(true);
    setMessage(null);
    const result: KitEditResult = await updateShirtSize(registrationId, picked);
    setSaving(false);
    const msg = kitEditMessage(result);
    if (msg) {
      setMessage(msg);
      return;
    }
    onSaved();
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="bottom" className="gap-0 p-5" onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus.current?.focus(); }}>
        <SheetHeader className="p-0">
          <SheetTitle>Shirt size</SheetTitle>
          <SheetDescription>Pick the size you want printed. You can change it until the organiser locks sizes.</SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <ChoiceGroup label="Choose shirt size" value={picked ?? ""} options={SHIRT_SIZES.map((size) => ({ value: size, label: size }))} onValueChange={setPicked} className="grid grid-cols-3" />
        </div>

        {message ? (
          <Alert role="alert" className="mt-4 border px-4 py-3"><AlertDescription>
            {message}
          </AlertDescription></Alert>
        ) : null}

        <div className="mt-5 flex gap-3">
          <Button type="button" variant="outline" className="h-auto flex-1 py-3" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" className="h-auto flex-1 py-3" loading={saving} disabled={!picked} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
