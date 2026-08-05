import { Button } from "@/components/ui/button";
import { AlertTriangle, CloudOff, RefreshCw } from "lucide-react";
import type { FailedScan, QueuedScan } from "../lib/checkinQueue";

/** Failures are loud and non-dismissable on purpose: a queued check-in that
 *  vanishes means a runner is on the course marked absent. Design §5.5. */
export function CheckInQueueStatus({
  queue, failed, online, onRetryAll, onRetryOne,
}: {
  queue: QueuedScan[];
  failed: FailedScan[];
  online: boolean;
  onRetryAll: () => void;
  onRetryOne: (clientId: string) => void;
}) {
  if (queue.length === 0 && failed.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {queue.length > 0 ? (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted px-4 py-3">
          <CloudOff className="size-5 shrink-0 text-muted-foreground" />
          <span className="flex-1 text-sm">
            <strong>{queue.length}</strong> check-in{queue.length === 1 ? "" : "s"} waiting to sync
            {online ? "" : " — reconnect to send"}
          </span>
          {online ? (
            <Button size="sm" variant="secondary" onClick={onRetryAll}>
              <RefreshCw className="size-4" /> Sync now
            </Button>
          ) : null}
        </div>
      ) : null}

      {failed.length > 0 ? (
        <div className="rounded-lg border-2 border-destructive bg-destructive/10 px-4 py-3">
          <div className="mb-2 flex items-center gap-2 text-sm font-bold text-destructive">
            <AlertTriangle className="size-5" />
            {failed.length} check-in{failed.length === 1 ? "" : "s"} the server rejected — needs attention
          </div>
          <ul className="flex flex-col gap-2">
            {failed.map((f) => (
              <li key={f.clientId} className="flex items-center gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  <strong>{f.runner}</strong>
                  <span className="text-muted-foreground"> · {f.category} · {f.reason}</span>
                </span>
                <Button size="sm" variant="outline" onClick={() => onRetryOne(f.clientId)}>Retry</Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
