"use client";

import { useEffect, useState } from "react";
import { SHIRT_SIZES, BLOOD_TYPES, GENDERS } from "@race-pace/shared";
import { getProfile, upsertProfile, type Profile } from "@/lib/profile";
import type { PhotoKind } from "@/lib/profileImage";
import { signOut } from "@/lib/auth";
import { PassportPhotos } from "./PassportPhotos";
import { useMyRegistrations } from "@/lib/registration";
import { PillSelect } from "@/components/PillSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

/** One label/value row of the spec table. Read-only until asked — the whole
 *  passport used to be a column of open inputs, which made a page you mostly
 *  come to LOOK at feel like a form you have to fill in. */
function SpecRow({
  label,
  value,
  children,
  editing,
  onEdit,
}: {
  label: string;
  value: string | null | undefined;
  children: React.ReactNode;
  editing: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="border-b border-divider py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-4">
        <span className="text-[13px] text-muted-foreground">{label}</span>
        {editing ? null : (
          <span className="flex min-w-0 items-center gap-3">
            <span className="font-mono-race truncate text-[13px] font-medium text-foreground">
              {value || <span className="text-muted-foreground">—</span>}
            </span>
            <button
              type="button"
              onClick={onEdit}
              className="shrink-0 text-[11px] font-bold uppercase tracking-[1px] text-primary hover:text-primary-focus"
            >
              Edit
            </button>
          </span>
        )}
      </div>
      {editing ? <div className="mt-2.5">{children}</div> : null}
    </div>
  );
}

