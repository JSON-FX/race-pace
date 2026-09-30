"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { useEffect, useState } from "react";
import { PassportEditor } from "./PassportEditor";
import { getProfile, upsertProfile, type Profile } from "@/lib/profile";
import type { PhotoKind } from "@/lib/profileImage";
import { PassportPhotos } from "./PassportPhotos";
import { useMyRegistrations } from "@/lib/registration";
import { Card } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { fetchProfileScreeningUpdates } from "@/lib/profile-activity";
import { ProfileActivityCards } from "./ProfileActivityCards";

/** "Jamie Cruz" -> "JC"; an unset name falls back to a single trail-green
 *  waypoint mark rather than empty air, so the passport card never looks broken. */
function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function ProfileForm({ userId, email }: { userId: string; email?: string }) {
  const [profile, setProfile] = useState<Partial<Profile>>({});
  const [error, setError] = useState<string | null>(null);
  const registrations = useMyRegistrations();
  const screening = useQuery({ queryKey: ["profile-screening", userId], queryFn: () => fetchProfileScreeningUpdates(userId) });
  useEffect(() => {
    let active = true;
    getProfile(userId).then((p) => { if (active) setProfile(p ?? {}); })
      .catch(() => { if (active) setError("Could not load profile photos."); });
    return () => { active = false; };
  }, [userId]);
  async function savePhoto(kind: PhotoKind, url: string | null) {
    const column = kind === "avatar" ? "avatar_url" : "cover_url";
    const result = await upsertProfile({ id: userId, [column]: url });
    if (result.error) throw new Error(result.error);
    setProfile((p) => ({ ...p, [column]: url }));
  }
  return <div>
    <Card className="relative gap-0 overflow-hidden py-0">
      <PassportPhotos userId={userId} name={profile.full_name} mark={initials(profile.full_name)} avatarUrl={profile.avatar_url} coverUrl={profile.cover_url} onChange={savePhoto} />
    </Card>
    {error && <Alert variant="destructive" role="alert" className="mt-3"><AlertDescription>{error}</AlertDescription></Alert>}
    <PassportEditor key={userId} userId={userId} email={email} sidebarContent={<ProfileActivityCards
      userId={userId} registrations={registrations.data ?? []} registrationsLoading={registrations.isPending} registrationsError={registrations.isError}
      screeningBatches={screening.data ?? []} screeningLoading={screening.isPending} screeningError={screening.isError}
    />} onSaved={(passport) => {
      if (passport.claimed_user_id === userId) setProfile((p) => ({ ...p, full_name: [passport.first_name, passport.last_name].filter(Boolean).join(" ") }));
    }} />
  </div>;
}
