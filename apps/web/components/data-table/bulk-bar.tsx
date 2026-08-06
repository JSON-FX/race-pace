"use client";

import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export type BulkAction = {
  label: string;
  icon?: LucideIcon;
  variant?: "default" | "destructive";
  onSelect: (ids: string[]) => void;
};

export function BulkBar({ count, ids, actions, onClear }: {
  count: number; ids: string[]; actions: BulkAction[]; onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-accent px-4 py-2.5">
      <span className="text-[13px] font-semibold text-accent-foreground">{count} selected</span>
      {actions.map((a) => (
        <Button key={a.label} size="sm" variant={a.variant === "destructive" ? "destructive" : "outline"}
          className="h-8 rounded-lg" onClick={() => a.onSelect(ids)}>
          {a.icon ? <a.icon className="size-3.5" /> : null}
          {a.label}
        </Button>
      ))}
      <Button variant="ghost" size="sm" className="ml-auto h-8 text-xs text-muted-foreground" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
