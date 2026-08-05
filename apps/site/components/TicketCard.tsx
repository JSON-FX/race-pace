"use client";

import { QRCodeSVG } from "qrcode.react";
import { longDate } from "@/lib/format";

/**
 * The one screen a runner opens at a dark trailhead with cold hands — legible
 * over decorated. It's built as a real die-cut boarding pass: an identity
 * band, a perforated tear-line with the same two notches TicketStub already
 * uses (register → pay → here, one continuous ticket, not three unrelated
 * cards), then a scan zone and a runner-detail stub. The perforation is the
 * only flourish; nothing else competes with it or with the QR.
 */
export function TicketCard({
  token,
  eventName,
  categoryLabel,
  eventDate,
  reference,
  runnerName,
  bibName,
  distanceKm,
}: {
  token: string;
  eventName: string;
  categoryLabel: string;
  eventDate: string | null;
  reference: string;
  runnerName: string | null;
  bibName: string | null;
  distanceKm: number | null;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      {/* Identity band */}
      <div className="bg-forest px-7 pt-7 pb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#7FE0A6]">Race pass</p>
        <h1 className="mt-2 font-display text-[26px] font-extrabold leading-[1.15] tracking-[-0.4px] text-white">
          {eventName}
        </h1>
        {eventDate ? <p className="mt-2 text-[14px] text-white/70">{longDate(eventDate)}</p> : null}
      </div>

      {/* Die-cut perforation — the same tear-line TicketStub uses on the
          register and pay steps, stretched full width. The two circles sit
          on the forest/card seam and are colored to match the page behind
          the card, so they read as holes actually punched through it. */}
      <div className="relative h-5 bg-forest">
        <div className="absolute inset-x-7 top-1/2 border-t-2 border-dashed border-white/25" />
        <span aria-hidden className="absolute -left-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-background" />
        <span aria-hidden className="absolute -right-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-background" />
      </div>

      {/* Scan zone */}
      <div className="flex flex-col items-center px-7 pb-8 pt-6">
        {/* White quiet zone is required — scanners fail against a dark
            surface, and this card can render in dark mode. Fixed white,
            never `bg-card`, so the QR stays scannable regardless of theme. */}
        <div className="rounded-xl border border-border bg-white p-4">
          <QRCodeSVG value={token} size={180} level="Q" />
        </div>
        <p className="mt-4 font-mono text-[15px] font-semibold tracking-[2px] text-foreground">{reference}</p>
        <p className="mt-1 text-center text-[13px] text-muted-foreground">Show this QR at check-in</p>
      </div>

      {/* Runner stub */}
      <dl className="grid grid-cols-2 gap-px border-t border-border bg-border">
        <Cell label="Runner" value={runnerName || "—"} />
        <Cell label="Bib" value={bibName || reference} />
        <Cell label="Category" value={categoryLabel} />
        <Cell label="Distance" value={distanceKm ? `${distanceKm} KM` : "—"} />
      </dl>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-5 py-4">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.6px] text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-[16px] font-semibold text-foreground">{value}</dd>
    </div>
  );
}
