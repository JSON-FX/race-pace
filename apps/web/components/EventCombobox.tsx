"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
 * Deliberately NOT cmdk/<Command>, despite it being available and used by the ⌘K
 * palette: cmdk applies its own fuzzy scoring to every item, which would
 * reintroduce the exact wrong-event risk `searchEvents` is written to avoid (see
 * its doc comment). Owning the list keeps one predictable matching rule.
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
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const matches = React.useMemo(() => searchEvents(events, query), [events, query]);
  const visible = matches.slice(0, MAX_VISIBLE);
  const selected = events.find((e) => e.id === value) ?? null;

  // Reopening with a stale query would show a filtered list the operator did not
  // type, so the box always opens clean.
  React.useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
    }
  }, [open]);

  // Keep the highlighted row in view when arrowing past the fold.
  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(id: string) {
    onSelect(id);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (visible.length === 0) return;
      setActive((i) => {
        const next = e.key === "ArrowDown" ? i + 1 : i - 1;
        return (next + visible.length) % visible.length; // wrap, so held-down arrow never dead-ends
      });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = visible[active];
      if (pick) choose(pick.id);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
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
            "h-9 justify-between gap-2 rounded-lg font-semibold",
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
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-3.5 shrink-0 opacity-50" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            placeholder="Search events…"
            aria-label="Search events"
            aria-controls="event-combobox-list"
            className="h-10 w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div
          ref={listRef}
          id="event-combobox-list"
          role="listbox"
          aria-label={label}
          className="max-h-[280px] overflow-y-auto p-1"
        >
          {visible.length === 0 ? (
            <p className="px-3 py-6 text-center text-[12.5px] text-muted-foreground">
              No event matches “{query}”.
            </p>
          ) : (
            visible.map((e, i) => (
              <button
                key={e.id}
                type="button"
                role="option"
                aria-selected={e.id === value}
                data-active={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(e.id)}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px]",
                  i === active && "bg-accent text-accent-foreground",
                )}
              >
                <Check
                  className={cn("size-3.5 shrink-0 text-primary", e.id !== value && "opacity-0")}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{e.name}</span>
                  {e.subtitle ? (
                    <span className="block truncate text-[11.5px] text-muted-foreground">{e.subtitle}</span>
                  ) : null}
                </span>
              </button>
            ))
          )}
        </div>

        {matches.length > MAX_VISIBLE ? (
          <p className="border-t px-3 py-2 text-[11.5px] text-muted-foreground">
            Showing {MAX_VISIBLE} of {matches.length} — keep typing to narrow.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
