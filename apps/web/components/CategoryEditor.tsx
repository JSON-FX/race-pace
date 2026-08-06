"use client";

import { Trash2 } from "lucide-react";
import type { CategoryDraft } from "../lib/actions/events";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Field } from "./form-section";

/**
 * One card per distance, not a row in a table.
 *
 * The table forced six columns to share one width, and at 1280px that clipped
 * real values: a ₱2,100 entry fee rendered as "210" and 1,500 slots as "150" —
 * money and capacity, silently wrong to anyone scanning. A card gives each
 * field a full control, and it is the SAME component on a phone, where the
 * table needed horizontal scrolling.
 *
 * Rendered inside a FormSection, which supplies the heading and the Add action.
 */

const peso = (c: number) => (c / 100).toString();
const cent = (p: string) => Math.round((parseFloat(p) || 0) * 100);
const INPUT = "h-11 rounded-lg text-[13.5px]";

export function CategoryEditor({
  rows, onChange,
}: {
  rows: CategoryDraft[];
  onChange: (r: CategoryDraft[]) => void;
}) {
  const set = (i: number, patch: Partial<CategoryDraft>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  if (rows.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        No distances yet. Add one — an event with no category cannot be registered for.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <div key={r.id ?? r.tempId} className="rounded-xl border border-border p-3.5">
          <div className="mb-3 flex items-center gap-2.5">
            {/* The code doubles as the card's identity, so a director scanning
                five distances can tell them apart without reading every field. */}
            <span className="rounded-md bg-forest px-2.5 py-1 text-[11.5px] font-extrabold uppercase text-white">
              {r.code || "New"}
            </span>
            <span className="truncate text-[13.5px] font-semibold">{r.label || "Untitled distance"}</span>
            <Button
              aria-label={`Remove ${r.label || r.code || "category"}`}
              variant="ghost"
              size="icon"
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
              className="ml-auto size-9 shrink-0 text-destructive hover:bg-destructive-tint hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Code" required>
              <Input
                aria-label="Category code" placeholder="e.g. 21k" className={INPUT}
                value={r.code} onChange={(e) => set(i, { code: e.target.value })}
              />
            </Field>
            <Field label="Label" required>
              <Input
                aria-label="Category label" placeholder="e.g. 21K Trail Run" className={INPUT}
                value={r.label} onChange={(e) => set(i, { label: e.target.value })}
              />
            </Field>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Distance (km)">
              <Input
                aria-label="Distance km" type="number" inputMode="decimal" placeholder="21" className={INPUT}
                value={r.distance_km ?? ""}
                onChange={(e) => set(i, { distance_km: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </Field>
            <Field label="Price (₱)" required>
              <Input
                aria-label="Base price" type="number" inputMode="decimal" step="0.01" placeholder="2100" className={INPUT}
                value={peso(r.base_price)} onChange={(e) => set(i, { base_price: cent(e.target.value) })}
              />
            </Field>
            <Field label="Slots" required>
              <Input
                aria-label="Slots" type="number" inputMode="numeric" placeholder="150" className={INPUT}
                value={r.slots_total} onChange={(e) => set(i, { slots_total: Number(e.target.value) })}
              />
            </Field>
          </div>

          {/* Per-distance detail — all optional. Blank means "not published": the
              public site omits the fact rather than printing a zero, so an empty
              field here must be saved as null, never "". */}
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Elevation gain (m)" hint="Optional">
              <Input
                aria-label="Category elevation gain" type="number" inputMode="numeric"
                placeholder="Leave blank if unknown" className={INPUT}
                value={r.elevation_gain_m ?? ""}
                onChange={(e) => set(i, { elevation_gain_m: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </Field>
            <Field label="Cut-off (hours)" hint="Optional">
              <Input
                aria-label="Category cutoff hours" type="number" inputMode="decimal" step="0.1"
                placeholder="Leave blank if none" className={INPUT}
                value={r.cutoff_hours ?? ""}
                onChange={(e) => set(i, { cutoff_hours: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </Field>
            <Field label="Blurb" hint="Optional">
              <Input
                aria-label="Category blurb" placeholder="e.g. For first-time trail runners" className={INPUT}
                value={r.blurb ?? ""}
                onChange={(e) => set(i, { blurb: e.target.value === "" ? null : e.target.value })}
              />
            </Field>
          </div>
        </div>
      ))}
    </div>
  );
}

/** The section's Add action, exported so FormSection can host it in the header
 *  rather than the card duplicating a heading row. */
export function addCategory(rows: CategoryDraft[]): CategoryDraft[] {
  return [
    ...rows,
    {
      tempId: `t${Date.now()}${rows.length}`,
      code: "", label: "", distance_km: null, base_price: 0, slots_total: 0,
      elevation_gain_m: null, cutoff_hours: null, blurb: null,
    },
  ];
}
