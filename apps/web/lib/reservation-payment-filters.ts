import type { ReservationPaymentRow } from "@/lib/queries/reservation-payments";

export type ReservationPaymentFilters = { search: string; method: string; from: string; to: string };

function paidDay(value: string | null): string {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function filterReservationPayments(rows: ReservationPaymentRow[], filters: ReservationPaymentFilters) {
  const search = filters.search.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    const day = paidDay(row.paid_at);
    return (!search || [row.runner_name, row.runner_email, row.event_name]
      .some((value) => value?.toLocaleLowerCase().includes(search)))
      && (filters.method === "all" || row.method?.toLowerCase() === filters.method.toLowerCase())
      && (!filters.from || day >= filters.from)
      && (!filters.to || day <= filters.to);
  });
}
