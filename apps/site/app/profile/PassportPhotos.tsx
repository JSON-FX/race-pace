"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Move, Trash2 } from "lucide-react";
import {
  uploadProfileImage,
  parsePhotoUrl,
  withFraming,
  framedImageStyle,
  PHOTO_ASPECT,
  type Framing,
  type PhotoKind,
} from "@/lib/profileImage";
import { PhotoFramer } from "./PhotoFramer";

const LABEL: Record<PhotoKind, string> = { avatar: "profile photo", cover: "cover photo" };

/** What the framer is working on: a file the runner just picked (upload on
 *  save) or the photo already stored (re-frame only, nothing to upload). */
type Session =
  | { kind: PhotoKind; mode: "new"; file: File; objectUrl: string }
  | { kind: PhotoKind; mode: "reframe"; src: string; framing: Framing };

/** The passport's identity band: a cover photo behind the runner's name, with
 *  the avatar overlapping its lower edge — the same arrangement the mobile Race
 *  Passport uses, so a runner who set their photos on the phone sees the same
 *  card on the web.
 *
 *  Both photos are optional and the band has to look deliberate without either,
 *  so the empty states are the forest field and an initials monogram rather
 *  than a grey placeholder box. */
export function PassportPhotos({
  userId,
  name,
  mark,
  avatarUrl,
  coverUrl,
  onChange,
}: {
  userId: string;
  name: string | null | undefined;
  mark: string;
  avatarUrl: string | null | undefined;
  coverUrl: string | null | undefined;
  /** Persist one column. Called with null when the runner removes a photo. */
  onChange: (kind: PhotoKind, url: string | null) => void | Promise<void>;
}) {
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState<PhotoKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputs = { avatar: useRef<HTMLInputElement>(null), cover: useRef<HTMLInputElement>(null) };

  const avatar = parsePhotoUrl(avatarUrl);
  const cover = parsePhotoUrl(coverUrl);

  // An object URL outlives the element that used it, so release it when the
  // framing session it belongs to goes away.
  useEffect(() => {
    if (session?.mode !== "new") return;
    const url = session.objectUrl;
    return () => URL.revokeObjectURL(url);
  }, [session]);

  function startNew(kind: PhotoKind, file: File | undefined) {
    if (!file) return;
    setError(null);
    setSession({ kind, mode: "new", file, objectUrl: URL.createObjectURL(file) });
  }

  function startReframe(kind: PhotoKind) {
    const photo = kind === "avatar" ? avatar : cover;
    if (!photo) return;
    setError(null);
    setSession({ kind, mode: "reframe", src: photo.src, framing: photo.framing });
  }

  /** Save what the framer produced. A new photo uploads first; re-framing an
   *  existing one only rewrites the stored URL's fragment, so it is instant. */
  async function commit(framing: Framing) {
    if (!session) return;
    const { kind } = session;
    setBusy(kind);
    setError(null);
    try {
      const src = session.mode === "new" ? await uploadProfileImage(userId, kind, session.file) : session.src;
      await onChange(kind, withFraming(src, framing));
      setSession(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Couldn't update your ${LABEL[kind]}. Please try again.`);
    } finally {
      setBusy(null);
    }
  }

  async function remove(kind: PhotoKind) {
    setBusy(kind);
    setError(null);
    try {
      await onChange(kind, null);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Couldn't remove your ${LABEL[kind]}.`);
    } finally {
      setBusy(null);
    }
  }

  /** A hidden file input per photo. `value` is cleared on every pick so that
   *  re-choosing the same file still fires change. */
  const fileInput = (kind: PhotoKind) => (
    <input
      ref={inputs[kind]}
      type="file"
      accept="image/jpeg,image/png,image/webp"
      className="hidden"
      data-testid={`${kind}-input`}
      aria-label={`Upload ${LABEL[kind]}`}
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        startNew(kind, file);
      }}
    />
  );

  return (
    <div>
      {/* The cover IS the identity band — full bleed, with the runner's avatar and
          name sitting on top of it. A ratio rather than a fixed height: the stored
          framing was cut to PHOTO_ASPECT, so a band that changed shape at a
          breakpoint would stretch the photo at one size or the other. */}
      <div
        className="relative w-full overflow-hidden bg-forest"
        style={{ aspectRatio: PHOTO_ASPECT.cover }}
      >
        {cover ? (
          // Not next/image: the URL is runner-set, may be absent, and the
          // framing is applied by explicit geometry rather than object-fit.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover.src} alt="" style={framedImageStyle(cover.framing)} />
        ) : null}
        {/* Bottom-weighted scrim: dark enough under the name to keep white type
            legible on any photo, near-clear at the top so the picture still reads
            as a picture. */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/10" />

        <div className="absolute right-3 top-3 flex items-center gap-1.5">
            {cover ? (
              <>
                <PhotoButton
                  label="Reposition cover photo"
                  onClick={() => startReframe("cover")}
                  disabled={busy !== null}
                  busy={busy === "cover"}
                >
                  <Move className="size-3.5" aria-hidden />
                </PhotoButton>
                <PhotoButton
                  label="Remove cover photo"
                  onClick={() => remove("cover")}
                  disabled={busy !== null}
                  busy={busy === "cover"}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </PhotoButton>
              </>
            ) : null}
            <PhotoButton
              label={cover ? "Change cover photo" : "Add cover photo"}
              onClick={() => inputs.cover.current?.click()}
              disabled={busy !== null}
              busy={busy === "cover"}
            >
              <Camera className="size-3.5" aria-hidden />
              <span className="font-eyebrow text-[10px] font-bold uppercase tracking-[1.4px]">
                {cover ? "Change" : "Add cover"}
              </span>
            </PhotoButton>
        </div>

        {/* Identity, sitting on the photo rather than in a band beneath it. */}
        <div className="absolute inset-x-0 bottom-0 flex items-end gap-4 px-5 pb-4">
          <div className="relative shrink-0">
            <span className="relative flex size-20 items-center justify-center overflow-hidden rounded-full border-2 border-white/70 bg-forest/70 font-display text-[24px] font-extrabold tracking-[-0.2px] text-[#7FE0A6] backdrop-blur-sm">
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatar.src}
                  alt={name ? `${name}'s profile photo` : "Your profile photo"}
                  style={framedImageStyle(avatar.framing)}
                />
              ) : (
                <span aria-hidden>{mark || "◈"}</span>
              )}
            </span>
            <button
              type="button"
              onClick={() => inputs.avatar.current?.click()}
              disabled={busy !== null}
              aria-label={avatar ? "Change profile photo" : "Add profile photo"}
              className="absolute -bottom-0.5 -right-0.5 flex size-7 items-center justify-center rounded-full border-2 border-white/70 bg-primary text-white transition-colors hover:bg-primary-focus disabled:opacity-60"
            >
              {busy === "avatar" ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Camera className="size-3.5" aria-hidden />
              )}
            </button>
          </div>

          <div className="min-w-0 pb-0.5">
            <p className="font-eyebrow text-[10.5px] font-bold uppercase tracking-[2.6px] text-[#7FE0A6]">Runner</p>
            <p className="mt-1 truncate font-display text-[21px] font-black uppercase leading-none tracking-[-0.9px] text-white">
              {name || "Add your name"}
            </p>
            {avatar ? (
              <p className="mt-1.5 flex items-center gap-3">
                <TextAction onClick={() => startReframe("avatar")} disabled={busy !== null}>
                  Reposition
                </TextAction>
                <TextAction onClick={() => remove("avatar")} disabled={busy !== null}>
                  Remove
                </TextAction>
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {fileInput("avatar")}
      {fileInput("cover")}

      {error ? (
        <p role="alert" className="bg-card px-5 pt-3 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}

      {/* Mounted only while framing, so every session starts from a clean
          crop/zoom instead of wherever the last one was left. */}
      {session ? (
        <PhotoFramer
          kind={session.kind}
          src={session.mode === "new" ? session.objectUrl : session.src}
          initial={session.mode === "reframe" ? session.framing : null}
          busy={busy !== null}
          onCancel={() => setSession(null)}
          onSave={commit}
        />
      ) : null}
    </div>
  );
}

function TextAction({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="text-[11px] font-bold uppercase tracking-[1px] text-white/70 hover:text-white disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function PhotoButton({
  label,
  onClick,
  disabled,
  busy,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex items-center gap-1.5 rounded-pill bg-black/45 px-2.5 py-1.5 text-white backdrop-blur-sm transition-colors hover:bg-black/65 disabled:opacity-60"
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : children}
    </button>
  );
}
