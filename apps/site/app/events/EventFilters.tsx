"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DISTANCE_BANDS, EMPTY_FILTERS, filtersToQuery, hasAnyFilter, toggle,
  type BandKey, type EventFilters as Filters, type Terrain,
} from "@/lib/eventFilters";

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
  children: string;
}) {
  return (
    <Link
      href={href}
      aria-label={`${children} filter, ${active ? "selected" : "not selected"}`}
      className="fieldnotes-events__chip"
      data-active={active}
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
  const router = useRouter();
  const [query, setQuery] = useState(filters.query ?? "");
  const to = (next: Filters) => `/events${filtersToQuery(next)}`;
  const any = hasAnyFilter(filters);
  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    router.push(to({ ...filters, query: query.trim().slice(0, 100) || null }));
  };

  return (
    <>
    <form className="fieldnotes-events__search" role="search" action="/events" method="get" onSubmit={search}>
      {filters.bands.length ? <input type="hidden" name="distance" value={filters.bands.join(",")} /> : null}
      {filters.terrain.length ? <input type="hidden" name="terrain" value={filters.terrain.join(",")} /> : null}
      {filters.province ? <input type="hidden" name="province" value={filters.province} /> : null}
      <label htmlFor="race-search">Search races and places</label>
      <div className="fieldnotes-events__search-row">
        <div className="fieldnotes-events__search-field">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></svg>
          <input id="race-search" name="q" type="search" placeholder="Race name, organizer, or place" value={query} maxLength={100} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <button type="submit">Search races</button>
      </div>
      {filters.query ? <Link className="fieldnotes-events__search-clear" href={to({ ...filters, query: null })}>Clear search</Link> : null}
    </form>
    <div className="fieldnotes-events__chips">
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
    </>
  );
}
