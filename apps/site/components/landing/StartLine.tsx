import { ArrowRight, Circle, Flag, Timer, Trophy } from "lucide-react";
import { Reveal } from "@/components/event/motion-primitives";
import { FinalCta, LandingActions } from "./LandingShared";
import { LandingBackdrop } from "./LandingBackdrop";

export function StartLine() {
  return (
    <main>
      <section className="relative isolate min-h-[760px] overflow-hidden bg-forest text-white">
        <LandingBackdrop variant="start" />
        <div className="relative z-10 mx-auto flex min-h-[760px] w-full max-w-6xl flex-col justify-between px-5 py-10 sm:px-6 sm:py-14">
          <div className="flex items-center justify-between border-b border-white/18 pb-5 font-mono-race text-[10px] font-bold uppercase tracking-[1.5px] text-white/62">
            <span>Mindanao race platform</span>
            <span>Option 03 / Start Line</span>
          </div>

          <Reveal className="py-16 sm:py-20">
            <p className="font-eyebrow text-[12px] font-bold uppercase tracking-[3px] text-primary">Ready when you are</p>
            <h1 className="mt-5 max-w-[10ch] font-display text-[clamp(4.2rem,12vw,10rem)] font-black uppercase leading-[.76] tracking-[-7px] text-white">
              Your race starts here.
            </h1>
            <div className="mt-9"><LandingActions inverse /></div>
          </Reveal>

          <div className="grid gap-5 border-t border-white/18 pt-5 sm:grid-cols-[1fr_auto] sm:items-end">
            <p className="max-w-[46ch] text-[15px] leading-7 text-white/66">
              Find the course. Lock in your entry. Show up with your race pass ready.
            </p>
            <a href="#start-manifesto" className="inline-flex min-h-11 items-center gap-2 text-[12px] font-bold uppercase tracking-[1.5px] text-white transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              Keep moving <ArrowRight size={16} aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>

      <section id="start-manifesto" className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-6 sm:py-28">
        <Reveal>
          <div className="grid gap-10 lg:grid-cols-[.72fr_1.28fr]">
            <div>
              <span className="font-mono-race text-[11px] font-bold text-primary">00:00:01</span>
              <p className="mt-3 max-w-[25ch] font-eyebrow text-[12px] font-bold uppercase tracking-[2px] text-muted-foreground">That split second before everyone moves</p>
            </div>
            <h2 className="font-display text-[clamp(2.65rem,6vw,5.5rem)] font-black leading-[.88] tracking-[-3.5px]">
              Registration should build anticipation, not drain it.
            </h2>
          </div>
        </Reveal>

        <div className="mt-16 grid border-y border-foreground lg:grid-cols-3">
          {[
            { icon: Circle, number: "01", title: "Pick your line", copy: "Browse upcoming races and choose the challenge that feels right." },
            { icon: Timer, number: "02", title: "Make it official", copy: "Use Race Passport, accept the waiver, and complete secure payment." },
            { icon: Flag, number: "03", title: "Bring the proof", copy: "Your phone-ready QR pass carries the details you need on race day." },
          ].map(({ icon: Icon, number, title, copy }) => (
            <Reveal key={number} className="border-b border-foreground p-6 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0 sm:p-8">
              <div className="flex items-center justify-between">
                <Icon size={23} strokeWidth={1.6} className="text-primary" aria-hidden="true" />
                <span className="font-mono-race text-[11px] font-bold">{number}</span>
              </div>
              <h3 className="mt-14 font-display text-[30px] font-black uppercase leading-none tracking-[-1.5px]">{title}</h3>
              <p className="mt-4 text-[15px] leading-7 text-muted-foreground">{copy}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="border-y border-divider bg-coral-tint">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-14 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-5">
            <span className="grid size-14 shrink-0 place-items-center rounded-full bg-coral text-white"><Trophy size={24} aria-hidden="true" /></span>
            <p className="max-w-[38ch] font-display text-[24px] font-extrabold leading-tight tracking-[-.8px]">The finish line gets the photo. The start line creates the story.</p>
          </div>
          <p className="max-w-[42ch] text-[15px] leading-7 text-muted-foreground">Race Pace owns the part before the race, so organizers and runners can focus on the part that matters.</p>
        </div>
      </section>

      <FinalCta eyebrow="Stop waiting at the line" title="Choose the race. Start the story." copy="A direct, energetic route from event discovery to the QR pass in your pocket." />
    </main>
  );
}
