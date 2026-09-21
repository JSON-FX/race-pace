import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Tone = "brand" | "info" | "warning";

const iconTone: Record<Tone, string> = {
  brand: "bg-secondary text-secondary-foreground",
  info: "bg-info-tint text-info",
  warning: "bg-amber-tint text-amber",
};

export function SettingsSection({
  id,
  title,
  description,
  icon: Icon,
  tone = "brand",
  status,
  children,
  className,
}: {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  tone?: Tone;
  status?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const headingId = `${id}-heading`;

  return (
    <Card
      id={id}
      role="region"
      aria-labelledby={headingId}
      className={cn("scroll-mt-24 gap-0 overflow-hidden rounded-xl border py-0 shadow-card", className)}
    >
      <div className="flex items-start gap-3 px-4 pb-4 pt-5 md:px-5">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", iconTone[tone])}>
          <Icon className="size-[18px]" strokeWidth={1.9} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-[15px] font-bold tracking-[-0.01em]">{title}</h2>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{description}</p>
        </div>
        {status ? (
          <Badge variant="secondary" className="mt-0.5 text-[10px] font-bold">{status}</Badge>
        ) : null}
      </div>
      {children}
    </Card>
  );
}

export function SettingsSectionFooter({ children, helper }: { children: React.ReactNode; helper?: string }) {
  return (
    <div className="flex flex-col-reverse gap-3 border-t border-divider bg-muted/50 px-4 py-3 sm:flex-row sm:items-center md:px-5">
      {helper ? <p className="mr-auto text-[11px] text-muted-foreground">{helper}</p> : <span className="mr-auto" />}
      {children}
    </div>
  );
}
