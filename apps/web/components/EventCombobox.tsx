"use client";


import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { searchEvents, type SearchableEvent } from "@/lib/event-search";
import { cn } from "@/lib/utils";

/**
 * A searchable event picker.
 *
 * A plain <Select> is fine for the five events a new organizer has and unusable
 * at the hundred an established one accumulates — the list becomes a scroll
 * hunt, and at a start line that is where someone checks a runner into the
 * wrong race. This filters as you type.
 *
 * Command supplies keyboard behavior while explicit ids announce external filtering.
 * searchEvents remains the only matching rule; fuzzy scoring must never choose
 * a different event at the start line.
 *
 * The list is windowed to MAX_VISIBLE results so a 500-event org does not mount
 * 500 rows on open; the count line tells the operator when their query is too
 * broad rather than silently hiding matches.
 */

const MAX_VISIBLE = 50;

export type EventComboboxProps<T extends SearchableEvent> = {
  events: T[];
  value: string | null;
  onSelect: (id: string) => void;
  placeholder?: string;
  /** Accessible name for the trigger — each call site describes its own action. */
  label: string;
  className?: string;
  disabled?: boolean;
  /** Renders the trigger as busy during a pending navigation. Distinct from
   *  `disabled`: the control stays operable, it just reports that the last
   *  selection is still in flight. */
  busy?: boolean;
};

export function EventCombobox<T extends SearchableEvent>({
  events, value, onSelect, placeholder = "Choose an event…", label, className, disabled, busy,
}: EventComboboxProps<T>) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeOption, setActiveOption] = React.useState("");
  const optionId = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const matches = React.useMemo(() => searchEvents(events, query), [events, query]);
  const visible = matches.slice(0, MAX_VISIBLE);
  const activeId = visible.some(event => event.id === activeOption) ? activeOption : visible[0]?.id ?? "";
  const selected = events.find((e) => e.id === value) ?? null;

  // Reopening with a stale query would show a filtered list the operator did not
  // type, so the box always opens clean.
  React.useEffect(() => {
    if (open) {
      setQuery("");
    }
  }, [open]);

  function choose(id: string) {
    onSelect(id);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          aria-busy={!!busy}
          disabled={disabled}
          className={cn(
            "h-9 justify-between gap-2",
            busy && "opacity-70",
            className,
          )}
        >
          <span className={cn("truncate", !selected && "font-normal text-muted-foreground")}>
            {selected ? selected.name : placeholder}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0"
        onOpenAutoFocus={(e) => {
          // Focus the search box, not the first row — the operator came here to
          // type. Radix would otherwise focus the popover container.
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <Command label="Search events" shouldFilter={false} value={activeId} onValueChange={setActiveOption}>
          {/* Own ids also cover external filtering before cmdk receives a key event. */}
          <CommandInput asChild ref={inputRef} value={query} onValueChange={setQuery}>
            <Input placeholder="Search events…" aria-label="Search events" aria-activedescendant={activeId ? `${optionId}-${activeId}` : undefined} className="border-0 shadow-none focus-visible:ring-0" />
          </CommandInput>
          <CommandList className="max-h-[280px] p-1">
            <CommandEmpty>No event matches “{query}”.</CommandEmpty>
            {visible.map((event) => (
              <CommandItem asChild key={event.id} value={event.id} onSelect={choose}><div id={`${optionId}-${event.id}`}>
                <Check className={cn("size-3.5 shrink-0 text-primary", event.id !== value && "opacity-0")} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{event.name}</span>
                  {event.subtitle ? <span className="block truncate text-xs text-muted-foreground">{event.subtitle}</span> : null}
                </span>
              </div></CommandItem>
            ))}
          </CommandList>
        </Command>

        {matches.length > MAX_VISIBLE ? (
          <p className="border-t px-3 py-2 text-[11.5px] text-muted-foreground">
            Showing {MAX_VISIBLE} of {matches.length} — keep typing to narrow.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
