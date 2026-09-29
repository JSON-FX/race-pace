"use client";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { useEffect, useRef, useState } from "react";
import { UploadCloud, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import styles from "./screening.module.css";
import { screeningOperation, uploadProof, verifyProof, validateProofFile, type ProofTicket } from "@/lib/prescreening";

export function ProofUpload({ passportId, categoryId, name, disabled, onVerified }: {
  passportId: string; categoryId: string; name: string; disabled?: boolean; onVerified: (id?: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [ticket, setTicket] = useState<ProofTicket | null>(null);
  const [uploaded, setUploaded] = useState(false);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file || validateProofFile(file)) { setPreview(null); return; }
    const url = URL.createObjectURL(file); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function choose(selected: File) {
    setFile(selected); setTicket(null); setUploaded(false); setProgress(0); setVerified(false); onVerified(undefined); void start(selected);
  }
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function start(selected: File, prepared?: ProofTicket) {
    const invalid = validateProofFile(selected);
    setError(invalid); if (invalid) return;
    setBusy(true); setVerified(false); onVerified(undefined);
    const current = new AbortController(); controller.current = current;
    try {
      const target = prepared ?? await screeningOperation<ProofTicket>("prescreening-proof", {
        action: "prepare", category_id: categoryId, participant_passport_id: passportId,
      });
      if (current.signal.aborted) return;
      setTicket(target);
      if (prepared && uploaded) await verifyProof(target);
      else await uploadProof(selected, target, setProgress, current.signal, () => setUploaded(true));
      if (!current.signal.aborted) { setVerified(true); onVerified(target.upload_id); }
    } catch (cause) { if (!current.signal.aborted) setError(cause instanceof Error ? cause.message : "Upload unavailable. Try again."); }
    finally { if (!current.signal.aborted) setBusy(false); }
  }
  return <div className={`${styles.proof} space-y-2`}>
    <label htmlFor={`proof-${passportId}`} className={styles.dropzone} data-disabled={disabled || busy}
      onDragOver={event => { event.preventDefault(); }} onDrop={event => {
        event.preventDefault(); if (disabled || busy) return;
        const selected = event.dataTransfer.files[0]; if (selected) choose(selected);
      }}>
      {preview ? <img src={preview} alt={`Selected proof for ${name}`} /> : <UploadCloud aria-hidden="true" />}
      <strong>{file ? "Change proof image" : "Choose proof image"}</strong>
      <Input id={`proof-${passportId}`} aria-label={`Choose proof image for ${name}`} type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || busy}
        className="sr-only" onChange={event => { const selected = event.target.files?.[0]; if (selected) choose(selected); }} />
      <span>or drag and drop it here</span>
      <span>JPEG, PNG, or WebP · up to 10 MB · 20 megapixels maximum</span>
    </label>
    {busy && <div role="status" className="text-xs"><Progress aria-label={`Uploading proof for ${name}`} max={100} value={progress} className="w-full" />{progress === 100 ? "Verifying image…" : `Uploading ${progress}%`}</div>}
    {verified && <p role="status" className="flex items-center gap-2 text-sm text-primary"><Check className="size-4" aria-hidden="true" />{file?.name} · ready to submit</p>}
    {error && <Alert variant="destructive" className="text-sm text-destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {file && error && !busy && <Button type="button" variant="outline" disabled={disabled} onClick={() => void start(file, ticket ?? undefined)}>{uploaded ? "Retry verification" : "Retry upload"}</Button>}
    <p className="text-xs text-muted-foreground">Private to you and authorized organizer reviewers. Uploading alone does not hold a slot.</p>
  </div>;
}
