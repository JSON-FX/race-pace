import { createClient } from "@/lib/supabase/server";

export type PlatformPayment = {
  method: string;
  amountCents: number;
  paidAt: string;
  eventName: string;
};

export type PlatformRegistration = {
  id: string;
  eventName: string;
  eventDate: string | null;
  eventStatus: string | null;
  category: string;
  status: string;
  createdAt: string;
  amountCents: number;
  payment: PlatformPayment | null;
};

export type PlatformPassport = {
  id: string;
  name: string;
  avatarUrl: string | null;
  relationship: "own" | "managed";
  claimed: boolean;
  registrations: PlatformRegistration[];
  currentRegistrations: PlatformRegistration[];
  latestPayment: PlatformPayment | null;
};

export type PlatformUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  provider: "google" | "email" | "other";
  createdAt: string;
  lastSignInAt: string | null;
  status: "active" | "suspended";
  protectedAccount: boolean;
  registrations: PlatformRegistration[];
  currentRegistrations: PlatformRegistration[];
  latestPayment: PlatformPayment | null;
  passports: PlatformPassport[];
};

type PlatformUsersResponse = {
  users?: PlatformUser[];
  error?: string;
};

export async function getPlatformUsers(): Promise<PlatformUser[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke<PlatformUsersResponse>("platform-users", {
    body: { action: "list" },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data?.users ?? [];
}
