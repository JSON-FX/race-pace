"use client";

import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export type FilterDef = {
  key: string;
  label: string;
  options: { value: string; label: string; count?: number }[];
};

export function FacetedFilter({ def, value, onChange }: {
  def: FilterDef; value: string; onChange: (value: string) => void;
}) {
  const active = def.options.find((o) => o.value === value);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 rounded-lg" aria-label={def.label}>
          {def.label}
          {active ? (
            <span className="ml-1.5 rounded-pill bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">1</span>
          ) : null}
          <ChevronDown className="ml-1 size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <Command>
          {def.options.length > 8 ? <CommandInput placeholder={`Filter ${def.label.toLowerCase()}…`} /> : null}
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              <CommandItem onSelect={() => onChange("all")}>
                <Check className={cn("mr-2 size-4", value === "all" ? "opacity-100" : "opacity-0")} />
                All
              </CommandItem>
              {def.options.map((o) => (
                <CommandItem key={o.value} onSelect={() => onChange(o.value)}>
                  <Check className={cn("mr-2 size-4", value === o.value ? "opacity-100" : "opacity-0")} />
                  <span className="flex-1 truncate">{o.label}</span>
                  {o.count != null ? (
                    <span className="ml-2 font-mono tabular text-xs text-muted-foreground">{o.count}</span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
