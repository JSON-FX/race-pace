export type PayLaterRunner = { user_id: string; full_name: string | null; email: string };
export type PayLaterEvent = { id: string; name: string; event_date: string | null; status: string };
export type PayLaterGrant = {
  id: string;
  org_id: string;
  event_id: string;
  user_id: string;
  due_date: string;
  due_at: string;
  created_at: string;
  full_name: string | null;
  email: string;
  registration_id: string | null;
  registration_status: string | null;
  category_label: string | null;
  total_amount: number | null;
  payment_status: string | null;
  paid_at: string | null;
  paid_with_pay_later: boolean;
  total_count?: number;
};
export type PayLaterPage = { rows: PayLaterGrant[]; total: number };
export const PAY_LATER_PAGE_SIZE = 20;

export function philippineDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function shiftPayLaterDay(day: string, days: number): string {
  const value = new Date(day + "T00:00:00Z");
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function validPayLaterDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day + "T00:00:00Z").toISOString().slice(0, 10) === day;
}
export function payLaterDate(day: string): string {
  return new Intl.DateTimeFormat("en-PH", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(day + "T00:00:00Z"));
}
export function payLaterStatus(row: PayLaterGrant, now = Date.now()): string {
  if (row.registration_status === "paid") return row.paid_with_pay_later ? "Paid" : "Paid separately";
  if (row.paid_with_pay_later) {
    if (row.registration_status === "expired") return "Expired";
    if (row.registration_status === "cancelled") return "Cancelled";
    if (row.registration_status === "refunded") return "Refunded";
    if (Date.parse(row.due_at) <= now) return "Deadline passed";
    return "Reserved · unpaid";
  }
  return Date.parse(row.due_at) <= now ? "Expired" : "Eligible";
}
