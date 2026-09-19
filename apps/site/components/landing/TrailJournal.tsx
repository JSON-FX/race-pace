import { Bookmark, Footprints, Leaf, MapPin, PenLine } from "lucide-react";
import { Reveal } from "@/components/event/motion-primitives";
import { FinalCta, LandingActions } from "./LandingShared";
import { LandingBackdrop } from "./LandingBackdrop";

export function TrailJournal() {
  return (
    <main>
      <section className="relative isolate min-h-[760px] overflow-hidden bg-background">
        <LandingBackdrop variant="journal" />
        <div className="relative z-10 mx-auto grid min-h-[760px] w-full max-w-6xl items-start px-5 pb-10 pt-16 sm:px-6 sm:pt-24 lg:grid-cols-2">
          <Reveal>
            <div className="max-w-xl">
              <p className="font-eyebrow text-[11px] font-bold uppercase tracking-[2.5px] text-primary">Field notes from the next start line</p>
              <h1 className="mt-5 font-display text-[clamp(3.3rem,7vw,6.8rem)] font-black leading-[.9] tracking-[-4px] text-forest">
                Every race becomes a chapter.
              </h1>
              <p className="mt-7 max-w-[44ch] text-[17px] leading-8 text-muted-foreground">
                Find a place worth running. Enter without the paperwork maze. Keep the pass, the details, and the memory close.
              </p>
              <div className="mt-8"><LandingActions /></div>
            </div>
          </Reveal>

          <div className="mt-auto hidden justify-end pb-6 lg:flex">
            <div className="rotate-[-3deg] rounded-2xl border border-border bg-background/88 px-5 py-4 shadow-[0_18px_60px_rgb(var(--forest)/.14)] backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <MapPin size={17} className="text-primary" aria-hidden="true" />
                <span className="font-eyebrow text-[10px] font-bold uppercase tracking-[1.8px] text-foreground">Somewhere beyond the road</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-6 sm:py-28">
        <Reveal>
          <div className="grid gap-12 lg:grid-cols-[1.2fr_.8fr]">
            <div>
              <p className="font-eyebrow text-[11px] font-bold uppercase tracking-[2px] text-primary">A calmer way into the wild</p>
              <h2 className="mt-5 max-w-[13ch] font-display text-[clamp(2.5rem,5.5vw,4.9rem)] font-black leading-[.94] tracking-[-2.8px]">The useful details, told like a good trail story.</h2>
            </div>
            <div className="border-l border-primary/30 pl-6 text-[16px] leading-8 text-muted-foreground">
              <PenLine size={22} strokeWidth={1.6} className="text-primary" aria-hidden="true" />
              <p className="mt-5">Race Pace gives each event room to feel distinct while keeping registration familiar. Runners learn the place, the course, and what comes next.</p>
            </div>
          </div>
        </Reveal>

        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {[
            { icon: Leaf, title: "Discover the place", copy: "See the race through terrain, distance, location, and organizer details." },
            { icon: Bookmark, title: "Save your entry", copy: "Race Passport turns repeated runner information into one reusable profile." },
            { icon: Footprints, title: "Carry the chapter", copy: "Your ticket and QR pass stay ready when the trip to the start begins." },
          ].map(({ icon: Icon, title, copy }, index) => (
            <Reveal key={title} delay={index * 0.04}>
              <article className="h-full rounded-[26px] border border-divider bg-muted/45 p-7">
                <Icon size={22} strokeWidth={1.5} className="text-primary" aria-hidden="true" />
                <h3 className="mt-12 font-display text-[24px] font-extrabold tracking-[-.7px]">{title}</h3>
                <p className="mt-3 text-[15px] leading-7 text-muted-foreground">{copy}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="bg-secondary">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-16 sm:px-6 lg:grid-cols-[auto_1fr] lg:items-center lg:gap-16 lg:py-20">
          <span className="font-mono-race text-[clamp(4rem,10vw,8rem)] font-bold leading-none text-primary/22">04</span>
          <div>
            <p className="font-eyebrow text-[11px] font-bold uppercase tracking-[2.2px] text-secondary-foreground">The journal principle</p>
            <p className="mt-4 max-w-[42ch] font-display text-[clamp(2rem,4vw,3.6rem)] font-black leading-[1.02] tracking-[-1.8px] text-forest">Registration is part of the race story. Make it worth remembering.</p>
          </div>
        </div>
      </section>

      <FinalCta eyebrow="Turn the page" title="Your next chapter is a race away." copy="Browse upcoming events or invite runners into a race story of your own." />
    </main>
  );
}
