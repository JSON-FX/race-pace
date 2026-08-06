"use client";

import { useEffect, useRef, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { FacetedFilter, type FilterDef } from "./faceted-filter";

export function DataTableToolbar({
  filterDefs, activeFilters, q, searchPlaceholder, columnToggles,
  onFilterChange, onSearchChange,
}: {
  filterDefs: FilterDef[];
  activeFilters: Record<string, string>;
  q: string;
  searchPlaceholder: string;
  columnToggles: { id: string; label: string; visible: boolean; toggle: () => void }[];
  onFilterChange: (key: string, value: string) => void;
  onSearchChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(q);

  // `lastSyncedRef` holds whichever value the draft and the outside world
  // last agreed on — either the last thing we sent via onSearchChange, or
  // the last external `q` we adopted (chip removal, Back button, a filter
  // reset that also clears q). Comparing against it lets the two effects
  // below tell "the user typed something new" apart from "our own update
  // echoed back down as a prop", so they don't ping-pong each other.
  const lastSyncedRef = useRef(q);
  const onSearchRef = useRef(onSearchChange);
  onSearchRef.current = onSearchChange;

  // Re-sync when q changes for a reason other than our own debounced send
  // (DataTable stays mounted across soft navigation, so this prop can change
  // under us at any time).
  useEffect(() => {
    if (q !== lastSyncedRef.current) {
      lastSyncedRef.current = q;
      setDraft(q);
    }
  }, [q]);

  // Debounce so typing does not push a history entry per keystroke. Skips
  // when draft already matches the last synced value — true on mount, and
  // true right after the effect above pulls draft back in line with an
  // external q change, which is what stops that change from bouncing
  // straight back out as a redundant onSearchChange call.
  useEffect(() => {
    if (draft === lastSyncedRef.current) return;
    const id = setTimeout(() => {
      lastSyncedRef.current = draft;
      onSearchRef.current(draft);
    }, 300);
    return () => clearTimeout(id);
  }, [draft]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label="Search" placeholder={searchPlaceholder} className="h-9 w-[220px] rounded-lg pl-8"
          value={draft} onChange={(e) => setDraft(e.target.value)} />
      </div>

      {filterDefs.map((def) => (
        <FacetedFilter key={def.key} def={def}
          value={activeFilters[def.key] ?? "all"}
          onChange={(v) => onFilterChange(def.key, v)} />
      ))}

      {columnToggles.length > 0 ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="ml-auto h-9 rounded-lg" aria-label="Toggle columns">
              <SlidersHorizontal className="size-3.5" />
              Columns
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-48 space-y-2 p-3">
            {columnToggles.map((c) => (
              <div key={c.id} className="flex items-center gap-2">
                <Checkbox id={`col-${c.id}`} checked={c.visible} onCheckedChange={c.toggle} />
                <Label htmlFor={`col-${c.id}`} className="text-[13px] font-normal">{c.label}</Label>
              </div>
            ))}
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}
