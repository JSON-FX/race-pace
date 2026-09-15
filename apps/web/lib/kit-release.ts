export type KitSnapshot = {
  shirt_size: string | null;
  addons: { id: string; name: string }[];
};
export type KitRow = {
  registration_id: string;
  runner: string;
  bib: string | null;
  category: string;
  status: string;
  kit: KitSnapshot;
  release_id: string | null;
  released_at: string | null;
  released_by: string | null;
  recipient_name: string | null;
  refund_pending: boolean;
  can_reverse: boolean;
};
export function kitState(row: KitRow): string {
  if (row.release_id) return "Released";
  if (row.status !== "paid") return "Payment not eligible";
  return row.refund_pending ? "Refund pending" : "Ready for pickup";
}
export function kitError(code: string): string {
  return (
    (
      {
        forbidden: "You don’t have permission for this action.",
        wrong_event: "This entry belongs to another event.",
        not_paid: "Only paid registrations can collect a kit.",
        refund_pending:
          "Pickup is blocked while a refund is pending or under review.",
        kit_changed:
          "The kit details changed. Close this review and refresh the roster.",
        release_reversed:
          "This release was reversed. Refresh before starting a new release.",
        reason_required: "Enter a reason between 3 and 500 characters.",
        invalid_ticket: "That ticket could not be verified for this event.",
        request_conflict:
          "This request was already used. Refresh and review again.",
      } as Record<string, string>
    )[code] ?? "The action could not be completed. Please try again."
  );
}
