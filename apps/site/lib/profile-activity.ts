import type { PrescreeningBatchStatus, PrescreeningDecision } from "@race-pace/shared";
import type { RegistrationRow } from "./registration";
import { createClient } from "./supabase/client";
import { holdExpired } from "./holdExpiry";

export type ProfileRegistration = Pick<RegistrationRow,
  "id" | "status" | "participantUserId" | "eventStatus" | "categoryDistance" | "expiresAt" | "eventName" | "categoryLabel" | "bookingOrderId">;

export type ProfileScreeningBatch = {
  id: string; status: PrescreeningBatchStatus; payment_deadline_at: string | null;
  events: { name: string } | null;
  prescreening_applications: {
    id: string; participant_name: string; decision: PrescreeningDecision;
    rejection_reason: string | null; released_at: string | null;
  }[];
};

export function completedRaceStats(registrations: ProfileRegistration[], userId: string) {
  // Event completion is the available record; Race Pace does not yet store
  // individual finisher results. Managed Passports never earn personal totals.
  const completed = registrations.filter(registration => registration.participantUserId === userId
    && registration.status === "paid" && registration.eventStatus === "completed");
  const distances = completed.map(registration => registration.categoryDistance).filter((distance): distance is number => distance != null);
  return {
    races: completed.length,
    km: distances.reduce((total, distance) => total + distance, 0),
    longestKm: distances.length ? Math.max(...distances) : null,
  };
}

export function activeProfileRegistrations(registrations: ProfileRegistration[], userId: string) {
  return registrations.filter(registration => registration.participantUserId === userId
    && !["completed", "cancelled"].includes(registration.eventStatus ?? "")
    && (registration.status === "paid" || (registration.status === "pending"
      && !holdExpired(registration.status, registration.expiresAt))));
}

export async function fetchProfileScreeningUpdates(userId: string): Promise<ProfileScreeningBatch[]> {
  const db = createClient();
  const { data: { user }, error: authError } = await db.auth.getUser();
  if (authError) throw authError;
  if (!user || user.id !== userId) return [];
  const { data, error } = await db.from("prescreening_batches")
    .select("id,status,payment_deadline_at,events(name),prescreening_applications(id,participant_name,decision,rejection_reason,released_at)")
    .eq("booked_by_user_id", user.id).order("created_at", { ascending: false }).limit(20)
    .returns<ProfileScreeningBatch[]>();
  if (error) throw error;
  return data ?? [];
}
