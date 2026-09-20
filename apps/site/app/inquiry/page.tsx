import type { Metadata } from "next";
import { Check } from "lucide-react";
import { SiteHeader } from "@/components/SiteHeader";
import { OrganizerSignup } from "@/components/landing/OrganizerSignup";

export const metadata: Metadata = {
  title: "Send an inquiry",
  description: "Contact Race Pace for runner support, organizer access, and race-day questions.",
};

export default function InquiryPage() {
  return (
    <>
      <SiteHeader />
      <main className="bg-background px-5 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto grid w-full max-w-6xl gap-12 lg:grid-cols-[1fr_.92fr] lg:items-center lg:gap-20">
          <div className="max-w-xl">
            <p className="font-eyebrow text-[11px] font-bold uppercase tracking-[2.5px] text-primary">Send an inquiry</p>
            <h1 className="mt-4 max-w-[11ch] font-display text-[clamp(2.7rem,6vw,5rem)] font-black leading-[.94] tracking-[-2.6px] text-forest">
              Let&apos;s clear the way forward.
            </h1>
            <p className="mt-6 max-w-[50ch] text-[16px] leading-8 text-foreground/70">
              Need help with a registration, payment, race pass, or upcoming event? Send the details and our team will point you in the right direction.
            </p>
            <ul className="mt-8 grid gap-4 text-[14px] font-semibold text-forest">
              {["Registration, payment, and race-pass support", "Organizer onboarding and race listings", "Events, staff, waivers, and race-day tools"].map((item) => (
                <li key={item} className="flex min-h-11 items-center gap-3 border-t border-forest/12 pt-4 first:border-0 first:pt-0">
                  <Check size={18} className="shrink-0 text-primary" strokeWidth={2.2} aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <OrganizerSignup />
        </div>
      </main>
    </>
  );
}
