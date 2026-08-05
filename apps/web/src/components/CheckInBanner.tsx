import { CheckCircle2, AlertTriangle, XCircle, Info } from "lucide-react";
import type { CheckInBanner as Banner } from "../lib/checkin";
import { cn } from "../lib/utils";

const TONE = {
  success: { cls: "border-primary bg-primary/10 text-foreground", Icon: CheckCircle2, iconCls: "text-primary" },
  warn: { cls: "border-amber-500 bg-amber-500/10 text-foreground", Icon: AlertTriangle, iconCls: "text-amber-600" },
  error: { cls: "border-destructive bg-destructive/10 text-foreground", Icon: XCircle, iconCls: "text-destructive" },
  muted: { cls: "border-border bg-muted text-foreground", Icon: Info, iconCls: "text-muted-foreground" },
} as const;

/** Large and high-contrast on purpose: cold hands, bright sun, a queue of runners. */
export function CheckInBanner({ banner }: { banner: Banner | null }) {
  if (!banner) {
    return (
      <div className="flex min-h-[104px] items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">
        Ready to scan
      </div>
    );
  }
  const { cls, Icon, iconCls } = TONE[banner.tone];
  return (
    <div role="status" aria-live="polite" className={cn("flex min-h-[104px] items-center gap-4 rounded-xl border-2 px-5 py-4", cls)}>
      <Icon className={cn("size-10 shrink-0", iconCls)} />
      <div className="min-w-0">
        <div className="text-2xl font-bold leading-tight">{banner.title}</div>
        {banner.detail ? <div className="truncate text-sm text-muted-foreground">{banner.detail}</div> : null}
      </div>
    </div>
  );
}
