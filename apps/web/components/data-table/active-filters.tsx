"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FilterDef } from "./faceted-filter";

export function ActiveFilters({ defs, active, q, onRemove, onClearAll }: {
  defs: FilterDef[];
  active: Record<string, string>;
  q: string;
  onRemove: (key: string) => void;
  onClearAll: () => void;
}) {
  const chips = defs
    .map((def) => {
      const value = active[def.key];
      if (!value || value === "all") return null;
      const label = def.options.find((o) => o.value === value)?.label ?? value;
      return { key: def.key, text: `${def.label}: ${label}`, aria: `Remove ${def.label} filter` };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  if (q) chips.push({ key: "q", text: `Search: ${q}`, aria: "Remove search filter" });
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chips.map((c) => (
        <span key={c.key}
          className="inline-flex items-center gap-1.5 rounded-pill bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground">
          {c.text}
          <button type="button" aria-label={c.aria} onClick={() => onRemove(c.key)}
            className="opacity-60 transition-opacity hover:opacity-100">
            <X className="size-3" />
          </button>
        </span>
      ))}
      <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={onClearAll}>
        Clear all
      </Button>
    </div>
  );
}
