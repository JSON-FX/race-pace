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
 * The canvas is a REAL Muspo night flag-off, not stock photography — the one
 * thing a licensed trail photo could never be, and the whole argument for
 * giving the pane an image at all.
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
        {/* A REAL race — a Muspo night flag-off, hands up on the line. This is
            the one thing a stock trail photo could never be, and it is the whole
            argument for the pane: a runner arriving from a shared link sees the
            event they are about to join, not a mood board.

            `fill` + `object-cover` rather than a CSS background so Next serves a
            sized, modern-format image; `priority` because it is the LCP element
            on this route. */}
        <Image
          src="/login-background.jpg"
          alt=""
          aria-hidden
          fill
          priority
          sizes="(min-width: 768px) 52vw, 100vw"
          className="object-cover object-center"
        />
        {/* Two layers, doing different jobs. The forest wash ties the photo to
            the brand instead of leaving a neutral greyscale rectangle; the
            gradient darkens the bottom, where the headline and stats sit, so
            white text clears 4.5:1 over the brightest part of the frame — the
            head-torches. Without it the copy sat on a blown highlight. */}
        <div aria-hidden className="absolute inset-0 bg-forest/72" />
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-forest via-forest/55 to-forest/25"
        />

        {/* Logo, eyebrow, headline and blurb are ONE block: the lockup reads as
            the mark on the statement rather than a separate badge parked in the
            corner. `my-auto` centres the whole group in the space left over
            after the stats claim the bottom. */}
        <div className="relative z-10 my-auto">
          {/* Clicking the mark returns to the catalog — an auth page with no
              way out is a dead end for anyone who landed here by accident. */}
          <Link
            href="/"
            aria-label="Race Pace home"
            className="mx-auto mb-6 flex w-fit items-center"
          >
            <Image
              src="/topnav-logo.png"
              alt="Race Pace"
              width={700}
              height={372}
              priority
              // No plate. The artwork is 34% transparent and carries its own
              // white fill plus the green mark, so it reads directly on the
              // photo — the white rectangle it used to sit on was covering a
              // real race with a sticker.
              //
              // The drop shadow is doing work, not decoration: the lockup's
              // darkest strokes are slate (#404A54) and would otherwise sink
              // into the dark frame. A soft shadow separates them from the
              // photo without recolouring the logo.
              className="h-[54px] w-auto drop-shadow-[0_2px_10px_rgba(0,0,0,0.55)] md:h-[72px]"
            />
          </Link>
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
