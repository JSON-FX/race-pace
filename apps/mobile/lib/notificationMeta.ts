import {
  Bell, Ticket, QrCode, Clock, ClipboardCheck, CalendarClock, CalendarX, Sparkles, Trophy,
  type LucideIcon,
} from "lucide-react-native";

type Data = { event_id?: string; registration_id?: string } | null | undefined;

// Deep-link target per type (design §3). Null → fall back to the events tab.
export function routeFor(type: string, data: Data): string | null {
  const d = data ?? {};
  if ((type === "paid" || type === "checked_in") && d.registration_id) return `/ticket/${d.registration_id}`;
  if (type === "registered" && d.registration_id) return `/pay/${d.registration_id}`;
  if (d.event_id) return `/event/${d.event_id}`;
  return null;
}

const ICONS: Record<string, LucideIcon> = {
  registered: ClipboardCheck, paid: Ticket, event_reminder: Clock, event_cancelled: CalendarX,
  event_rescheduled: CalendarClock, event_created: Sparkles, checked_in: QrCode, event_completed: Trophy,
};
export function iconFor(type: string): LucideIcon {
  return ICONS[type] ?? Bell;
}

// Sentiment accent (NativeWind text color): positive=primary(green), info, time=amber, bad=destructive.
const ACCENTS: Record<string, string> = {
  paid: "text-primary", checked_in: "text-primary", event_completed: "text-primary",
  registered: "text-info", event_created: "text-info", event_rescheduled: "text-info",
  event_reminder: "text-amber", event_cancelled: "text-destructive",
};
export function accentFor(type: string): string {
  return ACCENTS[type] ?? "text-foreground";
}
