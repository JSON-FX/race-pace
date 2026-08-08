/** `datetime-local` speaks the browser's local wall clock; the column stores an absolute
 *  instant. For a Philippine organizer on a Philippine machine these agree. An organizer
 *  administering a PH race from another timezone would set the deadline in their own local
 *  time — a known limitation, called out in the form's helper text. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(local: string): string | null {
  if (!local) return null;
  return new Date(local).toISOString();
}
