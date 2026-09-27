"use client";

import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useCallback, useRef, useState, type ChangeEvent } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { ImageIcon, Upload } from "lucide-react";
import { toast } from "sonner";
import { getCroppedBlob } from "@/lib/cropImage";
import { uploadOrgImage, type OrgImageKind } from "@/lib/org-upload";
import { updateOrgBrandingAction } from "@/lib/actions/settings";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CropUploader({ orgId, kind, aspect, field, label, currentUrl, round, onSaved }: {
  orgId: string;
  kind: OrgImageKind;
  aspect: number;
  field: "logo_url" | "banner_url" | "featured_image_url";
  label: string;
  currentUrl: string | null;
  round?: boolean;
  onSaved: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
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

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await updateOrgBrandingAction(orgId, { [field]: null });
      if (!res.ok) throw new Error(res.error);
      toast.success("Featured image removed");
      onSaved();
    } catch (e) {
      setError((e as Error).message || "Remove failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0">
      <div className="mb-2 text-[12px] font-bold">{label}</div>
      <div className={cn("relative grid place-items-center overflow-hidden rounded-[13px] border border-dashed border-primary/35 bg-gradient-to-br from-secondary to-muted", kind === "featured" ? "aspect-[7/5] max-h-[360px]" : "h-40")}>
        {currentUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentUrl}
            alt={`Current ${label.toLowerCase()}`}
            className={cn(
              "object-cover",
              round ? "m-auto size-24 rounded-full border-4 border-card shadow-lg" : kind === "featured" ? "size-full object-contain" : "size-full",
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
        <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Upload className="size-4" aria-hidden="true" />
          {currentUrl ? "Replace" : "Choose image"}
          </Button>
        <Input ref={fileRef} type="file" accept="image/*" aria-label={`Choose ${label}`} onChange={onFile} className="hidden" />
        <span className="text-[10.5px] text-muted-foreground">
          {round ? "Square image" : kind === "featured" ? "Recommended 7:5 landscape photo" : "Recommended 13:5 ratio"}
        </span>
        {kind === "featured" && currentUrl ? <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={busy}>Remove image</Button> : null}
      </div>
      {error && !src ? <Alert variant="destructive" role="alert" className="mt-2"><AlertDescription>{error}</AlertDescription></Alert> : null}

      <Dialog open={!!src} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent aria-label={`Crop ${label}`} className="w-[min(368px,calc(100vw-2rem))] gap-3 p-6">
          <DialogTitle className="sr-only">{`Crop ${label}`}</DialogTitle>
          <DialogDescription className="sr-only">Drag to position the image, then save the crop.</DialogDescription>
          {src ? (
            <>
              <div className="relative aspect-square w-full overflow-hidden rounded-[10px] bg-black">
                <Cropper image={src} crop={crop} zoom={zoom} aspect={aspect} cropShape={round ? "round" : "rect"}
                  onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete} />
              </div>
              {error ? <Alert variant="destructive" role="alert" className=""><AlertDescription>{error}</AlertDescription></Alert> : null}
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
