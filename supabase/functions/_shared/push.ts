// Pure helpers for the send-push Edge Function (unit-tested with Vitest). Design §7.2.
export type PushNotification = {
  id: string; user_id: string; type: string; title: string; body: string; data: Record<string, unknown>;
};
export type ExpoMessage = { to: string; title: string; body: string; data: Record<string, unknown> };
export type ExpoTicket = { status: "ok" | "error"; details?: { error?: string } };

export function buildExpoMessages(notes: PushNotification[], tokensByUser: Map<string, string[]>): ExpoMessage[] {
  const msgs: ExpoMessage[] = [];
  for (const n of notes) {
    for (const to of tokensByUser.get(n.user_id) ?? []) {
      msgs.push({ to, title: n.title, body: n.body, data: { ...n.data, type: n.type } });
    }
  }
  return msgs;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Expo returns one ticket per message in order; a DeviceNotRegistered ticket means prune that token.
export function deadTokens(messages: ExpoMessage[], tickets: ExpoTicket[]): string[] {
  const dead: string[] = [];
  tickets.forEach((t, i) => {
    if (t.status === "error" && t.details?.error === "DeviceNotRegistered" && messages[i]) dead.push(messages[i].to);
  });
  return [...new Set(dead)];
}
