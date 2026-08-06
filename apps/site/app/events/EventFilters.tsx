"use client";

import Link from "next/link";
import {
  DISTANCE_BANDS, EMPTY_FILTERS, filtersToQuery, hasAnyFilter, toggle,
  type BandKey, type EventFilters as Filters, type Terrain,
} from "@/lib/eventFilters";
import { cn } from "@/lib/utils";

/**
 * The filter chips.
 *
 * Every chip is a plain <Link> to the same route with a different query, not
 * a button that mutates state. Three things fall out of that for free: the
 * filtered view is shareable, Back steps through filter changes the way a
 * runner expects, and the page keeps working before hydration. The server
 * does the filtering, so there is no client copy of the rule to drift.
 */

const TERRAINS: { key: Terrain; label: string }[] = [
  { key: "trail", label: "Trail" },
  { key: "road", label: "Road" },
];

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-pressed={active}
      className={cn(
        "rounded-pill border px-3.5 py-2 text-[12.5px] font-semibold transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

export function EventFilters({
  filters,
  provinces,
}: {
  filters: Filters;
  provinces: string[];
}) {
  const to = (next: Filters) => `/events${filtersToQuery(next)}`;
  const any = hasAnyFilter(filters);

  return (
    <div className="flex flex-wrap gap-2">
      <Chip href={to(EMPTY_FILTERS)} active={!any}>
        All
      </Chip>

      {DISTANCE_BANDS.map((b) => (
        <Chip
          key={b.key}
          href={to({ ...filters, bands: toggle<BandKey>(filters.bands, b.key) })}
          active={filters.bands.includes(b.key)}
        >
          {b.label}
        </Chip>
      ))}

      {TERRAINS.map((t) => (
        <Chip
          key={t.key}
          href={to({ ...filters, terrain: toggle<Terrain>(filters.terrain, t.key) })}
          active={filters.terrain.includes(t.key)}
        >
          {t.label}
        </Chip>
      ))}

      {/* Province is single-select: clicking the active one clears it, which
          is the only way to get back to "anywhere" without the All chip. */}
      {provinces.map((p) => (
        <Chip
          key={p}
          href={to({ ...filters, province: filters.province === p ? null : p })}
          active={filters.province === p}
        >
          {p}
        </Chip>
      ))}
    </div>
  );
}
