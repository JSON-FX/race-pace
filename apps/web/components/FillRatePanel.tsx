import { cn } from "@/lib/utils";
import type { FillRow } from "@/lib/queries/dashboard";

/** Bar colour by how full the event is (mockup: `.fill`, `.fill.warn`,
 *  `.fill.low`). Green means "this one is nearly sold out", amber "filling",
 *  blue "plenty of room" — a status read, not a severity read, which is why
 *  the emptiest events are info-blue rather than red. Nothing here is
 *  actionable-bad, so nothing uses --color-destructive. */
function tone(ratio: number): string {
  if (ratio > 0.8) return "bg-primary";
  if (ratio >= 0.4) return "bg-amber";
  return "bg-info";
}

/**
 * "Fill rate" card body (mockup: tab B, `.bul` rows).
 *
 * One bullet bar per event, sorted fullest-first by the caller. Rows carry the
 * raw `taken / total` alongside the bar because a bar alone cannot be read to
 * a number, and the exact counts are what an organizer decides on.
 */
export function FillRatePanel({ rows }: { rows: FillRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="px-[15px] py-8 text-center text-[13px] text-muted-foreground">
        No event has a slot cap set, so there is no fill rate to show.
      </div>
    );
  }

  return (
    <div>
      {rows.map((r) => {
        const ratio = r.taken / r.total;
        return (
          <div key={r.eventId} className="border-b border-divider px-[15px] py-[11px] last:border-b-0">
            <div className="mb-1.5 flex justify-between gap-3 text-[12.5px] font-semibold">
              <span className="truncate">{r.name}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {r.taken.toLocaleString()} / {r.total.toLocaleString()}
              </span>
            </div>
            {/* The bar is aria-hidden and the row is the progressbar: a screen
                reader gets one labelled percentage instead of an unlabelled
                graphic next to text it has already read. */}
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={r.total}
              aria-valuenow={r.taken}
              aria-label={`${r.name} fill rate`}
              className="h-[7px] overflow-hidden rounded-pill bg-muted"
            >
              <div
                aria-hidden
                className={cn("h-full rounded-pill", tone(ratio))}
                // Oversubscription (slots_taken above slots_total, which the
                // schema permits) is clamped so the bar cannot overflow its
                // track — the `taken / total` text above still tells the truth.
                style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
              />
            </div>
          </div>
        );
      })}
      {/* Says why an event the reader expected is missing. Without this the
          obvious reading of an absent race is "it has no sign-ups". */}
      <p className="border-t border-divider px-[15px] py-2.5 text-[11.5px] text-muted-foreground">
        Events without a slot cap aren&apos;t listed — an uncapped race has no
        fill rate, and showing it at 0% would read as &ldquo;nobody signed up&rdquo;.
      </p>
    </div>
  );
}
