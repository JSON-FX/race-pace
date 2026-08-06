import type { LucideIcon } from "lucide-react";

export function ComingSoon({ title, description, icon: Icon }: {
  title: string; description: string; icon: LucideIcon;
}) {
  return (
    <div className="px-4 pb-10 pt-6 md:px-[30px]">
      <div className="grid min-h-[420px] place-items-center rounded-xl border border-dashed border-border bg-card">
        <div className="max-w-sm px-6 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-xl bg-accent">
            <Icon className="size-6 text-accent-foreground" />
          </div>
          <h2 className="mt-4 text-lg font-semibold">{title}</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}
