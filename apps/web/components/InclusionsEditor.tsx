"use client";

import { INCLUSION_MAX_LEN } from "../lib/validation";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Button } from "./ui/button";

const GRID = "grid-cols-[1fr_auto_auto_auto]";

function swap<T>(arr: T[], i: number, j: number): T[] {
  const next = arr.slice();
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

// "What's included" bullets on the public page — a fixed heading with one
// line per row, display-only there. Empty is the current state of every
// event and is valid: the site omits the whole section when the array is
// empty, so organizers add rows over time.
export function InclusionsEditor({ rows, onChange }: { rows: string[]; onChange: (r: string[]) => void }) {
  const set = (i: number, value: string) => onChange(rows.map((r, j) => (j === i ? value : r)));
  const add = () => onChange([...rows, ""]);
  return (
    <Card className="gap-0 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-bold tracking-[-0.01em]">What's included</h2>
        <Button variant="ghost" size="sm" onClick={add} className="h-auto p-0 text-xs font-semibold text-primary hover:bg-transparent">+ Add</Button>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-[13px] text-muted-foreground">No inclusions yet — add the first row to show this section on the public page.</p>
      ) : null}
      {rows.map((r, i) => (
        <div key={i} className={`grid items-center gap-2 border-t border-divider py-2.5 ${GRID}`}>
          <Input
            aria-label="Inclusion"
            placeholder="e.g. Finisher medal and summit certificate"
            maxLength={INCLUSION_MAX_LEN}
            className="h-auto rounded-lg px-2.5 py-[7px] text-[13px]"
            value={r}
            onChange={(e) => set(i, e.target.value)}
          />
          <Button aria-label="Move inclusion up" variant="ghost" size="icon" disabled={i === 0} onClick={() => onChange(swap(rows, i, i - 1))} className="h-auto w-auto p-0 text-sm text-muted-foreground hover:bg-transparent disabled:opacity-30">↑</Button>
          <Button aria-label="Move inclusion down" variant="ghost" size="icon" disabled={i === rows.length - 1} onClick={() => onChange(swap(rows, i, i + 1))} className="h-auto w-auto p-0 text-sm text-muted-foreground hover:bg-transparent disabled:opacity-30">↓</Button>
          <Button aria-label="Remove inclusion" variant="ghost" size="icon" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="h-auto w-auto p-0 text-base text-destructive hover:bg-transparent">×</Button>
        </div>
      ))}
    </Card>
  );
}
