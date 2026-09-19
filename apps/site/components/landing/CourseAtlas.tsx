import {
  Check,
  Flag,
  Map,
  Mountain,
  Route,
  ShieldCheck,
  TicketCheck,
  Waypoints,
} from "lucide-react";
import { Reveal } from "@/components/event/motion-primitives";
import { COURSE_ATLAS_MEDIA } from "@/lib/landing-options";
import { CourseAtlasMedia } from "./CourseAtlasMedia";
import { JourneyCards, LandingActions } from "./LandingShared";
import { OrganizerSignup } from "./OrganizerSignup";

const terrainCards = [
  {
    icon: Route,
    label: "Road",
    title: "Find your fast line.",
    copy: "City starts, coastal miles, fun runs, and road races that turn familiar places into a course worth chasing.",
  },
  {
    icon: Mountain,
    label: "Trail",
    title: "Follow the wilder line.",
    copy: "Forest paths, ridgelines, long climbs, and ultras that reward patience long after the easy miles are gone.",
  },
] as const;

export function CourseAtlas() {
  return (
    <main>
      <section className="relative isolate min-h-[760px] overflow-hidden bg-forest text-white">
        <CourseAtlasMedia scene="hero" src={COURSE_ATLAS_MEDIA.hero.src} priority />
        <div className="relative z-10 mx-auto grid min-h-[760px] w-full max-w-6xl items-center gap-12 px-5 py-20 sm:px-6 sm:py-24 lg:grid-cols-[1.08fr_.92fr] lg:py-28">
          <Reveal>
            <div className="max-w-2xl">
              <p className="font-eyebrow text-[11px] font-bold uppercase tracking-[2.5px] text-white/74">
                Course Atlas <span className="mx-2 text-primary">·</span> Road to ridge
              </p>
              <h1 className="mt-5 max-w-[10ch] font-display text-[clamp(3.2rem,7vw,6.7rem)] font-black leading-[.9] tracking-[-4px] text-white">
                Map the way to your next race.
              </h1>
              <p className="mt-7 max-w-[47ch] text-[17px] leading-8 text-white/76 sm:text-[18px]">
                From fast road miles to long trail climbs, find the course that feels like your next story.
              </p>
              <div className="mt-8">
                <LandingActions inverse />
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.08} className="lg:justify-self-end">
            <div className="w-full max-w-[450px] rotate-[1.2deg] rounded-[26px] border border-white/20 bg-background/90 p-4 text-foreground shadow-[0_30px_90px_rgb(0_0_0/.28)] backdrop-blur-xl sm:p-6">
              <div className="flex items-start justify-between gap-5 border-b border-divider pb-4 sm:gap-6">
                <div className="min-w-0 flex-1 pr-1">
                  <p className="font-eyebrow text-[9px] font-bold uppercase tracking-[2px] text-muted-foreground">
                    Your route to race day
                  </p>
                  <p className="mt-1 font-display text-[22px] font-extrabold tracking-[-.5px]">
                    Ready in three checkpoints
                  </p>
                </div>
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-primary">
                  <Map size={20} aria-hidden="true" />
                </span>
              </div>
              <ol className="mt-2">
                {[
                  { icon: Waypoints, label: "Choose the course", note: "Road, trail, distance, and details" },
                  { icon: Check, label: "Complete your entry", note: "Passport, waiver, and payment" },
                  { icon: Flag, label: "Reach the start line", note: "QR race pass on your phone" },
                ].map(({ icon: Icon, label, note }, index) => (
                  <li key={label} className="grid grid-cols-[44px_1fr_auto] items-center gap-3 border-b border-divider py-4 last:border-0">
                    <span className="grid size-11 place-items-center rounded-full border border-border bg-background text-primary">
                      <Icon size={18} aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block text-[14px] font-bold text-foreground">{label}</span>
                      <span className="mt-1 block text-[12px] text-muted-foreground">{note}</span>
                    </span>
                    <span className="font-mono-race text-[10px] font-bold text-muted-foreground">0{index + 1}</span>
                  </li>
                ))}
              </ol>
            </div>
          </Reveal>
        </div>
      </section>

      <section className="relative isolate min-h-[760px] overflow-hidden bg-background">
        <CourseAtlasMedia scene="journey" src={COURSE_ATLAS_MEDIA.journey.src} />
        <div className="relative z-10 mx-auto w-full max-w-6xl px-5 py-20 sm:px-6 sm:py-28">
          <Reveal>
            <div className="grid gap-8 border-b border-foreground/12 pb-12 lg:grid-cols-[1fr_1.1fr] lg:items-end">
              <div>
                <p className="font-eyebrow text-[11px] font-bold uppercase tracking-[2.5px] text-primary">The race-day route</p>
                <h2 className="mt-4 max-w-[13ch] font-display text-[clamp(2.3rem,5vw,4.5rem)] font-black leading-[.96] tracking-[-2.4px] text-forest">
                  A clear course from curious to confirmed.
                </h2>
              </div>
              <div className="lg:justify-self-end">
                <p className="max-w-[54ch] text-[16px] leading-8 text-foreground/72">
                  Like a good route marker, Race Pace gives you the right information at the right moment. No detours through scattered forms, messages, or payment threads.
                </p>
              </div>
            </div>
          </Reveal>
          <div className="mt-12">
            <JourneyCards compact />
          </div>
        </div>
      </section>

      <section className="relative isolate min-h-[760px] overflow-hidden bg-forest text-white">
        <CourseAtlasMedia scene="preparation" src={COURSE_ATLAS_MEDIA.preparation.src} />
        <div className="relative z-10 mx-auto grid min-h-[760px] w-full max-w-6xl items-center gap-12 px-5 py-20 sm:px-6 sm:py-24 lg:grid-cols-[.82fr_1.18fr] lg:py-28">
          <Reveal>
            <div className="max-w-lg">
              <p className="font-eyebrow text-[11px] font-bold uppercase tracking-[2.5px] text-primary">Choose your terrain</p>
              <h2 className="mt-4 font-display text-[clamp(2.4rem,5vw,4.6rem)] font-black leading-[.94] tracking-[-2.4px]">
                Every runner has a line worth following.
              </h2>
              <p className="mt-6 max-w-[46ch] text-[16px] leading-8 text-white/72">
                Whether your shoes prefer asphalt or earth, the journey from discovery to start line stays simple.
              </p>
            </div>
          </Reveal>

          <div className="grid gap-4 sm:grid-cols-2">
            {terrainCards.map(({ icon: Icon, label, title, copy }, index) => (
              <Reveal key={label} delay={index * 0.06}>
                <article className="min-h-full rounded-[24px] border border-white/16 bg-black/24 p-6 shadow-[0_24px_70px_rgb(0_0_0/.18)] backdrop-blur-md sm:p-7">
                  <div className="flex items-center justify-between">
                    <span className="grid size-12 place-items-center rounded-full border border-white/20 bg-white/10 text-primary">
                      <Icon size={21} strokeWidth={1.8} aria-hidden="true" />
                    </span>
                    <span className="font-mono-race text-[10px] font-bold uppercase tracking-[1.8px] text-white/58">0{index + 1}</span>
                  </div>
                  <p className="mt-8 font-eyebrow text-[10px] font-bold uppercase tracking-[2px] text-primary">{label}</p>
                  <h3 className="mt-3 font-display text-[27px] font-extrabold leading-tight tracking-[-.8px]">{title}</h3>
                  <p className="mt-4 text-[14px] leading-7 text-white/70">{copy}</p>
                </article>
              </Reveal>
            ))}
            <Reveal delay={0.12} className="sm:col-span-2">
              <ul className="grid rounded-[20px] border border-white/14 bg-black/22 px-5 py-3 backdrop-blur-md sm:grid-cols-3 sm:px-6">
                {[
                  { icon: Check, label: "Race Passport ready" },
                  { icon: ShieldCheck, label: "Secure entry and payment" },
                  { icon: TicketCheck, label: "QR pass on your phone" },
                ].map(({ icon: Icon, label }) => (
                  <li key={label} className="flex min-h-14 items-center gap-3 border-white/14 text-[13px] font-semibold text-white/78 sm:border-r sm:px-4 sm:first:pl-0 sm:last:border-0 sm:last:pr-0">
                    <Icon size={17} className="shrink-0 text-primary" aria-hidden="true" />
                    {label}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="relative isolate min-h-[650px] overflow-hidden bg-forest text-white">
        <CourseAtlasMedia scene="finish" src={COURSE_ATLAS_MEDIA.finish.src} />
        <div className="relative z-10 mx-auto flex min-h-[650px] w-full max-w-6xl items-center px-5 py-20 sm:px-6 sm:py-28">
          <Reveal>
            <div className="max-w-3xl">
              <p className="font-eyebrow text-[11px] font-bold uppercase tracking-[2.5px] text-primary">One finish. Many ways there.</p>
              <h2 className="mt-4 max-w-[13ch] font-display text-[clamp(2.6rem,6vw,5.6rem)] font-black leading-[.92] tracking-[-3px]">
                Your next race is already out there.
              </h2>
              <p className="mt-6 max-w-[49ch] text-[17px] leading-8 text-white/74">
                Find the road, trail, or distance that calls to you. Race Pace keeps the rest of the route clear.
              </p>
              <div className="mt-9">
                <LandingActions inverse />
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <section
        id="organizers"
        aria-labelledby="organizer-heading"
        data-seamless-footer
        className="scroll-mt-16 bg-background px-5 sm:px-6"
      >
        <div className="mx-auto grid w-full max-w-6xl gap-12 border-y border-forest/14 py-14 sm:py-18 lg:grid-cols-[1fr_.92fr] lg:items-center lg:gap-20">
          <Reveal>
            <div className="max-w-xl">
              <p className="font-eyebrow text-[11px] font-bold uppercase tracking-[2.5px] text-primary">
                For race organizers
              </p>
              <h2
                id="organizer-heading"
                className="mt-4 max-w-[12ch] font-display text-[clamp(2.5rem,5.5vw,4.8rem)] font-black leading-[.94] tracking-[-2.6px] text-forest"
              >
                Bring your next race into view.
              </h2>
              <p className="mt-6 max-w-[50ch] text-[16px] leading-8 text-foreground/70">
                Tell us what you&apos;re planning. We&apos;ll review your race, prepare the right organization space, and help your team open entries with confidence.
              </p>

              <ul className="mt-8 grid gap-4 text-[14px] font-semibold text-forest sm:grid-cols-3 lg:grid-cols-1">
                {[
                  "A dedicated organizer workspace",
                  "Events, categories, waivers, and staff",
                  "Payments, QR passes, and race-day tools",
                ].map((item) => (
                  <li key={item} className="flex min-h-11 items-center gap-3 border-t border-forest/12 pt-4 first:border-0 first:pt-0 sm:first:border-t sm:first:pt-4 lg:first:border-0 lg:first:pt-0">
                    <Check size={18} className="shrink-0 text-primary" strokeWidth={2.2} aria-hidden="true" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          <Reveal delay={0.08}>
            <OrganizerSignup />
          </Reveal>
        </div>
      </section>
    </main>
  );
}
