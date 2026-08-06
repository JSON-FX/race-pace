"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, CameraOff, Check, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { isTicketTokenShape, splitRoster, type RosterRow } from "@/lib/checkin";
import { cn } from "@/lib/utils";
import { Roster, hhmm } from "./roster";

/** How a check-in was entered. Recorded client-side for this session only —
 *  `checkins` has no source column, so a row that was already in when the
 *  page loaded shows no source rather than a fabricated one. */
type Source = "Scanner" | "Camera" | "Manual";

type ScanResult =
  | { kind: "ok"; registrationId: string; runner: string; detail: string; offRoster: boolean }
  | { kind: "already"; registrationId: string; runner: string; detail: string }
  | { kind: "error"; title: string; detail: string };

/** The same token arriving twice inside this window is one scan, not two. A
 *  camera decodes the same QR on every animation frame, and some wedge
 *  scanners fire twice on a single trigger pull. */
const DEDUPE_MS = 2500;

/** Maps the Edge Function's error codes to something a marshal can act on.
 *  `invalid_ticket` after our own shape check passed means the HMAC really
 *  didn't verify — a screenshot of a token from another environment, or a
 *  tampered QR — so it must NOT be described as a scanner problem. */
function messageFor(code: string): { title: string; detail: string } {
  switch (code) {
    case "not_paid":
      return { title: "Blocked — payment not complete", detail: "This registration isn't paid, so the server refuses the check-in. Take payment first, then scan again." };
    case "invalid_ticket":
      return { title: "That ticket didn't verify", detail: "The signature is wrong. It may be a QR from a different environment, or an edited screenshot. Find the runner in the roster below instead." };
    case "not_found":
      return { title: "No registration for that ticket", detail: "The ticket verified but its registration no longer exists." };
    case "forbidden":
      return { title: "Not authorized for this event", detail: "Your account can't check runners in for this race. Ask an org admin to scope you to it." };
    case "unauthorized":
      return { title: "Your session expired", detail: "Sign in again, then keep scanning." };
    default:
      return { title: "Check-in failed", detail: "The server didn't accept that scan. Try again, or use the roster below." };
  }
}

export type CheckInStationProps = {
  eventId: string;
  eventName: string;
  initialRows: RosterRow[];
};

/**
 * The scan station: one dark scan bar over the two roster tables.
 *
 * Three inputs are live at once — they are not modes:
 *   1. A hardware 2D imager (PRIMARY). It is a keyboard wedge: it types the
 *      token and presses Enter into the permanently-focused hidden field
 *      below. No driver, no decode library, no camera permission.
 *   2. The device camera (fallback), decoded with jsQR on rAF.
 *   3. A manual tap in the roster (always available) — the only path that
 *      works with no hardware at all.
 *
 * All three funnel into one `submitScan`, and `submitScan` always POSTs to
 * the `check-in` Edge Function. The roster carries `ticket_token`, so
 * matching a scan locally would be faster and would work offline — but the
 * function is the only thing that verifies the HMAC, and a local match would
 * happily accept a screenshot of someone else's QR. That is not an
 * optimisation worth having.
 *
 * State is held here rather than re-read from the server after every scan:
 * the roster row already carries everything the tables render, and a start
 * line is the worst possible place to spend a round trip re-reading data we
 * just correctly mutated.
 */
