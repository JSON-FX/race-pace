"use client";

import { cn } from "@/lib/utils";

/** Same eyebrow rhythm as EventCard's org label / the event page's <Stat> —
 *  11px uppercase, 1.2px tracking — so a select field reads as part of the
 *  same editorial system as everything else in the app, not a bolted-on
 *  form control. */
export function PillSelect({ label, value, options, onChange, error }: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  error?: string;
}) {
  return (
    <fieldset className="mt-6">
      <legend className="text-[11px] font-semibold uppercase tracking-[1.2px] text-muted-foreground">{label}</legend>
      <div className="mt-2.5 flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = value === opt;
          return (
            <button
              key={opt}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(opt)}
              className={cn(
                "rounded-pill border px-4 py-2 text-[14px] transition-colors",
                active
                  ? "border-primary bg-primary font-semibold text-primary-foreground"
                  : "border-border text-foreground hover:border-primary",
              )}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {error ? <p className="mt-2 text-[13px] text-destructive">{error}</p> : null}
    </fieldset>
  );
}