export function ProfileForm({ userId }: { userId: string }) {
  const [profile, setProfile] = useState<Partial<Profile>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const career = useCareer();

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

  const edit = (k: string) => setOpen((s) => new Set(s).add(k));
  const isOpen = (k: string) => open.has(k);

  /** Photos save on their own, not with the Save button — a runner who picks a
   *  photo has already committed to it, and leaving it unsaved next to a form
   *  they may never submit would silently lose the upload. */
  async function savePhoto(kind: PhotoKind, url: string | null) {
    const column = kind === "avatar" ? "avatar_url" : "cover_url";
    // Persist before showing it: a band that displays a photo the database
    // rejected would come back empty on the next load with no explanation.
    const { error } = await upsertProfile({ id: userId, [column]: url });
    if (error) throw new Error(error);
    setProfile((p) => ({ ...p, [column]: url }));
  }

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
    if (error) {
      setError(error);
      return;
    }
    setSaved(true);
    // Collapse every open row on a successful save — leaving them open makes
    // it ambiguous whether the change landed.
    setOpen(new Set());
  }

  if (loading) return <p className="py-20 text-center text-muted-foreground">Loading…</p>;

  const mark = initials(profile.full_name);
  const dirty = open.size > 0;
  // "Ready" means a registration can be prefilled without stopping — the two
  // fields every race form asks for that aren't the email already on file.
  const ready = !!profile.full_name && !!profile.emergency_contact;

  return (
    <div className="flex flex-col">
      <div className="overflow-hidden rounded-xl border border-border">
        {/* Identity band — the same forest/trail-green language TicketCard uses
            for a runner's race pass, so a signed-in account reads as the same
            passport before a race is ever entered, not a generic settings form. */}
        <PassportPhotos
          userId={userId}
          name={profile.full_name}
          mark={mark}
          avatarUrl={profile.avatar_url}
          coverUrl={profile.cover_url}
          onChange={savePhoto}
        />

        <dl className="grid grid-cols-3 border-b border-divider bg-card">
          <Figure label="Races" value={career.races} />
          <Figure label="Distance" value={career.km} unit="km" />
          {/* Not a count — whether the passport is complete enough to prefill
              a registration without stopping to type. */}
          <Figure label="Passport" text={ready ? "Ready" : "Setup"} />
        </dl>

        <div className="bg-card px-5 pb-3">
          <SpecRow label="Full name" value={profile.full_name} editing={isOpen("full_name")} onEdit={() => edit("full_name")}>
            <Label htmlFor="full_name" className="sr-only">
              Full name
            </Label>
            <Input id="full_name" value={profile.full_name ?? ""} onChange={(e) => set("full_name", e.target.value)} />
          </SpecRow>

          <SpecRow label="Bib name" value={profile.bib_name} editing={isOpen("bib_name")} onEdit={() => edit("bib_name")}>
            <Label htmlFor="bib_name" className="sr-only">
              Bib name
            </Label>
            <Input id="bib_name" value={profile.bib_name ?? ""} onChange={(e) => set("bib_name", e.target.value)} />
            <p className="mt-1.5 text-[12.5px] text-muted-foreground">Printed on your race bib.</p>
          </SpecRow>

          <SpecRow
            label="Date of birth"
            value={profile.date_of_birth}
            editing={isOpen("date_of_birth")}
            onEdit={() => edit("date_of_birth")}
          >
            <Label htmlFor="date_of_birth" className="sr-only">
              Date of birth
            </Label>
            <Input
              id="date_of_birth"
              type="date"
              value={profile.date_of_birth ?? ""}
              onChange={(e) => set("date_of_birth", e.target.value)}
            />
          </SpecRow>

          <SpecRow
            label="Emergency contact"
            value={profile.emergency_contact}
            editing={isOpen("emergency_contact")}
            onEdit={() => edit("emergency_contact")}
          >
            <Label htmlFor="emergency_contact" className="sr-only">
              Emergency contact
            </Label>
            <Input
              id="emergency_contact"
              value={profile.emergency_contact ?? ""}
              onChange={(e) => set("emergency_contact", e.target.value)}
              placeholder="Name and mobile number"
            />
          </SpecRow>

          <SpecRow label="Gender" value={profile.gender} editing={isOpen("gender")} onEdit={() => edit("gender")}>
            <PillSelect label="GENDER" value={profile.gender ?? ""} options={GENDERS} onChange={(v) => set("gender", v)} />
          </SpecRow>

          <SpecRow
            label="Shirt size"
            value={profile.shirt_size}
            editing={isOpen("shirt_size")}
            onEdit={() => edit("shirt_size")}
          >
            <PillSelect
              label="SHIRT SIZE"
              value={profile.shirt_size ?? ""}
              options={SHIRT_SIZES}
              onChange={(v) => set("shirt_size", v)}
            />
          </SpecRow>

          <SpecRow
            label="Blood type"
            value={profile.blood_type}
            editing={isOpen("blood_type")}
            onEdit={() => edit("blood_type")}
          >
            <PillSelect
              label="BLOOD TYPE"
              value={profile.blood_type ?? ""}
              options={BLOOD_TYPES}
              onChange={(v) => set("blood_type", v)}
            />
          </SpecRow>
        </div>
      </div>

      <p className="mt-5 text-[13.5px] leading-relaxed text-muted-foreground">
        These details prefill every race you enter, so you only type them once.
      </p>

      {error ? (
        <p role="alert" className="mt-4 text-[14px] text-destructive">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="mt-4 text-[14px] text-primary">
          Saved.
        </p>
      ) : null}

      {/* Save only appears once something is open to save. A permanently
          visible Save on a page with no open field invites the click that
          does nothing. */}
      {dirty ? (
        <Button
          type="button"
          disabled={busy}
          onClick={save}
          className="mt-5 h-auto rounded-pill py-4 text-[15px] font-semibold"
        >
          {busy ? "Saving…" : "Save changes"}
        </Button>
      ) : null}

      <Button
        type="button"
        variant="outline"
        onClick={() => signOut().then(() => window.location.assign("/"))}
        className="mt-3 h-auto rounded-pill py-4 text-[14px] font-semibold text-muted-foreground"
      >
        Sign out
      </Button>
    </div>
  );
}
