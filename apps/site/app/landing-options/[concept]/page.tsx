import type { ComponentType } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import {
  CourseAtlas,
  PaceTogether,
  RidgeSignal,
  StartLine,
  TrailJournal,
} from "@/components/landing";
import { LandingOptionNav } from "@/components/landing/LandingShared";
import {
  LANDING_OPTIONS,
  landingOption,
  type LandingOptionSlug,
} from "@/lib/landing-options";

export const dynamic = "force-dynamic";
export const dynamicParams = false;

const CONCEPTS: Record<LandingOptionSlug, ComponentType> = {
  "ridge-signal": RidgeSignal,
  "course-atlas": CourseAtlas,
  "start-line": StartLine,
  "trail-journal": TrailJournal,
  "pace-together": PaceTogether,
};

export function generateStaticParams() {
  return LANDING_OPTIONS.map((option) => ({ concept: option.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ concept: string }> }): Promise<Metadata> {
  const { concept } = await params;
  const option = landingOption(concept);
  if (!option) return {};

  return {
    title: `${option.number} ${option.name} · Landing concept`,
    description: option.summary,
    robots: { index: false, follow: false, noarchive: true },
  };
}

export default async function LandingConceptPage({ params }: { params: Promise<{ concept: string }> }) {
  const { concept } = await params;
  const option = landingOption(concept);
  if (!option) notFound();

  const Concept = CONCEPTS[option.slug];
  return (
    <>
      <SiteHeader />
      <LandingOptionNav active={option.slug} />
      <Concept />
    </>
  );
}
