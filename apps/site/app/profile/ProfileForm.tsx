"use client";

import { useEffect, useState } from "react";
import { PassportEditor } from "./PassportEditor";
import { getProfile, upsertProfile, type Profile } from "@/lib/profile";
import type { PhotoKind } from "@/lib/profileImage";
import { signOut } from "@/lib/auth";
import { PassportPhotos } from "./PassportPhotos";
import { useMyRegistrations } from "@/lib/registration";
import { Button } from "@/components/ui/button";
import { CountUp } from "@/components/event/motion-primitives";

/** "Jamie Cruz" -> "JC"; an unset name falls back to a single trail-green
 *  waypoint mark rather than empty air, so the passport card never looks broken. */
function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** Three figures earned across every paid entry. Distance comes from the
 *  category the runner actually entered, not the race's longest — signing up
 *  for the 10K at a 100K race is 10km. */
function useCareer() {
  const { data } = useMyRegistrations();
  const paid = (data ?? []).filter((r) => r.status === "paid");
  return {
    races: paid.length,
    km: Math.round(paid.reduce((n, r) => n + (r.categoryDistance ?? 0), 0)),
  };
}

/** One cell of the three-figure strip. Either a counted number or a word —
 *  never both, so the caller can't ask for an animated "Ready". */
function Figure({
  label,
  value,
  unit,
  text,
}: {
  label: string;
  value?: number;
  unit?: string;
  text?: string;
}) {
  return (
    <div className="border-r border-divider px-3 py-4 text-center last:border-r-0">
      <dt className="font-eyebrow text-[9px] font-bold uppercase tracking-[1.7px] text-muted-foreground">{label}</dt>
      <dd className="font-mono-race mt-1 text-[20px] font-bold text-primary">
        {text != null ? (
          <span className="text-[13px] text-muted-foreground">{text}</span>
        ) : (
          <>
            <CountUp value={value ?? 0} />
            {unit ? <span className="text-[11px] text-muted-foreground">{unit}</span> : null}
          </>
        )}
      </dd>
    </div>
  );
}

export function ProfileForm({ userId, email }: { userId: string; email?: string }) {
  const [profile, setProfile] = useState<Partial<Profile>>({});
  const [error, setError] = useState<string | null>(null);
  const career = useCareer();
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
    <div className="overflow-hidden rounded-xl border border-border">
      <PassportPhotos userId={userId} name={profile.full_name} mark={initials(profile.full_name)} avatarUrl={profile.avatar_url} coverUrl={profile.cover_url} onChange={savePhoto} />
      <dl className="grid grid-cols-2 border-b border-divider bg-card">
        <Figure label="Races" value={career.races} />
        <Figure label="Distance" value={career.km} unit="km" />
      </dl>
    </div>
    {error && <p role="alert">{error}</p>}
    <PassportEditor key={userId} userId={userId} email={email} onSaved={(passport) => {
      if (passport.claimed_user_id === userId) setProfile((p) => ({ ...p, full_name: [passport.first_name, passport.last_name].filter(Boolean).join(" ") }));
    }} />
    <Button type="button" variant="outline" onClick={() => signOut().then(() => window.location.assign("/"))} className="mt-6">Sign out</Button>
  </div>;
}
