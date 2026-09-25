"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { filterOrganizers, regionsOf, type Organizer } from "@/lib/organizers";
import { OrganizerDirectoryRow } from "@/components/organizers/TrailAtlas";

export function RegionIndex({ regions, selected, onSelect }: { regions: string[]; selected: string; onSelect: (region: string) => void }) {
  return (
    <aside className="trail-atlas__region-rail" aria-label="Explore by region">
      <h2>Explore by region</h2>
      <div className="trail-atlas__region-options" role="group" aria-label="Filter organizers by region">
        {["", ...regions].map((region) => (
          <button
            key={region || "all"}
            type="button"
            aria-pressed={selected === region}
            onClick={() => onSelect(region)}
            className="trail-atlas__region-filter"
          >
            {region || "All regions"}
          </button>
        ))}
      </div>
    </aside>
  );
}

export function OrganizerDirectory({ organizers }: { organizers: Organizer[] }) {
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("");
  const regions = useMemo(() => regionsOf(organizers), [organizers]);
  const shown = useMemo(() => filterOrganizers(organizers, query, region), [organizers, query, region]);

  return (
    <div className="trail-atlas__inner">
      <section className="trail-atlas__heading">
        <div>
          <h1>Find your next race community.</h1>
          <p>Browse organizers by the places they call home, then see their events.</p>
        </div>
        <label className="trail-atlas__search">
          <Search size={19} aria-hidden="true" />
          <span className="sr-only">Search organizers or places</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search organizers or places" autoComplete="off" />
        </label>
      </section>
      <div className="trail-atlas__directory-layout">
        <RegionIndex regions={regions} selected={region} onSelect={setRegion} />
        <section className="trail-atlas__results" aria-label="Organizers">
          <div className="trail-atlas__results-head">
            <span>{region ? `Organizers in ${region}` : "Organizers across the Philippines"}</span>
            <span role="status">{shown.length} {shown.length === 1 ? "organizer" : "organizers"} shown</span>
          </div>
          {shown.length ? shown.map((organizer) => <OrganizerDirectoryRow key={organizer.id} organizer={organizer} />) : (
            <div className="trail-atlas__empty">
              <h2>{organizers.length ? "No organizers found" : "No organizers yet"}</h2>
              <p>{organizers.length ? "Try another name, place, or region." : "Check back as new race communities join Race Pace."}</p>
              {organizers.length && (query || region) ? (
                <button type="button" className="trail-atlas__action trail-atlas__action--secondary" onClick={() => { setQuery(""); setRegion(""); }}>Clear filters</button>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
