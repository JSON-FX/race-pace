import { ArrowDown, Mountain, Route, Sparkles } from "lucide-react";
import { Reveal } from "@/components/event/motion-primitives";
import { FinalCta, JourneyCards, LandingActions, TrustStrip } from "./LandingShared";
import { LandingBackdrop } from "./LandingBackdrop";

export function RidgeSignal() {
  return (
    <main>
      <section className="relative isolate min-h-[760px] overflow-hidden bg-forest text-white sm:min-h-[820px]">
        <LandingBackdrop variant="ridge" />
        <div className="relative z-10 mx-auto flex min-h-[760px] w-full max-w-6xl flex-col justify-between px-5 pb-8 pt-16 sm:min-h-[820px] sm:px-6 sm:pb-10 sm:pt-24">
          <div className="max-w-3xl">
            <Reveal>
              <div className="inline-flex min-h-10 items-center gap-2 rounded-pill border border-white/20 bg-white/8 px-4 font-eyebrow text-[10px] font-bold uppercase tracking-[2px] text-white/76 backdrop-blur-sm">
                <Mountain size={15} className="text-primary" aria-hidden="true" />
                Made for what&apos;s out there
              </div>
              <h1 className="mt-7 max-w-[11ch] font-display text-[clamp(3.25rem,8.4vw,7.25rem)] font-black leading-[.88] tracking-[-4px] text-white">
                Find the race that moves you.
              </h1>
            </Reveal>
            <Reveal delay={0.06}>
              <p className="mt-7 max-w-[48ch] text-[17px] leading-8 text-white/72 sm:text-[19px]">
                Discover trail and ultra races across Mindanao. Enter with one Race Passport, then carry your pass on your phone.
              </p>
              <div className="mt-8"><LandingActions inverse /></div>
            </Reveal>
          </div>

          <div className="mt-16 border-t border-white/16 pt-5">
            <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
              <TrustStrip inverse />
              <a href="#ridge-journey" className="inline-flex min-h-11 shrink-0 items-center gap-2 text-[12px] font-bold uppercase tracking-[1.5px] text-white/64 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                How it works <ArrowDown size={15} aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>
      </section>

      <section id="ridge-journey" className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-6 sm:py-28">
        <Reveal>
          <div className="grid gap-8 lg:grid-cols-[.8fr_1.2fr] lg:items-end">
            <div>
              <p className="font-eyebrow text-[11px] font-bold uppercase tracking-[2.5px] text-primary">From discovery to race day</p>
              <h2 className="mt-4 font-display text-[clamp(2.35rem,5vw,4.6rem)] font-black leading-[.96] tracking-[-2.5px] text-foreground">
                One clear path to the start line.
              </h2>
            </div>
            <p className="max-w-[56ch] text-[17px] leading-8 text-muted-foreground lg:justify-self-end">
              Race Pace brings the scattered pieces of race entry into one calm journey. The adventure stays wild. The registration does not.
            </p>
          </div>
        </Reveal>
        <div className="mt-12"><JourneyCards /></div>
      </section>

      <section className="border-y border-divider bg-muted/55">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-16 sm:px-6 lg:grid-cols-3 lg:py-20">
          {[
            { icon: Route, label: "Choose by course", copy: "See terrain, distance, event details, and the path to entry before committing." },
            { icon: Sparkles, label: "Keep the moment", copy: "Your registration, ticket, and race details stay together when the countdown begins." },
            { icon: Mountain, label: "Rooted in place", copy: "A race platform shaped for Mindanao organizers, communities, and runners." },
          ].map(({ icon: Icon, label, copy }) => (
            <Reveal key={label}>
              <div className="border-l border-primary/35 pl-5">
                <Icon size={20} strokeWidth={1.7} className="text-primary" aria-hidden="true" />
                <h3 className="mt-5 font-display text-[21px] font-extrabold tracking-[-.5px]">{label}</h3>
                <p className="mt-2 text-[15px] leading-7 text-muted-foreground">{copy}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <FinalCta
        eyebrow="Your next race is out there"
        title="Meet it at the start line."
        copy="Browse open events or bring your own race to Race Pace. Everything after that follows one clear route."
      />
    </main>
  );
}
