import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";

/** An HTTP attachment works in browsers that do not persist temporary Blob URLs. */
export function ExportSettlementButton({ eventId }: { eventId: string }) {
  return (
    <Button asChild size="sm" variant="outline" className="rounded-pill">
      <a href={`/events/${encodeURIComponent(eventId)}/settlement/export`}>
        <Download className="size-4" strokeWidth={1.9} aria-hidden />
        Export CSV
      </a>
    </Button>
  );
}
