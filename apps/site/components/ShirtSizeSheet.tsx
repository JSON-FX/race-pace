"use client";

import { useState } from "react";
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
    <div className="fixed inset-0 z-50 flex items-end bg-black/50" role="dialog" aria-label="Change shirt size">
      <div className="w-full rounded-t-2xl bg-card p-5">
        <h2 className="text-[17px] font-semibold text-foreground">Shirt size</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Pick the size you want printed. You can change it until the organiser locks sizes.
        </p>

        {/* min-h-11 (44px) keeps every option at the minimum touch target — this is a
            mobile-first page and small pills are a mis-tap generator. */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {SHIRT_SIZES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={picked === s}
              onClick={() => setPicked(s)}
              className={`min-h-11 rounded-xl border text-[15px] font-semibold ${
                picked === s
                  ? "border-accent bg-accent text-accent-foreground"
                  : "border-border text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {message ? (
          <p role="alert" className="mt-4 rounded-xl border border-amber bg-amber-tint px-4 py-3 text-[13px] text-foreground">
            {message}
          </p>
        ) : null}

        <div className="mt-5 flex gap-3">
          <Button type="button" variant="outline" className="h-auto flex-1 rounded-pill py-3" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" className="h-auto flex-1 rounded-pill py-3" disabled={saving || !picked} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
