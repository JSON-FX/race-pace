"use client";

import { useEffect, useState } from "react";
import { SHIRT_SIZES, BLOOD_TYPES, GENDERS } from "@race-pace/shared";
import { getProfile, upsertProfile, type Profile } from "@/lib/profile";
import { signOut } from "@/lib/auth";
import { PillSelect } from "@/components/PillSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** "Jamie Cruz" -> "JC"; an unset name falls back to a single trail-green
 *  waypoint mark rather than empty air, so the passport card never looks broken. */
function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export function ProfileForm({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<Partial<Profile>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProfile(userId)
      .then((p) => {
        if (p) setProfile(p);
      })
      .finally(() => setLoading(false));
  }, [userId]);

  const set = (k: keyof Profile, v: string) => {
    setProfile((p) => ({ ...p, [k]: v }));
    setSaved(false);
  };

  async function save() {
    setBusy(true);
    setError(null);
    const { error } = await upsertProfile({
      id: userId,
      full_name: profile.full_name || null,
      bib_name: profile.bib_name || null,
      date_of_birth: profile.date_of_birth || null,
      gender: profile.gender || null,
      shirt_size: profile.shirt_size || null,
      blood_type: profile.blood_type || null,
      emergency_contact: profile.emergency_contact || null,
    });
    setBusy(false);
    if (error) setError(error);
    else setSaved(true);
  }

  if (loading) return <p className="py-20 text-center text-muted-foreground">Loading…</p>;

  const mark = initials(profile.full_name);

  return (
    <div className="flex flex-col">
      {/* Identity band — the same forest/trail-green language TicketCard uses
          for a runner's race pass, so a signed-in account reads as the same
          passport before a race is ever entered, not a generic settings form. */}
      <div className="flex items-center gap-4 rounded-xl bg-forest px-6 py-5">
        <span
          aria-hidden
          className="flex size-12 shrink-0 items-center justify-center rounded-full bg-white/10 font-display text-[17px] font-extrabold tracking-[-0.2px] text-[#7FE0A6]"
        >
          {mark || "◈"}
        </span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[1.4px] text-[#7FE0A6]">Race passport</p>
          <p className="mt-0.5 text-[16px] font-semibold text-white">{profile.full_name || "Add your name below"}</p>
        </div>
      </div>

      <p className="mt-6 text-[15px] text-muted-foreground">
        These details prefill every race you enter, so you only type them once.
      </p>

      <div className="mt-8 flex flex-col gap-2">
        <Label htmlFor="full_name">Full name</Label>
        <Input id="full_name" value={profile.full_name ?? ""} onChange={(e) => set("full_name", e.target.value)} />
      </div>
      <div className="mt-6 flex flex-col gap-2">
        <Label htmlFor="bib_name">Bib name</Label>
        <Input id="bib_name" value={profile.bib_name ?? ""} onChange={(e) => set("bib_name", e.target.value)} />
        <p className="text-[13px] text-muted-foreground">Printed on your race bib.</p>
      </div>
      <div className="mt-6 flex flex-col gap-2">
        <Label htmlFor="date_of_birth">Date of birth</Label>
        <Input
          id="date_of_birth"
          type="date"
          value={profile.date_of_birth ?? ""}
          onChange={(e) => set("date_of_birth", e.target.value)}
        />
      </div>
      <div className="mt-6 flex flex-col gap-2">
        <Label htmlFor="emergency_contact">Emergency contact</Label>
        <Input
          id="emergency_contact"
          value={profile.emergency_contact ?? ""}
          onChange={(e) => set("emergency_contact", e.target.value)}
          placeholder="Name and mobile number"
        />
      </div>

      <PillSelect label="GENDER" value={profile.gender ?? ""} options={GENDERS} onChange={(v) => set("gender", v)} />
      <PillSelect
        label="SHIRT SIZE"
        value={profile.shirt_size ?? ""}
        options={SHIRT_SIZES}
        onChange={(v) => set("shirt_size", v)}
      />
      <PillSelect
        label="BLOOD TYPE"
        value={profile.blood_type ?? ""}
        options={BLOOD_TYPES}
        onChange={(v) => set("blood_type", v)}
      />

      {error ? <p className="mt-6 text-[14px] text-destructive">{error}</p> : null}
      {saved ? <p className="mt-6 text-[14px] text-primary">Saved.</p> : null}

      <Button type="button" disabled={busy} onClick={save} className="mt-8 h-auto rounded-pill py-4 text-[16px] font-semibold">
        {busy ? "Saving…" : "Save"}
      </Button>

      <Button
        type="button"
        variant="outline"
        onClick={() => signOut().then(() => window.location.assign("/"))}
        className="mt-3 h-auto rounded-pill py-4 text-[15px] font-semibold"
      >
        Sign out
      </Button>
    </div>
  );
}
