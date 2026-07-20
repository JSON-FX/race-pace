import AsyncStorage from "@react-native-async-storage/async-storage";

export type CachedTicket = {
  rid: string;
  token: string | null;
  eventName: string;
  categoryLabel: string;
  runnerName: string;
  status: string;
  orgId: string;
};

const tKey = (rid: string) => `ticket:${rid}`;
const mKey = () => "myraces:all";

export async function cacheTicket(t: CachedTicket): Promise<void> {
  await AsyncStorage.setItem(tKey(t.rid), JSON.stringify(t));
}

export async function getCachedTicket(rid: string): Promise<CachedTicket | null> {
  const raw = await AsyncStorage.getItem(tKey(rid));
  if (!raw) return null;
  try { return JSON.parse(raw) as CachedTicket; } catch { return null; }
}

export async function cacheMyRaces(list: CachedTicket[]): Promise<void> {
  await AsyncStorage.setItem(mKey(), JSON.stringify(list));
  await Promise.all(list.filter((t) => t.status === "paid").map((t) => cacheTicket(t)));
}

export async function getCachedMyRaces(): Promise<CachedTicket[]> {
  const raw = await AsyncStorage.getItem(mKey());
  if (!raw) return [];
  try { return JSON.parse(raw) as CachedTicket[]; } catch { return []; }
}

export async function clearTicketCache(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const mine = keys.filter((k) => k.startsWith("ticket:") || k.startsWith("myraces:"));
  if (mine.length) await AsyncStorage.multiRemove(mine);
}
