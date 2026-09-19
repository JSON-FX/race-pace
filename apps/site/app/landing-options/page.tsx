import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Circle, Map, Mountain, NotebookPen, UsersRound } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { LandingOptionNav } from "@/components/landing/LandingShared";
import { LANDING_OPTIONS } from "@/lib/landing-options";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Landing page options",
  description: "Five design directions for the Race Pace landing page.",
  robots: { index: false, follow: false, noarchive: true },
};

const VISUALS = [
  { icon: Mountain, shell: "bg-forest text-white", accent: "bg-primary", line: "border-white/20" },
  { icon: Map, shell: "bg-muted text-forest", accent: "bg-primary/20", line: "border-foreground/10" },
  { icon: Circle, shell: "bg-foreground text-background", accent: "bg-coral", line: "border-background/20" },
  { icon: NotebookPen, shell: "bg-secondary text-forest", accent: "bg-background", line: "border-primary/25" },
  { icon: UsersRound, shell: "bg-muted text-forest", accent: "bg-primary/18", line: "border-primary/20" },
] as const;

export default function LandingOptionsPage() {
  return (
    <>
      <SiteHeader />
      <LandingOptionNav />
      <main>
        <section className="mx-auto w-full max-w-6xl px-5 pb-14 pt-16 sm:px-6 sm:pb-20 sm:pt-20">
          <p className="font-eyebrow text-[11px] font-bold uppercase tracking-[2.6px] text-primary">Race Pace · Landing page study</p>
          <div className="mt-5 grid gap-6 lg:grid-cols-[1.25fr_.75fr] lg:items-end">
            <h1 className="max-w-[13ch] font-display text-[clamp(3rem,7vw,6.3rem)] font-black leading-[.9] tracking-[-3.8px] text-foreground">
              Five ways to open the trail.
            </h1>
            <p className="max-w-[48ch] text-[16px] leading-8 text-muted-foreground lg:justify-self-end">
              Each direction uses the current Race Pace tokens, type, components, and product story. Only the composition and emotional emphasis change.
            </p>
          </div>
        </section>

        <section className="mx-auto grid w-full max-w-6xl gap-5 px-5 pb-12 sm:px-6 md:grid-cols-2">
          {LANDING_OPTIONS.map((option, index) => {
            const visual = VISUALS[index];
            const Icon = visual.icon;
            return (
              <Link
                key={option.slug}
                href={`/landing-options/${option.slug}`}
                className="group overflow-hidden rounded-[26px] border border-divider bg-card transition-[border-color,box-shadow,transform] duration-300 ease-out hover:-translate-y-1 hover:border-primary/30 hover:shadow-[0_24px_70px_rgb(var(--forest)/.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
              >
                <div className={cn("relative h-64 overflow-hidden border-b", visual.shell, visual.line)}>
                  <div className={cn("absolute -right-14 -top-20 size-64 rounded-full", visual.accent)} />
                  <div className={cn("absolute bottom-8 right-10 size-28 rounded-full border", visual.line)} />
                  <div className={cn("absolute bottom-12 right-20 size-16 rounded-full border", visual.line)} />
                  <div className="absolute inset-x-6 bottom-6 top-6 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="font-mono-race text-[11px] font-bold tracking-[1px] opacity-65">OPTION {option.number}</span>
                      <Icon size={20} strokeWidth={1.6} aria-hidden="true" />
                    </div>
                    <p className="max-w-[8ch] font-display text-[42px] font-black leading-[.88] tracking-[-2.5px]">{option.name}</p>
                  </div>
                </div>
                <div className="p-6 sm:p-7">
                  <p className="font-eyebrow text-[10px] font-bold uppercase tracking-[2px] text-primary">{option.direction}</p>
                  <p className="mt-4 min-h-14 text-[15px] leading-7 text-muted-foreground">{option.summary}</p>
                  <span className="mt-6 inline-flex min-h-11 items-center gap-2 text-[13px] font-bold text-foreground">
                    Open full concept
                    <ArrowUpRight size={16} className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
                  </span>
                </div>
              </Link>
            );
          })}
        </section>

        <section className="mx-auto w-full max-w-6xl px-5 pb-4 pt-8 sm:px-6">
          <div className="rounded-[24px] border border-divider bg-muted/50 p-6 sm:p-8">
            <p className="font-eyebrow text-[10px] font-bold uppercase tracking-[2px] text-muted-foreground">Selection note</p>
            <p className="mt-3 max-w-[66ch] text-[15px] leading-7 text-foreground">
              Choose the direction with the right emotional posture. The selected concept can then replace the current event catalog at <span className="font-mono-race text-[13px]">/</span>, while race browsing remains at <span className="font-mono-race text-[13px]">/events</span>.
            </p>
          </div>
        </section>
      </main>
    </>
  );
}
