"use client";

import { useCallback, useState, type ChangeEvent } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { ImageIcon, Upload } from "lucide-react";
import { toast } from "sonner";
import { getCroppedBlob } from "@/lib/cropImage";
import { uploadOrgImage, type OrgImageKind } from "@/lib/org-upload";
import { updateOrgBrandingAction } from "@/lib/actions/settings";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CropUploader({ orgId, kind, aspect, field, label, currentUrl, round, onSaved }: {
  orgId: string;
  kind: OrgImageKind;
  aspect: number;
  field: "logo_url" | "banner_url";
  label: string;
  currentUrl: string | null;
  round?: boolean;
  onSaved: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixels, setPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (src) URL.revokeObjectURL(src);
      setSrc(URL.createObjectURL(file));
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setPixels(null);
    }
    e.target.value = "";
  };

  function close() {
    if (src) URL.revokeObjectURL(src);
    setSrc(null);
    setPixels(null);
    setError(null);
  }
  const onCropComplete = useCallback((_a: Area, px: Area) => setPixels(px), []);

  async function save() {
    if (!src || !pixels) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await getCroppedBlob(src, pixels);
      const url = await uploadOrgImage(orgId, blob, kind);
      const res = await updateOrgBrandingAction(orgId, { [field]: url });
      if (!res.ok) throw new Error(res.error);
      close();
      toast.success("Branding updated");
      onSaved();
    } catch (e) {
      setError((e as Error).message || "Upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0">
      <div className="mb-2 text-[12px] font-bold">{label}</div>
      <div className="relative grid h-40 place-items-center overflow-hidden rounded-[13px] border border-dashed border-primary/35 bg-gradient-to-br from-secondary to-muted">
        {currentUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentUrl}
            alt={`Current ${label.toLowerCase()}`}
            className={cn(
              "object-cover",
              round ? "m-auto size-24 rounded-full border-4 border-card shadow-lg" : "size-full",
            )}
          />
        ) : round ? (
          <span className="grid size-24 place-items-center rounded-full border-4 border-card bg-forest text-[12px] font-bold text-white shadow-lg">
            No image
          </span>
        ) : (
          <ImageIcon className="size-8 text-primary/60" strokeWidth={1.5} aria-hidden="true" />
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-[10px] border bg-card px-3 text-[12px] font-bold transition-colors hover:bg-muted focus-within:ring-[3px] focus-within:ring-ring/30">
          <Upload className="size-4" aria-hidden="true" />
          {currentUrl ? "Replace" : "Choose image"}
          <input type="file" accept="image/*" aria-label={`Choose ${label}`} onChange={onFile} className="hidden" />
        </label>
        <span className="text-[10.5px] text-muted-foreground">
          {round ? "Square image" : "Recommended 13:5 ratio"}
        </span>
      </div>

      <Dialog open={!!src} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent aria-label={`Crop ${label}`} className="w-auto max-w-none gap-3 p-6">
          <DialogTitle className="sr-only">{`Crop ${label}`}</DialogTitle>
          {src ? (
            <>
              <div className="relative h-80 w-80 overflow-hidden rounded-[10px] bg-black">
                <Cropper image={src} crop={crop} zoom={zoom} aspect={aspect} cropShape={round ? "round" : "rect"}
                  onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete} />
              </div>
              {error ? <div role="alert" className="text-[13px] text-destructive">{error}</div> : null}
              <div className="flex justify-center gap-2">
                <Button type="button" variant="outline" onClick={close} disabled={busy}>Cancel</Button>
                <Button type="button" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
