"use client";

import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type BulkAction = {
  label: string;
  icon?: LucideIcon;
  variant?: "default" | "destructive";
  onSelect: (ids: string[]) => void;
  /** Renders the button non-interactive with a tooltip explaining why,
   *  instead of wiring it to a backend that doesn't exist yet — see
   *  task-v3-report.md ("bulk actions: real vs disabled"). A disabled
   *  action must still be honest about *why* it's disabled, not just
   *  greyed out with no explanation. */
  disabled?: boolean;
  disabledReason?: string;
};

export function BulkBar({ count, ids, actions, onClear }: {
  count: number; ids: string[]; actions: BulkAction[]; onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-divider bg-accent px-4 py-2.5">
      <span className="text-[13px] font-semibold text-accent-foreground">{count} selected</span>
      {actions.map((a) => {
        const button = (
          <Button key={a.label} size="sm" variant={a.variant === "destructive" ? "destructive" : "outline"}
            className="h-8 rounded-lg" disabled={a.disabled} aria-disabled={a.disabled}
            onClick={a.disabled ? undefined : () => a.onSelect(ids)}>
            {a.icon ? <a.icon className="size-3.5" /> : null}
            {a.label}
          </Button>
        );
        if (!a.disabled || !a.disabledReason) return button;
        return (
          <TooltipProvider key={a.label}>
            <Tooltip>
              <TooltipTrigger asChild><span>{button}</span></TooltipTrigger>
              <TooltipContent>{a.disabledReason}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      })}
      <Button variant="ghost" size="sm" className="ml-auto h-8 text-xs text-muted-foreground" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}
