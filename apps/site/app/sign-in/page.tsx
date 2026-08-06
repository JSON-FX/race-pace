import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { fetchSeasonStats } from "@/lib/seasonStats";
import { SignInForm } from "./SignInForm";

/**
 * Direction A — editorial split.
 *
 * This is often a runner's FIRST screen: a friend shares a race link, they tap
 * register, and land here. It used to be a plain centred form that could have
 * belonged to any product, while the rest of the site speaks in 40px Archivo
 * headlines over forest slabs. Now it sounds like the thing they are joining.
 *
 * The contour lines are drawn inline from `--forest` and the primary green —
 * no photography to source or licence, and nothing new to ship. That matters:
 * a stock trail photo would be the only image on this site that is not a real
 * Mindanao race.
 *
 * A Server Component so the stats below are real. See fetchSeasonStats.
 */
export default async function SignInPage() {
  const db = await createClient();
  const stats = await fetchSeasonStats(db);

  return (
    <main className="flex min-h-dvh flex-col md:flex-row">
      {/* BRAND CANVAS — a full pane on desktop, a header band on mobile, so the
          brand survives the breakpoint instead of degrading to a bare form. */}
      <section className="relative flex flex-col justify-between overflow-hidden bg-forest px-6 py-7 text-white md:w-[52%] md:px-12 md:py-12">
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full opacity-70"
          viewBox="0 0 400 470"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {/* Contour lines — the same visual idea as components/TopoPattern,
              inlined here so this pane needs no client JS at all. */}
          <g fill="none" stroke="rgb(53 192 110 / 0.30)" strokeWidth="1.1">
            <path d="M-20 300 C 60 250, 120 330, 200 285 S 340 230, 420 275" />
            <path d="M-20 330 C 60 280, 120 360, 200 315 S 340 260, 420 305" />
            <path d="M-20 360 C 60 310, 120 390, 200 345 S 340 290, 420 335" />
            <path d="M-20 392 C 60 342, 120 422, 200 377 S 340 322, 420 367" />
            <path d="M-20 424 C 60 374, 120 454, 200 409 S 340 354, 420 399" />
          </g>
          <g fill="none" stroke="rgb(53 192 110 / 0.16)" strokeWidth="1">
            <path d="M-20 120 C 70 90, 130 150, 210 118 S 350 80, 420 110" />
            <path d="M-20 155 C 70 125, 130 185, 210 153 S 350 115, 420 145" />
          </g>
        </svg>

        {/* Clicking the mark returns to the catalog — an auth page with no way
            out is a dead end for anyone who landed here by accident.

            The logo sits on a WHITE PLATE rather than being knocked out with
            `brightness-0 invert`. The artwork is slate grey plus green on a
            white background baked into the PNG, so inverting it flattens all
            three into one white silhouette — which is not the logo. The plate
            shows it exactly as drawn and doubles as the clear space a lockup is
            meant to keep. */}
        <Link
          href="/"
          aria-label="Race Pace home"
          className="relative z-10 inline-flex w-fit items-center rounded-xl bg-white px-3 py-2"
        >
          <Image
            src="/topnav-logo.png"
            alt="Race Pace"
            width={700}
            height={372}
            priority
            className="h-[26px] w-auto md:h-[30px]"
          />
        </Link>

        <div className="relative z-10 mt-6 md:mt-0">
          <p className="font-eyebrow text-[10.5px] font-bold uppercase tracking-[0.15em] text-[#7FE0A6]">
            Mindanao · 2026 season
          </p>
          <h2 className="mt-2 max-w-[12ch] font-display text-[28px] font-black leading-[1.02] tracking-[-0.035em] md:text-[38px]">
            Your start line is waiting.
          </h2>
          <p className="mt-3 hidden max-w-[34ch] text-[14px] leading-relaxed text-white/65 md:block">
            Sign in to claim a slot, carry your ticket offline, and keep every race
            you&apos;ve run in one place.
          </p>
        </div>

        {/* Real numbers, not decoration. Hidden entirely when the read failed or
            the season is empty — three zeroes would undersell the product worse
            than showing nothing. */}
        {stats.racesOpen > 0 ? (
          <dl className="relative z-10 mt-6 hidden gap-7 md:flex">
            <div>
              <dd className="font-display text-[22px] font-extrabold tracking-[-0.02em] tabular-nums">
                {stats.racesOpen}
              </dd>
              <dt className="mt-0.5 font-eyebrow text-[10px] font-bold uppercase tracking-[0.09em] text-white/50">
                Races open
              </dt>
            </div>
            <div>
              <dd className="font-display text-[22px] font-extrabold tracking-[-0.02em] tabular-nums">
                {stats.organizers}
              </dd>
              <dt className="mt-0.5 font-eyebrow text-[10px] font-bold uppercase tracking-[0.09em] text-white/50">
                {stats.organizers === 1 ? "Organizer" : "Organizers"}
              </dt>
            </div>
            {stats.longestKm ? (
              <div>
                <dd className="font-display text-[22px] font-extrabold tracking-[-0.02em] tabular-nums">
                  {stats.longestKm}K
                </dd>
                <dt className="mt-0.5 font-eyebrow text-[10px] font-bold uppercase tracking-[0.09em] text-white/50">
                  Longest
                </dt>
              </div>
            ) : null}
          </dl>
        ) : null}
      </section>

      <section className="flex flex-1 items-center justify-center px-6 py-10 md:px-12">
        {/* useSearchParams opts a page out of static prerendering unless it sits
            under a Suspense boundary. */}
        <Suspense fallback={null}>
          <SignInForm />
        </Suspense>
      </section>
    </main>
  );
}
