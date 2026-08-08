import type { LucideIcon } from "lucide-react";
import { TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type KpiDelta = {
  text: string;
  /** "positive" renders in --color-paid with a trend icon (mockup's `.d.up`);
   *  "neutral" is a plain muted caption (mockup's `.d.dim`) — used for
   *  non-trend context like "93.4% conversion" or "9 requests · 2 pending",
   *  not just for "no data". */
  tone: "positive" | "neutral";
};

export type KpiCardProps = {
  icon: LucideIcon;
  label: string;
  value: string;
  delta?: KpiDelta;
};

/** One card in the KPI row above the Registrations/Payments tables.
 *  Mirrors the mockup's `.kpi` block exactly (docs/superpowers/specs/
 *  2026-08-06-admin-design-directions.html, tab A, `.kpis` / `.kpi` rules):
 *  rounded-xl bordered card + card shadow, 14/15px padding, a label row
 *  (13px icon + 11px semibold muted text), a 23px semibold value, and an
 *  optional 11.5px semibold delta line. Server component — no client state. */
export function KpiCard({ icon: Icon, label, value, delta }: KpiCardProps) {
  return (
    <Card className="gap-0 rounded-xl border px-[15px] py-[14px] shadow-card">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
        <Icon className="size-[13px]" strokeWidth={2} aria-hidden />
        {label}
      </div>
      <div className="mt-[7px] text-[23px] font-semibold tabular-nums tracking-[-0.02em]">
        {value}
      </div>
      {delta ? (
        <div
          className={cn(
            "mt-1 flex items-center gap-1 text-[11.5px] font-semibold",
            delta.tone === "positive" ? "text-paid" : "text-muted-foreground",
          )}
        >
          {delta.tone === "positive" ? <TrendingUp className="size-3" aria-hidden /> : null}
          {delta.text}
        </div>
      ) : null}
    </Card>
  );
}

/** 2 columns under 760px, 4 at/above — the mockup's breakpoint is not one of
 *  Tailwind's default sizes, hence the arbitrary variant. */
export function KpiRow({ children }: { children: React.ReactNode }) {
  return <div className="mb-[18px] grid grid-cols-2 gap-3 min-[760px]:grid-cols-4">{children}</div>;
}

/** Placeholder for <KpiRow> while its aggregates are in flight. Same grid, same
 *  card chrome and the same 14/15px padding as KpiCard, so nothing shifts when
 *  the real numbers land — the reason this mirrors the card rather than being a
 *  plain grey block. */
export function KpiRowSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div
      className="mb-[18px] grid grid-cols-2 gap-3 min-[760px]:grid-cols-4"
      role="status"
      aria-label="Loading summary"
    >
      {Array.from({ length: cards }).map((_, i) => (
        <Card key={i} className="gap-0 rounded-xl border px-[15px] py-[14px] shadow-card">
          <div className="h-3 w-20 animate-pulse rounded bg-muted" />
          <div className="mt-[9px] h-6 w-24 animate-pulse rounded bg-muted" />
        </Card>
      ))}
    </div>
  );
}
