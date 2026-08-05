import Link from "next/link";
import { formatPeso } from "@race-pace/shared";
import type { CategoryRow } from "@/lib/events";
import { cn } from "@/lib/utils";

const SCARCE_THRESHOLD = 15;

/**
 * `route` discipline distances — framed by who they're for and the cut-off,
 * not how brutal the climb is. Cards share a baseline grid: a reserved flag
 * slot (rendered `invisible` rather than omitted, so the distance number
 * starts at the same height on every card), a blurb, an optional cut-off
 * row, and the price/CTA pinned to the bottom with `mt-auto` — CSS Grid's
 * row-stretch does the rest, so cards align even when one has no blurb and
 * another does.
 */
export function RouteDistances({ categories, closed }: { categories: CategoryRow[]; closed: boolean }) {
  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto w-full max-w-5xl px-6">
        <p className="font-eyebrow text-[12px] font-bold uppercase tracking-[3px] text-primary">Pick your distance</p>
        <h2 className="mt-2 font-display text-[clamp(1.6rem,3.2vw,2.4rem)] font-black leading-[1] tracking-[-0.5px] text-foreground">
          Everyone finishes on the same street.
        </h2>

        {categories.length === 0 ? (
          <p className="mt-8 text-muted-foreground">Distances haven&apos;t been published yet.</p>
        ) : (
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {categories.map((c) => (
              <DistanceCard key={c.id} category={c} closed={closed} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function DistanceCard({ category, closed }: { category: CategoryRow; closed: boolean }) {
  const soldOut = category.slots_taken >= category.slots_total;
  const remaining = Math.max(0, category.slots_total - category.slots_taken);
  const enterable = !soldOut && !closed;
  const scarce = !soldOut && remaining > 0 && remaining <= SCARCE_THRESHOLD;

  return (
    <div className="flex h-full flex-col rounded-[20px] border border-border bg-card p-6 transition-shadow hover:shadow-lg">
      <span
        className={cn(
          "mb-3 inline-flex w-fit items-center rounded-pill px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[1.4px]",
          scarce ? "bg-coral-tint text-coral" : "invisible",
        )}
      >
        {scarce ? `${remaining} ${remaining === 1 ? "slot" : "slots"} left` : "placeholder"}
      </span>

      <div className="font-display text-[42px] font-black leading-none tracking-[-1.5px] text-foreground">
        {category.distance_km ? `${category.distance_km}K` : category.label}
      </div>

      <p className="mt-2.5 min-h-[3.75rem] text-[14.5px] leading-relaxed text-muted-foreground">
        {category.blurb ?? ""}
      </p>

      {category.cutoff_hours ? (
        <div className="font-mono-race mt-4 flex items-center justify-between border-t border-dashed border-divider pt-3.5 text-[12.5px] text-muted-foreground">
          <span>Cut-off</span>
          <span>{category.cutoff_hours} h</span>
        </div>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-3 pt-5">
        <span className="font-mono-race text-[21px] font-extrabold tracking-[-0.4px] text-foreground">
          {formatPeso(category.base_price)}
        </span>
        {enterable ? (
          <Link
            href={`/register/${category.id}`}
            className="inline-flex rounded-pill bg-primary px-5 py-2.5 text-[14px] font-semibold text-primary-foreground transition-colors hover:bg-primary-focus"
          >
            Join
          </Link>
        ) : (
          <span className="inline-flex rounded-pill bg-muted px-5 py-2.5 text-[14px] font-semibold text-muted-foreground">
            {closed ? "Closed" : "Sold out"}
          </span>
        )}
      </div>
    </div>
  );
}
