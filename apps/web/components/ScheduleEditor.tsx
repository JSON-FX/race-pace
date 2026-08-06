"use client";

import type { ScheduleItem } from "../lib/validation";
import { Card } from "./ui/card";
import { Input } from "./ui/input";
import { Button } from "./ui/button";

const head = "text-[10px] font-bold tracking-wide text-muted-foreground uppercase pl-0.5";
const GRID = "grid-cols-[auto_1fr_auto_auto_auto]";

function swap<T>(arr: T[], i: number, j: number): T[] {
  const next = arr.slice();
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

// Race-morning timeline, display-only on the public page. Empty is the current
// state of every event and is valid — organizers add rows over time.
export function ScheduleEditor({ rows, onChange }: { rows: ScheduleItem[]; onChange: (r: ScheduleItem[]) => void }) {
  const set = (i: number, patch: Partial<ScheduleItem>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rows, { time: "", label: "" }]);
  return (
    <Card className="gap-0 p-5">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Race-morning schedule</div>
        <Button variant="ghost" size="sm" onClick={add} className="h-auto p-0 text-xs font-semibold text-primary hover:bg-transparent">+ Add</Button>
      </div>
      {rows.length > 0 ? (
        <div className={`mt-3 grid items-center gap-2 ${GRID}`}>
          <span className={head}>Time</span>
          <span className={head}>Label</span>
          <span />
          <span />
          <span />
        </div>
      ) : (
        <p className="mt-2 text-[13px] text-muted-foreground">No schedule yet — add the first row when the timeline is set.</p>
      )}
      {rows.map((r, i) => (
        <div key={i} className={`grid items-center gap-2 border-t border-border py-2.5 ${GRID}`}>
          <Input aria-label="Schedule time" type="time" className="h-auto w-[110px] rounded-lg px-2.5 py-[7px] text-[13px]" value={r.time} onChange={(e) => set(i, { time: e.target.value })} />
          <Input aria-label="Schedule label" placeholder="e.g. Gun start, 21K and 10K" className="h-auto rounded-lg px-2.5 py-[7px] text-[13px]" value={r.label} onChange={(e) => set(i, { label: e.target.value })} />
          <Button aria-label="Move row up" variant="ghost" size="icon" disabled={i === 0} onClick={() => onChange(swap(rows, i, i - 1))} className="h-auto w-auto p-0 text-sm text-muted-foreground hover:bg-transparent disabled:opacity-30">↑</Button>
          <Button aria-label="Move row down" variant="ghost" size="icon" disabled={i === rows.length - 1} onClick={() => onChange(swap(rows, i, i + 1))} className="h-auto w-auto p-0 text-sm text-muted-foreground hover:bg-transparent disabled:opacity-30">↓</Button>
          <Button aria-label="Remove schedule row" variant="ghost" size="icon" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="h-auto w-auto p-0 text-base text-destructive hover:bg-transparent">×</Button>
        </div>
      ))}
    </Card>
  );
}