export function CheckInStation({ eventId, eventName, initialRows }: CheckInStationProps) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<RosterRow[]>(initialRows);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [sources, setSources] = useState<Record<string, string>>({});
  const [cameraOn, setCameraOn] = useState(false);
  const [listening, setListening] = useState(false);

  // A fresh event id means a different roster: reseed rather than leaving the
  // previous race's runners on screen.
  useEffect(() => {
    setRows(initialRows);
    setResult(null);
    setSources({});
  }, [initialRows, eventId]);

  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const lastScanRef = useRef<{ token: string; at: number }>({ token: "", at: 0 });

  const markBusy = (id: string, on: boolean) =>
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const submitScan = useCallback(
    async (raw: string, source: Source) => {
      const token = raw.trim();
      if (!token) return;

      const now = Date.now();
      if (lastScanRef.current.token === token && now - lastScanRef.current.at < DEDUPE_MS) return;
      lastScanRef.current = { token, at: now };

      // Shape check BEFORE the network. A wedge scanner configured for a
      // non-US keyboard layout mistranslates the `-` and `_` that base64url
      // uses, so the token arrives corrupted and would come back as a
      // meaningless "invalid ticket" — sending the marshal to inspect the
      // runner's phone instead of the scanner's own configuration.
      if (!isTicketTokenShape(token)) {
        setResult({
          kind: "error",
          title: "That scan didn't look like a ticket",
          detail:
            source === "Scanner"
              ? "Check the scanner's keyboard layout — set it to US English. On other layouts it mistypes the - and _ characters a ticket uses."
              : "The code scanned isn't a Race Pace ticket.",
        });
        return;
      }

      const known = rowsRef.current.find((r) => r.ticket_token === token);
      if (known) markBusy(known.registration_id, true);

      const { data, error } = await supabase.functions.invoke("check-in", {
        body: { ticket_token: token },
      });

      if (known) markBusy(known.registration_id, false);

      if (error) {
        // supabase-js throws on any non-2xx and hands back the raw Response
        // on `context`; the function's own error code lives in its body.
        const ctx = (error as { context?: Response }).context;
        let code = "server_error";
        if (ctx && typeof ctx.json === "function") {
          const body = (await ctx.json().catch(() => null)) as { error?: string } | null;
          code = body?.error ?? code;
        }
        setResult({ kind: "error", ...messageFor(code) });
        return;
      }

      const payload = data as { ok?: boolean; registration_id?: string; already?: boolean } | null;
      const id = payload?.registration_id;
      if (!payload?.ok || !id) {
        setResult({ kind: "error", ...messageFor("server_error") });
        return;
      }

      const row = rowsRef.current.find((r) => r.registration_id === id);

      // A re-scan is AMBER, never green. The function reports it with
      // `already: true`, and rendering that as a green tick would let a
      // double-scan read as a fresh success — the exact moment a marshal
      // waves through someone who was never actually verified.
      if (payload.already) {
        setResult({
          kind: "already",
          registrationId: id,
          runner: row?.runner ?? "Runner",
          detail: row?.checked_in_at
            ? `${row.category || "—"} · already checked in at ${hhmm(row.checked_in_at)}`
            : "Already checked in.",
        });
        return;
      }

      const at = new Date().toISOString();
      setRows((prev) => prev.map((r) => (r.registration_id === id ? { ...r, checked_in_at: at } : r)));
      setSources((prev) => ({ ...prev, [id]: source }));
      setResult({
        kind: "ok",
        registrationId: id,
        runner: row?.runner ?? "Checked in",
        // A token that verifies but isn't on THIS roster is a real race-day
        // failure mode at a multi-race venue: the runner is genuinely checked
        // in, just to a different event. Say so rather than showing a plain tick.
        offRoster: !row,
        detail: row
          ? `${row.category || "—"}${row.bib ? ` · Bib ${row.bib}` : ""} · checked in ${hhmm(at)}`
          : `Not on ${eventName}'s roster — this ticket belongs to another event.`,
      });
    },
    [supabase, eventName],
  );

  // The camera loop closes over submitScan; keep the latest one in a ref so
  // the stream isn't torn down and rebuilt whenever the callback identity
  // changes (which would drop frames mid-queue).
  const submitRef = useRef(submitScan);
  submitRef.current = submitScan;

  const undo = useCallback(
    async (row: RosterRow) => {
      markBusy(row.registration_id, true);
      const { data, error } = await supabase.rpc("checkin_undo", {
        p_registration_id: row.registration_id,
      });
      markBusy(row.registration_id, false);

      if (error) {
        toast.error(
          error.code === "42501"
            ? "You're not authorized to undo a check-in for this event."
            : "Undo failed. Please try again.",
        );
        return;
      }
      if (data !== "undone") {
        toast.error("That registration no longer exists.");
        return;
      }

      setRows((prev) =>
        prev.map((r) => (r.registration_id === row.registration_id ? { ...r, checked_in_at: null } : r)),
      );
      setSources((prev) => {
        const next = { ...prev };
        delete next[row.registration_id];
        return next;
      });
      setResult((prev) =>
        prev && "registrationId" in prev && prev.registrationId === row.registration_id ? null : prev,
      );
      // Undo is the one action worth confirming out of band: it happens when
      // someone scanned the wrong person, and the row simply vanishing from
      // the checked-in table is easy to miss in a crowd.
      toast.success(`${row.runner} moved back to not-checked-in.`);
    },
    [supabase],
  );

  const checkIn = useCallback(
    (row: RosterRow) => {
      if (!row.ticket_token) {
        setResult({
          kind: "error",
          title: "No ticket on that registration",
          detail: "A ticket is only issued once payment clears, and the check-in function needs one.",
        });
        return;
      }
      void submitScan(row.ticket_token, "Manual");
    },
    [submitScan],
  );

  // ---- input 1: the hardware wedge (primary) -----------------------------
  // Keep the hidden field focused, because a wedge scanner types into
  // whatever has focus. Refocus only when the click landed on nothing
  // focusable — stealing focus back from the roster's search box would make
  // the page impossible to type in.
  useEffect(() => {
    inputRef.current?.focus();
    const onPointerUp = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input,textarea,select,button,a,[contenteditable],[role='combobox'],[role='dialog']")) return;
      inputRef.current?.focus();
    };
    document.addEventListener("pointerup", onPointerUp);
    return () => document.removeEventListener("pointerup", onPointerUp);
  }, []);

  // ---- input 2: the camera (fallback) ------------------------------------
  useEffect(() => {
    if (!cameraOn) return;
    const video = videoRef.current;
    if (!video) return;

    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;

    const stop = () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
        // jsQR is ~40 KB and only the FALLBACK input needs it. Importing it
        // here rather than at module scope keeps it out of the first load for
        // everyone scanning with a wedge, which is most of them.
        const { default: jsQR } = await import("jsqr");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        await video.play();

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const tick = () => {
          raf = requestAnimationFrame(tick);
          if (!ctx || video.readyState < 2 || !video.videoWidth) return;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "dontInvert" });
          if (code?.data) void submitRef.current(code.data, "Camera");
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setCameraOn(false);
        toast.error("Couldn't open the camera. Grant camera access, or keep using the scanner and the roster.");
      }
    })();

    // Runs on toggle-off AND on unmount: an un-stopped MediaStream keeps the
    // camera light on and the sensor powered after you leave the page.
    return stop;
  }, [cameraOn]);

  const { pending, done } = useMemo(() => splitRoster(rows), [rows]);
  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category).filter(Boolean))].sort(),
    [rows],
  );
  const rate = rows.length === 0 ? 0 : Math.round((done.length / rows.length) * 100);

  return (
    <>
      {/*
        `dark` is deliberate, not a mode toggle: the scan bar is a permanently
        dark forest surface in every theme, and scoping the dark token set to
        this subtree lets it use bg-paid / text-foreground / border-* instead
        of the raw hexes the mockup hard-codes, which design tokens forbid.
      */}
      <div className="dark mb-[13px] grid items-center gap-5 rounded-xl bg-forest px-[18px] py-4 text-foreground md:grid-cols-[1fr_auto]">
        <div>
          <div className="mb-[11px] flex flex-wrap items-center gap-2.5">
            <span
              aria-hidden
              className={cn(
                "size-2 shrink-0 rounded-full",
                listening ? "bg-paid ring-3 ring-paid/25" : "bg-amber ring-3 ring-amber/25",
              )}
            />
            <span className="text-[11px] font-bold tracking-[0.09em] text-foreground/80">
              {listening ? "READY TO SCAN" : "SCANNER NOT LISTENING"}
            </span>
            <span
              className={cn(
                "rounded-pill px-2.5 py-[3px] text-[11px] font-bold",
                listening ? "bg-foreground/15 text-foreground/90" : "border border-foreground/20 text-foreground/50",
              )}
            >
              {listening ? "Keystrokes captured" : "Click the page to listen"}
            </span>
            <span
              className={cn(
                "rounded-pill px-2.5 py-[3px] text-[11px] font-bold",
                cameraOn ? "bg-foreground/15 text-foreground/90" : "border border-foreground/20 text-foreground/50",
              )}
            >
              {cameraOn ? "Camera on" : "Camera off"}
            </span>
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="border border-foreground/25 text-foreground hover:bg-foreground/10"
              onClick={() => setCameraOn((v) => !v)}
            >
              {cameraOn ? <CameraOff aria-hidden /> : <Camera aria-hidden />}
              {cameraOn ? "Stop camera" : "Start camera"}
            </Button>
          </div>

          {/* The primary input. Visually hidden but focusable — a 2D imager
              is a keyboard, so it just needs somewhere to type. */}
          <label className="sr-only" htmlFor="wedge">Scanned ticket</label>
          <input
            id="wedge"
            ref={inputRef}
            className="sr-only"
            // A hardware imager is a HID keyboard and is unaffected by this,
            // but without it a phone pops its on-screen keyboard over the
            // roster the moment the field takes focus — which it always has.
            inputMode="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onFocus={() => setListening(true)}
            onBlur={() => setListening(false)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const el = e.currentTarget;
              const value = el.value;
              el.value = "";
              void submitScan(value, "Scanner");
            }}
          />

          <div aria-live="polite">
            {result === null ? (
              <div className="rounded-xl border border-foreground/15 px-[15px] py-[13px] text-[13px] text-foreground/65">
                Point the imager at a runner&apos;s QR, or start the camera. No hardware? Tap
                <b className="font-semibold text-foreground"> Check in</b> on their roster row.
              </div>
            ) : result.kind === "error" ? (
              <div className="flex items-center gap-3 rounded-xl border border-destructive/45 bg-destructive/15 px-[15px] py-[13px]">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
                  <X className="size-5" aria-hidden />
                </span>
                <div>
                  <div className="text-[15px] font-bold tracking-[-0.01em]">{result.title}</div>
                  <div className="mt-0.5 text-[12px] font-medium text-foreground/65">{result.detail}</div>
                </div>
              </div>
            ) : result.kind === "already" ? (
              <div className="flex items-center gap-3 rounded-xl border border-amber/45 bg-amber/15 px-[15px] py-[13px]">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber text-forest">
                  <TriangleAlert className="size-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <div className="text-[19px] font-bold tracking-[-0.02em]">{result.runner}</div>
                  <div className="mt-0.5 text-[12px] font-semibold text-foreground/65">{result.detail}</div>
                </div>
              </div>
            ) : (
              <div
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-[15px] py-[13px]",
                  result.offRoster ? "border-amber/45 bg-amber/15" : "border-paid/40 bg-paid/15",
                )}
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full text-forest",
                    result.offRoster ? "bg-amber" : "bg-paid",
                  )}
                >
                  {result.offRoster ? <TriangleAlert className="size-5" aria-hidden /> : <Check className="size-5" aria-hidden />}
                </span>
                <div className="min-w-0">
                  <div className="text-[19px] font-bold tracking-[-0.02em]">{result.runner}</div>
                  <div className="mt-0.5 text-[12px] font-semibold text-foreground/65">{result.detail}</div>
                </div>
                <span className="flex-1" />
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  className="border border-foreground/25 text-foreground hover:bg-foreground/10"
                  onClick={() => {
                    const row = rows.find((r) => r.registration_id === result.registrationId);
                    if (row) void undo(row);
                  }}
                >
                  Undo
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-5">
          <div className="flex gap-6 text-right">
            <div>
              <div className="text-[11px] font-bold tracking-[0.07em] text-foreground/60">IN</div>
              <div className="text-[28px] font-bold leading-[1.1] tabular-nums tracking-[-0.03em]">{done.length}</div>
            </div>
            <div>
              <div className="text-[11px] font-bold tracking-[0.07em] text-foreground/60">LEFT</div>
              <div className="text-[28px] font-bold leading-[1.1] tabular-nums tracking-[-0.03em]">{pending.length}</div>
            </div>
            <div>
              <div className="text-[11px] font-bold tracking-[0.07em] text-foreground/60">RATE</div>
              <div className="text-[28px] font-bold leading-[1.1] tabular-nums tracking-[-0.03em]">{rate}%</div>
            </div>
          </div>

          <div className="relative size-24 shrink-0 overflow-hidden rounded-xl border border-foreground/15 bg-forest">
            <video
              ref={videoRef}
              muted
              playsInline
              aria-label="Camera viewfinder"
              className={cn("size-full object-cover", cameraOn ? "block" : "hidden")}
            />
            {(["left-3 top-3 border-r-0 border-b-0", "right-3 top-3 border-l-0 border-b-0",
               "left-3 bottom-3 border-r-0 border-t-0", "right-3 bottom-3 border-l-0 border-t-0"] as const).map((pos) => (
              <span key={pos} aria-hidden className={cn("absolute size-[17px] rounded-[3px] border-[2.5px] border-paid", pos)} />
            ))}
          </div>
        </div>
      </div>

      <Roster
        pending={pending}
        done={done}
        categories={categories}
        busy={busy}
        sources={sources}
        onCheckIn={checkIn}
        onUndo={undo}
      />
    </>
  );
}
