export type AuthUserLike = {
  id: string;
  email?: string | null;
  created_at: string;
  last_sign_in_at?: string | null;
  banned_until?: string | null;
  app_metadata?: Record<string, unknown> | null;
  user_metadata?: Record<string, unknown> | null;
  identities?: { provider?: string | null }[] | null;
};

export type PlatformProvider = "google" | "email" | "other";

export function providerFor(user: AuthUserLike): PlatformProvider {
  const providers = new Set<string>();
  const metadataProviders = user.app_metadata?.providers;
  if (Array.isArray(metadataProviders)) {
    for (const provider of metadataProviders) {
      if (typeof provider === "string") providers.add(provider.toLowerCase());
    }
  }
  const primary = user.app_metadata?.provider;
  if (typeof primary === "string") providers.add(primary.toLowerCase());
  for (const identity of user.identities ?? []) {
    if (identity.provider) providers.add(identity.provider.toLowerCase());
  }
  if (providers.has("google")) return "google";
  if (providers.has("email")) return "email";
  return "other";
}

export function isSuspended(user: Pick<AuthUserLike, "banned_until">, now = new Date()): boolean {
  if (!user.banned_until) return false;
  const until = new Date(user.banned_until);
  return Number.isFinite(until.getTime()) && until.getTime() > now.getTime();
}

export function userDisplayName(user: AuthUserLike, profileName?: string | null): string {
  if (profileName?.trim()) return profileName.trim();
  const metadataName = user.user_metadata?.full_name ?? user.user_metadata?.name;
  if (typeof metadataName === "string" && metadataName.trim()) return metadataName.trim();
  return user.email?.split("@")[0] || "Registered user";
}

export function passportDisplayName(passport: {
  first_name?: string | null;
  last_name?: string | null;
  legacy_full_name?: string | null;
}): string {
  const split = [passport.first_name, passport.last_name].filter((value) => value?.trim()).join(" ").trim();
  return split || passport.legacy_full_name?.trim() || "Unnamed participant";
}

export function isCurrentRegistration(registration: {
  status: string;
  eventDate?: string | null;
  eventStatus?: string | null;
}, today = new Date()): boolean {
  if (!registration.eventDate || !["pending", "paid"].includes(registration.status)) return false;
  if (["cancelled", "completed"].includes(registration.eventStatus ?? "")) return false;
  const eventDate = new Date(`${registration.eventDate}T23:59:59.999Z`);
  return Number.isFinite(eventDate.getTime()) && eventDate.getTime() >= today.getTime();
}

export function latestByDate<T>(rows: T[], getDate: (row: T) => string | null | undefined): T | null {
  return rows.reduce<T | null>((latest, row) => {
    const timestamp = Date.parse(getDate(row) ?? "");
    if (!Number.isFinite(timestamp)) return latest;
    if (!latest) return row;
    const latestTimestamp = Date.parse(getDate(latest) ?? "");
    return !Number.isFinite(latestTimestamp) || timestamp > latestTimestamp ? row : latest;
  }, null);
}
