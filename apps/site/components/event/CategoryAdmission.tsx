import { CategoryInclusions } from "@/components/event/CategoryInclusions";
import Link from "next/link";
import type { CategoryRow } from "@/lib/events";
import { formatPeso } from "@race-pace/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function screeningHref(category: CategoryRow, intent: "entry" | "reservation") {
  return `/prescreening/new?event=${category.event_id}&category=${category.id}&intent=${intent}`;
}
export function CategoryRequirements({ category }: { category: CategoryRow }) {
  return <div className="mt-4 space-y-3 text-sm">
    {category.prescreening_enabled && <><Badge variant="secondary">Pre-screening required</Badge><p className="whitespace-pre-line leading-relaxed">{category.prescreening_requirement}</p><p className="text-xs">Your slot is held after submission. No payment until approval.</p></>}
    <CategoryInclusions items={category.inclusions ?? []} />
  </div>;
}
export function CategoryReservationAction({ category }: { category: CategoryRow }) {
  if (!category.reservation_enabled) return null;
  const closed = !category.reservation_sales_close_at || Date.parse(category.reservation_sales_close_at) <= Date.now();
  const full = category.reservation_available === 0;
  const date = (value: string) => new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  return <div className="mt-3 space-y-2">
    {closed || full ? <Button variant="outline" disabled className="w-full">{closed ? "Reservation sales closed" : "Reservation allocation full"}</Button> : <Button variant="default" asChild className="w-full"><Link href={screeningHref(category,"reservation")}>{category.prescreening_enabled ? "Request reservation review" : `Reserve for ${formatPeso(category.reservation_fee_cents ?? 0)}`}</Link></Button>}
    <p className="text-xs leading-relaxed">Reservation fee: {formatPeso(category.reservation_fee_cents ?? 0)}{category.prescreening_enabled ? ", payable only after pre-screening approval" : ""}. Separate, nonrefundable, and not deducted from entry payment. Platform and processing fees are additional.</p>
    {category.reservation_sales_close_at && <p className="text-xs">Reservations close {date(category.reservation_sales_close_at)} PHT.</p>}
    {category.entry_payment_deadline_at && <p className="text-xs">Full entry payment due {date(category.entry_payment_deadline_at)} PHT.</p>}
  </div>;
}
