"use client";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="px-4 py-10 md:px-8"><Alert><AlertTitle>Reservations could not load</AlertTitle><AlertDescription>Try again to load this event’s roster and payment totals.</AlertDescription></Alert><Button className="mt-5" onClick={reset}>Try again</Button></div>;
}
