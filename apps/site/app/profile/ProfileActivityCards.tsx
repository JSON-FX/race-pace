import Link from "next/link";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Mountain, Ticket, Bell } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { completedRaceStats, activeProfileRegistrations, type ProfileScreeningBatch, type ProfileRegistration } from "@/lib/profile-activity";
import { screeningSummary, screeningDate } from "@/lib/prescreening-status";

export type ProfileActivityProps = {
  userId: string; registrations: ProfileRegistration[]; registrationsLoading: boolean; registrationsError: boolean;
  screeningBatches: ProfileScreeningBatch[]; screeningLoading: boolean; screeningError: boolean;
};
const distanceLabel = (distance: number) => distance.toLocaleString("en-PH", { maximumFractionDigits: 2 });

export function ProfileActivityCards({ userId, registrations, registrationsLoading, registrationsError,
  screeningBatches, screeningLoading, screeningError }: ProfileActivityProps) {
  const career = completedRaceStats(registrations, userId);
  const active = activeProfileRegistrations(registrations, userId);
  const updates = screeningBatches.filter(batch => batch.status !== "completed"
    || batch.prescreening_applications.some(application => application.decision === "rejected"));
  return <>
    <Card className="gap-0 py-0" aria-labelledby="profile-completed-title">
      <CardHeader className="border-b border-divider py-5"><CardTitle role="heading" aria-level={2} id="profile-completed-title" className="flex items-center gap-2 text-base"><Mountain className="size-4 text-primary" aria-hidden />Completed races</CardTitle></CardHeader>
      <CardContent className="py-5">
        {registrationsLoading ? <p role="status" className="text-sm text-muted-foreground">Loading race history…</p>
          : registrationsError ? <Alert variant="destructive" role="alert"><AlertDescription>Race history could not be loaded. Refresh to try again.</AlertDescription></Alert>
          : <><dl className="grid grid-cols-2 gap-4">
            <div><dt className="text-xs text-muted-foreground">Races</dt><dd className="mt-1 text-2xl font-bold tabular-nums text-primary">{career.races}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Distance</dt><dd className="mt-1 text-2xl font-bold tabular-nums text-primary">{distanceLabel(career.km)} <span className="text-xs font-normal">km</span></dd></div>
            <div className="col-span-2 border-t border-divider pt-3"><dt className="text-xs text-muted-foreground">Longest race</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{career.longestKm != null ? `${distanceLabel(career.longestKm)} km` : "—"}</dd></div>
          </dl><p className="mt-4 text-xs leading-5 text-muted-foreground">Paid entries in completed events. Individual finisher results are not recorded yet.</p></>}
      </CardContent>
    </Card>
    <Card className="gap-0 py-0" aria-labelledby="profile-events-title">
      <CardHeader className="border-b border-divider py-5"><CardTitle role="heading" aria-level={2} id="profile-events-title" className="flex items-center gap-2 text-base"><Ticket className="size-4 text-primary" aria-hidden />Registered events</CardTitle></CardHeader>
      <CardContent className="space-y-4 py-5">
        {registrationsLoading ? <p role="status" className="text-sm text-muted-foreground">Loading registered events…</p>
          : registrationsError ? <Alert variant="destructive" role="alert"><AlertDescription>Registered events could not be loaded. Refresh to try again.</AlertDescription></Alert>
          : active.length ? <ul className="space-y-4">{active.slice(0, 3).map(registration => <li key={registration.id} className="space-y-2">
            <p className="text-sm font-semibold leading-5">{registration.eventName}</p>
            <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-muted-foreground">{registration.categoryLabel}</span><Badge variant={registration.status === "paid" ? "secondary" : "outline"}>{registration.status === "paid" ? "Registered" : "Payment pending"}</Badge></div>
            <Button asChild variant="outline" size="sm" className="w-full"><Link href={registration.status === "paid" ? `/ticket/${registration.id}` : registration.bookingOrderId ? `/group/order/${registration.bookingOrderId}` : `/pay/${registration.id}`}>
              {registration.status === "paid" ? "View ticket" : "Complete payment"}</Link></Button>
          </li>)}</ul> : <p className="text-sm text-muted-foreground">No upcoming or active entries.</p>}
        <Button asChild variant="ghost" className="w-full"><Link href="/races">View all my races</Link></Button>
      </CardContent>
    </Card>
    <Card className="gap-0 py-0" aria-labelledby="profile-updates-title">
      <CardHeader className="border-b border-divider py-5"><CardTitle role="heading" aria-level={2} id="profile-updates-title" className="flex items-center gap-2 text-base"><Bell className="size-4 text-primary" aria-hidden />Pre-screening updates</CardTitle></CardHeader>
      <CardContent className="space-y-4 py-5">
        {screeningLoading ? <p role="status" className="text-sm text-muted-foreground">Loading pre-screening updates…</p>
          : screeningError ? <Alert variant="destructive" role="alert"><AlertDescription>Pre-screening updates could not be loaded. Refresh to try again.</AlertDescription></Alert>
          : updates.length ? <ul className="space-y-5">{updates.slice(0, 3).map(batch => {
            const summary = screeningSummary(batch);
            const rejected = batch.prescreening_applications.filter(application => application.decision === "rejected");
            return <li key={batch.id} className="space-y-2">
              <p className="text-sm font-semibold leading-5">{batch.events?.name ?? "Race request"}</p>
              {rejected.length > 0 && <div className="space-y-2 text-sm"><p className="font-semibold text-destructive">Pre-screening rejected</p>
                {rejected.map(application => <p key={application.id} className="break-words text-xs leading-5"><strong>{application.participant_name}</strong>: {application.rejection_reason || "Open your request for the review decision."}{application.released_at ? " Slot released." : ""}</p>)}
              </div>}
              <p className="text-sm font-medium">{summary.title}</p><p className="text-xs leading-5 text-muted-foreground">{summary.detail}</p>
              {summary.payable && batch.payment_deadline_at && <p className="text-xs font-medium">Pay by {screeningDate(batch.payment_deadline_at)} PHT.</p>}
              <Button asChild variant={summary.payable ? "default" : "outline"} size="sm" className="w-full"><Link href={`/prescreening/${batch.id}`}>{summary.payable ? "Review payment details" : "View request"}</Link></Button>
            </li>;
          })}</ul> : <p className="text-sm text-muted-foreground">No pre-screening updates yet.</p>}
        <Button asChild variant="ghost" className="w-full"><Link href="/prescreening">View all requests</Link></Button>
      </CardContent>
    </Card>
  </>;
}
