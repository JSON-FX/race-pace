"use client";

import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SearchableComboboxOption = {
  value: string;
  label: string;
  description?: string;
  keywords?: string[];
  badge?: string;
};

export type SearchableComboboxProps = {
  options: SearchableComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  /** Optional form field. A hidden input keeps Server Action payloads unchanged. */
  name?: string;
  id?: string;
  ariaLabel: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  className?: string;
};

/**
 * A form-aware searchable picker for moderate option sets.
 *
 * Product-specific selectors can map their records into label, description,
 * keywords, and badge fields without teaching this UI primitive about events,
 * waivers, or any other domain. Large operational lists that need deterministic
 * matching or windowing should keep their dedicated picker.
 */
export function SearchableCombobox({
  options,
  value,
  onValueChange,
  name,
  id,
  ariaLabel,
  placeholder = "Choose an option",
  searchPlaceholder = "Search options…",
  emptyText = "No matching results.",
  disabled,
  required,
  invalid,
  className,
}: SearchableComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((option) => option.value === value);

  function select(nextValue: string) {
    onValueChange(nextValue === value ? "" : nextValue);
    setOpen(false);
  }

  return (
    <>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={open}
            aria-required={required || undefined}
            aria-invalid={invalid || undefined}
            disabled={disabled}
            className={cn(
              "h-11 w-full justify-between rounded-[10px] bg-background px-3 font-normal shadow-xs",
              "hover:border-primary/40 hover:bg-muted/40 data-[state=open]:border-ring data-[state=open]:ring-[3px] data-[state=open]:ring-ring/20",
              className,
            )}
          >
            <span className={cn("truncate text-left", !selected && "text-muted-foreground")}>
              {selected?.label ?? placeholder}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] min-w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl p-0 shadow-lg"
        >
          <Command label={searchPlaceholder}>
            <CommandInput placeholder={searchPlaceholder} className="h-11" />
            <CommandList className="max-h-64 p-1">
              <CommandEmpty className="px-3 py-8 text-center text-[13px] text-muted-foreground">
                {emptyText}
              </CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    keywords={[option.label, option.description ?? "", ...(option.keywords ?? [])]}
                    onSelect={select}
                    className="min-h-12 cursor-pointer rounded-lg px-2.5 py-2"
                  >
                    <Check
                      className={cn("size-4 text-primary", value !== option.value && "opacity-0")}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{option.label}</span>
                      {option.description ? (
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                    {option.badge ? (
                      <Badge variant="secondary" className="text-[9px] font-bold uppercase tracking-wide">
                        {option.badge}
                      </Badge>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  );
}
