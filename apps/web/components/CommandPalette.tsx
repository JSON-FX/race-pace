"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, CalendarDays } from "lucide-react";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandShortcut,
} from "@/components/ui/command";
import { visibleOrgItems, visibleSuperItems } from "@/lib/nav-items";
import { searchEvents, type EventSearchResult } from "@/lib/actions/search";
import type { MyRoles } from "@/lib/queries/roles";

const EVENT_SEARCH_DEBOUNCE_MS = 300;

/**
 * The topbar's ⌘K search trigger + the CommandDialog it opens. Kept as one
 * component (rather than a separate trigger + a context-driven dialog)
 * because nothing else in the app needs to open the palette — TopBar just
 * renders <CommandPalette roles={roles} />.
 *
 * Offers two groups:
 *  - Navigation, gated through lib/nav-items.ts's visibleOrgItems/
 *    visibleSuperItems — the SAME functions Sidebar.tsx uses, so the
 *    palette can never offer a destination the sidebar itself would hide.
 *  - Events, server-searched (lib/actions/search.ts's searchEvents) and
 *    debounced so the org-scoped Supabase query does not fire on every
 *    keystroke.
 */
export function CommandPalette({ roles }: { roles: MyRoles }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [events, setEvents] = useState<EventSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (!trimmed) {
      setEvents([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    const id = ++requestIdRef.current;
    debounceRef.current = setTimeout(() => {
      searchEvents(trimmed)
        .then((results) => {
          // Stale-response guard: only the latest debounced request may
          // write to state, so a slow early response can't clobber a
          // faster later one and show results for the wrong query.
          if (requestIdRef.current === id) setEvents(results);
        })
        .finally(() => {
          if (requestIdRef.current === id) setSearching(false);
        });
    }, EVENT_SEARCH_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setEvents([]);
  }, []);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  const navItems = [...visibleOrgItems(roles), ...visibleSuperItems(roles)];

  return (
    <>
      <button
        type="button"
        aria-label="Open search (command palette)"
        onClick={() => setOpen(true)}
        className="flex min-w-[180px] items-center gap-2 rounded-lg border border-border bg-card px-[11px] py-2 text-[13px] text-muted-foreground transition-colors hover:bg-muted"
      >
        <Search className="size-[15px] shrink-0" strokeWidth={2} />
        <span className="flex-1 text-left">Search…</span>
        <kbd className="rounded-md border border-border px-[5px] py-px font-mono text-[11px] text-muted-foreground">
          ⌘K
        </kbd>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={(v) => (v ? setOpen(true) : close())}
        title="Command palette"
        description="Jump to a page or an event"
      >
        <CommandInput placeholder="Jump to a page or an event…" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>{searching ? "Searching…" : "No results found."}</CommandEmpty>

          <CommandGroup heading="Navigation">
            {navItems.map((item) => (
              <CommandItem key={item.to} value={item.label} onSelect={() => go(item.to)}>
                <item.icon />
                <span>{item.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>

          {events.length > 0 ? (
            <CommandGroup heading="Events">
              {events.map((event) => (
                <CommandItem
                  key={event.id}
                  value={`event-${event.id}-${event.name}`}
                  onSelect={() => go(`/events/${event.id}/edit`)}
                >
                  <CalendarDays />
                  <span>{event.name}</span>
                  <CommandShortcut>Edit</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </CommandDialog>
    </>
  );
}
