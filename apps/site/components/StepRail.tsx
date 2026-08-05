import { cn } from "@/lib/utils";

// Deliberately terser than the in-form section headings ("Your details",
// "Kit & extras", "Review") — a slim rail caption reads better compact, and
// staying distinct from the full heading avoids two on-screen nodes with
// identical text (an ambiguity real screen-reader users hit too, not just
// getByText).
const STEPS = ["Details", "Kit", "Confirm", "Pay"];

/** A waypoint rail, not a generic progress bar — each stop is a stage of the
 *  registration, connected by the same dashed line used for TicketStub's
 *  perforation and TopoPattern's contours, so the "trail" motif threads
 *  through the one screen a runner spends the most time on. */
export function StepRail({ current }: { current: number }) {
  return (
    <ol className="no-print flex items-center gap-2" aria-label="Registration progress">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < current ? "done" : n === current ? "current" : "todo";
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold transition-colors",
                state === "todo" && "bg-muted text-muted-foreground",
                state === "current" && "bg-primary text-primary-foreground ring-4 ring-secondary",
                state === "done" && "bg-secondary text-secondary-foreground",
              )}
            >
              {n}
            </span>
            <span className={cn("hidden text-[13px] sm:inline", state === "current" ? "font-semibold text-foreground" : "text-muted-foreground")}>
              {label}
            </span>
            {n < STEPS.length ? (
              <span
                className={cn(
                  "h-0 flex-1 border-t",
                  state === "done" ? "border-primary/50" : "border-dashed border-divider",
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
