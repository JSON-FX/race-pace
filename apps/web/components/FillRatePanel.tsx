import type { FillRow } from "@/lib/queries/dashboard";

/** Compact capacity readout for capped races. The server sorts fullest first. */
export function FillRatePanel({ rows }: { rows: FillRow[] }) {
  if (rows.length === 0) {
    return <p className="px-4 py-5 text-[13px] text-muted-foreground">No races have a place limit yet.</p>;
  }

  return (
    <div>
      <div className="fieldnotes-capacity">
        {rows.map((row) => {
          const fraction = row.total > 0 ? row.taken / row.total : 0;
          const percent = Math.round(fraction * 100);
          const open = Math.max(0, row.total - row.taken);
          return <div key={row.eventId} className="fieldnotes-capacity__row">
            <div className="fieldnotes-capacity__top">
              <span className="fieldnotes-capacity__name" title={row.name}>{row.name}</span>
              <span className="fieldnotes-capacity__percent">{percent}%</span>
            </div>
            <div className="fieldnotes-capacity__track" role="progressbar" aria-label={`${row.name} places filled`} aria-valuemin={0} aria-valuemax={row.total} aria-valuenow={Math.min(row.taken, row.total)} aria-valuetext={`${row.taken} of ${row.total} places filled`}>
              <span aria-hidden style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
            </div>
            <div className="fieldnotes-capacity__meta">
              <span>{row.taken.toLocaleString()} of {row.total.toLocaleString()} places filled</span>
              <span>{open > 0 ? `${open.toLocaleString()} open` : "Full"}</span>
            </div>
          </div>;
        })}
      </div>
      <p className="fieldnotes-capacity__note">Only races with a place limit are shown.</p>
    </div>
  );
}
