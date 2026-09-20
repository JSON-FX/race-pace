import Link from "next/link";
import {
  ArrowUpRight,
  CalendarDays,
  Compass,
  MapPinned,
  ShieldCheck,
  TicketCheck,
  UserRoundCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LANDING_OPTIONS, type LandingOptionSlug } from "@/lib/landing-options";
import { cn } from "@/lib/utils";

export const RUNNER_JOURNEY = [
  {
    icon: Compass,
    step: "01",
    title: "Find your race",
    copy: "Browse trail, ultra, road, and fun runs across the Philippines in one place.",
  },
  {
    icon: UserRoundCheck,
    step: "02",
    title: "Enter once",
    copy: "Keep your runner details in Race Passport and move through registration faster.",
  },
  {
    icon: TicketCheck,
    step: "03",
    title: "Carry your pass",
    copy: "Pay securely, receive your QR race pass, and arrive ready for race day.",
  },
] as const;

export function LandingOptionNav({ active }: { active?: LandingOptionSlug }) {
  return (
    <aside className="no-print sticky top-16 z-30 border-b border-divider bg-background/92 backdrop-blur-xl" aria-label="Landing page concepts">
      <div className="mx-auto flex min-h-14 w-full max-w-6xl items-center gap-3 px-5 sm:px-6">
        <Link
          href="/landing-options"
          className="inline-flex min-h-11 shrink-0 items-center font-eyebrow text-[10px] font-bold uppercase tracking-[1.8px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Design study
        </Link>
        <span aria-hidden="true" className="h-4 w-px shrink-0 bg-divider" />
        <nav className="flex min-w-0 flex-1 snap-x items-center gap-1 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {LANDING_OPTIONS.map((option) => {
            const selected = option.slug === active;
            return (
              <Link
                key={option.slug}
                href={`/landing-options/${option.slug}`}
                aria-current={selected ? "page" : undefined}
                title={option.name}
                className={cn(
                  "inline-flex min-h-11 min-w-11 snap-start items-center justify-center rounded-pill px-3 font-mono-race text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-w-0 sm:gap-2 sm:px-4",
                  selected ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {option.number}
                <span className="hidden md:inline">{option.name}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}

export function LandingActions({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Button asChild size="lg" className="h-12 rounded-pill px-6 text-[15px] font-bold shadow-none">
        <Link href="/events">
          Browse races
          <ArrowUpRight aria-hidden="true" />
        </Link>
      </Button>
      <Button
        asChild
        size="lg"
        variant="outline"
        className={cn(
          "h-12 rounded-pill px-6 text-[15px] font-bold shadow-none",
          inverse && "border-white/35 bg-white/5 text-white hover:bg-white/12 hover:text-white",
        )}
      >
        <Link href="/#organizers">List your race</Link>
      </Button>
    </div>
  );
}

export function JourneyCards({ compact = false }: { compact?: boolean }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {RUNNER_JOURNEY.map(({ icon: Icon, step, title, copy }) => (
        <Card key={step} className={cn("gap-0 border-divider bg-card py-0 shadow-none", compact ? "rounded-xl" : "rounded-[24px]")}>
          <CardHeader className="gap-5 px-6 pt-6 pb-0">
            <div className="flex items-center justify-between">
              <span className="grid size-11 place-items-center rounded-full bg-secondary text-secondary-foreground">
                <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
              </span>
              <span className="font-mono-race text-[10px] font-bold tracking-[1px] text-muted-foreground">{step}</span>
            </div>
            <CardTitle className="font-display text-[22px] font-extrabold tracking-[-.6px]">{title}</CardTitle>
          </CardHeader>
          <CardContent className="px-6 pt-3 pb-6 text-[15px] leading-7 text-muted-foreground">{copy}</CardContent>
        </Card>
      ))}
    </div>
  );
}

export function TrustStrip({ inverse = false }: { inverse?: boolean }) {
  const items = [
    { icon: MapPinned, label: "Philippine race discovery" },
    { icon: ShieldCheck, label: "Secure online entry" },
    { icon: CalendarDays, label: "One race-day pass" },
  ];

  return (
    <ul className={cn("grid gap-3 sm:grid-cols-3", inverse ? "text-white/78" : "text-muted-foreground")}>
      {items.map(({ icon: Icon, label }) => (
        <li key={label} className="flex min-h-11 items-center gap-3 text-[13px] font-semibold">
          <Icon size={17} strokeWidth={1.8} className={inverse ? "text-primary" : "text-primary"} aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  );
}

export function FinalCta({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 pb-6 pt-20 sm:px-6 sm:pt-28">
      <div className="relative overflow-hidden rounded-[28px] bg-forest px-6 py-12 text-white sm:px-12 sm:py-16 lg:px-16">
        <div aria-hidden="true" className="absolute -right-24 -top-28 size-72 rounded-full border border-primary/50 shadow-[0_0_0_50px_rgb(var(--primary)/.08),0_0_0_100px_rgb(var(--primary)/.05)]" />
        <div className="relative max-w-3xl">
          <p className="font-eyebrow text-[11px] font-bold uppercase tracking-[2.5px] text-primary">{eyebrow}</p>
          <h2 className="mt-4 max-w-[16ch] font-display text-[clamp(2.1rem,5vw,4.2rem)] font-black leading-[.98] tracking-[-2px]">{title}</h2>
          <p className="mt-5 max-w-[54ch] text-[16px] leading-7 text-white/68">{copy}</p>
          <div className="mt-8"><LandingActions inverse /></div>
        </div>
      </div>
    </section>
  );
}
