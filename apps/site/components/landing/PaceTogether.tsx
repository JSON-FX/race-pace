import { ArrowUpRight, HeartHandshake, Medal, UsersRound } from "lucide-react";
import { Reveal } from "@/components/event/motion-primitives";
import { FinalCta, LandingActions, RUNNER_JOURNEY } from "./LandingShared";
import { LandingBackdrop } from "./LandingBackdrop";

export function PaceTogether() {
  return (
    <main>
      <section className="relative isolate min-h-[740px] overflow-hidden bg-muted">
        <LandingBackdrop variant="community" />
        <div className="relative z-10 mx-auto grid min-h-[740px] w-full max-w-6xl items-start gap-12 px-5 pb-10 pt-16 sm:px-6 sm:pt-24 lg:grid-cols-[1.05fr_.95fr]">
          <Reveal>
            <div className="max-w-2xl">
              <div className="inline-flex min-h-10 items-center gap-2 rounded-pill bg-background/74 px-4 font-eyebrow text-[10px] font-bold uppercase tracking-[2px] text-primary shadow-sm backdrop-blur">
                <UsersRound size={15} aria-hidden="true" />
                Built for every pace
              </div>
              <h1 className="mt-7 max-w-[10ch] font-display text-[clamp(3.4rem,7.8vw,7.2rem)] font-black leading-[.88] tracking-[-4.5px] text-forest">
                We move farther together.
              </h1>
              <p className="mt-7 max-w-[46ch] text-[17px] leading-8 text-muted-foreground sm:text-[18px]">
                One home for the runners, organizers, friends, and crews who bring every start line to life.
              </p>
              <div className="mt-8"><LandingActions /></div>
            </div>
          </Reveal>

          <div className="mt-auto hidden pb-10 lg:block">
            <div className="ml-auto max-w-[300px] rounded-[24px] border border-border/70 bg-background/76 p-5 shadow-[0_24px_80px_rgb(var(--forest)/.12)] backdrop-blur-xl">
              <HeartHandshake size={22} className="text-primary" aria-hidden="true" />
              <p className="mt-5 font-display text-[22px] font-extrabold leading-tight tracking-[-.5px]">Every runner brings someone with them.</p>
              <p className="mt-3 text-[13px] leading-6 text-muted-foreground">A crew. A club. An organizer. A person waiting at the finish.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-6 sm:py-28">
        <Reveal>
          <div className="mx-auto max-w-3xl text-center">
            <p className="font-eyebrow text-[11px] font-bold uppercase tracking-[2.4px] text-primary">One shared rhythm</p>
            <h2 className="mt-4 font-display text-[clamp(2.55rem,5.5vw,5rem)] font-black leading-[.94] tracking-[-3px]">From “maybe” to “see you at the start.”</h2>
            <p className="mx-auto mt-5 max-w-[56ch] text-[16px] leading-8 text-muted-foreground">Race Pace makes the practical parts feel connected, so runners can spend more energy on the people and places that make racing matter.</p>
          </div>
        </Reveal>

        <ol className="mt-14 grid gap-4 md:grid-cols-3">
          {RUNNER_JOURNEY.map(({ icon: Icon, step, title, copy }, index) => (
            <Reveal key={step} as="li" delay={index * 0.04}>
              <div className="relative h-full overflow-hidden rounded-[26px] border border-divider bg-background p-7">
                <span className="absolute right-5 top-4 font-mono-race text-[52px] font-bold leading-none text-primary/10">{step}</span>
                <span className="grid size-12 place-items-center rounded-full bg-secondary text-primary"><Icon size={21} aria-hidden="true" /></span>
                <h3 className="mt-12 font-display text-[25px] font-extrabold tracking-[-.8px]">{title}</h3>
                <p className="mt-3 text-[15px] leading-7 text-muted-foreground">{copy}</p>
              </div>
            </Reveal>
          ))}
        </ol>
      </section>

      <section className="border-y border-divider bg-muted/55">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-16 sm:px-6 lg:grid-cols-[1fr_1fr] lg:items-center lg:py-20">
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: UsersRound, label: "Runners" },
              { icon: Medal, label: "Organizers" },
              { icon: HeartHandshake, label: "Crews" },
              { icon: ArrowUpRight, label: "Communities" },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex min-h-28 flex-col justify-between rounded-2xl border border-divider bg-background p-5">
                <Icon size={21} strokeWidth={1.6} className="text-primary" aria-hidden="true" />
                <span className="font-display text-[18px] font-extrabold tracking-[-.4px]">{label}</span>
              </div>
            ))}
          </div>
          <div>
            <p className="font-eyebrow text-[11px] font-bold uppercase tracking-[2.4px] text-primary">A local platform with room to grow</p>
            <h2 className="mt-4 max-w-[12ch] font-display text-[clamp(2.4rem,4.8vw,4.4rem)] font-black leading-[.96] tracking-[-2.4px]">Built around the people who make the race.</h2>
            <p className="mt-5 max-w-[50ch] text-[16px] leading-8 text-muted-foreground">The platform connects discovery, entry, payment, and race-day proof without flattening the community behind each event.</p>
          </div>
        </div>
      </section>

      <FinalCta eyebrow="Bring your people" title="Find a race worth sharing." copy="Choose your next start line or give your community a race they can enter with confidence." />
    </main>
  );
}
