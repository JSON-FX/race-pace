"use client";

import { useId } from "react";
import type { CategoryDraft } from "@/lib/actions/events";
import { toLocalInput, fromLocalInput } from "@/lib/deadlines";
import { Field } from "./form-section";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Switch } from "./ui/switch";
import { Label } from "./ui/label";
import { InclusionsEditor } from "./InclusionsEditor";

export function CategorySettings({ category: c, onChange }: { category: CategoryDraft; onChange: (patch: Partial<CategoryDraft>) => void }) {
  const id = useId();
  const reserved = c.reservation_slots ?? 0;
  const general = c.slots_total - (c.reservation_enabled ? reserved : 0);
  return <div className="mt-5 space-y-5">
    <section className="space-y-4 border-t border-divider pt-5" aria-labelledby={`${id}-reservation-label`}>
      <div className="flex items-start justify-between gap-4">
        <div><Label id={`${id}-reservation-label`} htmlFor={`${id}-reservations`} className="font-semibold">Enable reservations</Label>
          <p className="mt-1 text-xs text-muted-foreground">Let runners secure this category before paying the entry fee.</p></div>
        <Switch id={`${id}-reservations`} checked={c.reservation_enabled ?? false} aria-controls={`${id}-reservation-settings`}
          onCheckedChange={checked => onChange({ reservation_enabled: checked })} />
      </div>
      {c.reservation_enabled && <div id={`${id}-reservation-settings`} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Reservation slots" required hint="Included in the total slots above.">
            <Input aria-label="Reservation slots" type="number" min={1} max={c.slots_total} step={1} value={reserved}
              onChange={e => onChange({ reservation_slots: Number(e.target.value) })} />
          </Field>
          <Field label="Reservation fee (₱)" required hint="Separate from the full entry price.">
            <Input aria-label="Category reservation fee" type="number" min="0.01" step="0.01" value={c.reservation_fee_cents == null ? "" : c.reservation_fee_cents / 100}
              onChange={e => onChange({ reservation_fee_cents: e.target.value ? Math.round(Number(e.target.value) * 100) : null })} />
          </Field>
        </div>
        <div aria-live="polite" className="space-y-2 text-xs">
          <p>{c.slots_total} total − {reserved} reservation = <strong>{general} general slots</strong></p>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className="h-full bg-forest" style={{ width: `${Math.max(0, Math.min(100, general / Math.max(1, c.slots_total) * 100))}%` }} /></div>
          {general < 0 && <p className="text-destructive">Reservation slots cannot exceed category capacity.</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Reservation sales close" required hint="Unsold reservation slots become general slots.">
            <Input aria-label="Reservation sales close" type="datetime-local" value={toLocalInput(c.reservation_sales_close_at ?? null)}
              onChange={e => onChange({ reservation_sales_close_at: fromLocalInput(e.target.value) })} />
          </Field>
          <Field label="Full entry payment due" required hint="Unpaid reservations expire after this deadline.">
            <Input aria-label="Full entry payment due" type="datetime-local" value={toLocalInput(c.entry_payment_deadline_at ?? null)}
              onChange={e => onChange({ entry_payment_deadline_at: fromLocalInput(e.target.value) })} />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">Times are in Asia/Manila. Reservations can remain available while registration is open.</p>
        <p className="rounded-lg bg-muted p-3 text-xs leading-relaxed">The reservation fee is <strong>nonrefundable</strong> and is not deducted from the entry fee. Platform and processing fees are additional.</p>
      </div>}
    </section>
    <section className="border-t border-divider pt-5">
      <InclusionsEditor rows={c.inclusions ?? []} onChange={inclusions => onChange({ inclusions })} embedded />
    </section>
    <section className="space-y-4 border-t border-divider pt-5">
      <div className="flex items-start justify-between gap-4">
        <div><Label htmlFor={`${id}-screening`} className="font-semibold">Require pre-screening</Label>
          <p className="mt-1 text-xs text-muted-foreground">Review each runner’s proof before they can pay.</p></div>
        <Switch id={`${id}-screening`} checked={c.prescreening_enabled ?? false} aria-controls={`${id}-screening-settings`}
          onCheckedChange={checked => onChange({ prescreening_enabled: checked })} />
      </div>
      {c.prescreening_enabled && <div id={`${id}-screening-settings`} className="space-y-3">
        <Field label="Pre-screening requirement" required hint="Tell runners what qualifies and which proof to upload.">
          <Textarea aria-label="Pre-screening requirement" rows={3} maxLength={4000} value={c.prescreening_requirement ?? ""}
            placeholder="Complete a trail race of at least 50 km. Upload a finisher certificate or official results showing your name and distance."
            onChange={e => onChange({ prescreening_requirement: e.target.value || null })} />
        </Field>
        <p className="text-xs text-muted-foreground">One JPEG, PNG, or WebP image per Passport, up to 10 MB and 20 megapixels. Runners may add an optional explanation.</p>
        <p className="rounded-lg bg-muted p-3 text-xs leading-relaxed">Submitting holds every selected slot for free. The group pays only after all required reviews are approved. Existing registrations stay valid.</p>
      </div>}
    </section>
  </div>;
}
