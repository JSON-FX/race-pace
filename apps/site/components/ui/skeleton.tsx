import { cn } from "@/lib/utils";

/** Placeholder block for route-level loading UI. Mirrors the admin console's
 *  primitive (apps/web/components/ui/skeleton.tsx) so the two apps pulse at the
 *  same rate and read as one product. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-accent", className)}
      {...props}
    />
  );
}

export { Skeleton };
