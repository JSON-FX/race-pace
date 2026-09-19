import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { CourseAtlas } from "@/components/landing/CourseAtlas";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Find your next race",
  description: "Discover road, trail, and ultra races across Mindanao. Register, pay, and keep your race-day pass in one place.",
};

export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <CourseAtlas />
    </>
  );
}
