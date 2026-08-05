import { useEffect, useRef, useState } from "react";
import QrScannerLib from "qr-scanner";
import { Button } from "@/components/ui/button";
import { Flashlight, CameraOff } from "lucide-react";

/** Camera token emitter. Knows nothing about check-in — it hands up a string.
 *  A cooldown stops one QR in frame from firing repeatedly. Design §6.1. */
export function QrScanner({ onScan, cooldownMs = 1500 }: { onScan: (token: string) => void; cooldownMs?: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastRef = useRef<{ token: string; at: number }>({ token: "", at: 0 });
  const [error, setError] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const scannerRef = useRef<QrScannerLib | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const scanner = new QrScannerLib(
      video,
      (result) => {
        const token = result.data;
        const now = Date.now();
        if (token === lastRef.current.token && now - lastRef.current.at < cooldownMs) return;
        lastRef.current = { token, at: now };
        onScanRef.current(token);
      },
      { highlightScanRegion: true, highlightCodeOutline: true, maxScansPerSecond: 5 },
    );
    scannerRef.current = scanner;
    scanner.start().catch(() => setError("Camera unavailable. Use the roster below to check runners in."));
    return () => { scanner.stop(); scanner.destroy(); scannerRef.current = null; };
  }, [cooldownMs]);

  if (error) {
    return (
      <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-6 text-center">
        <CameraOff className="size-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-black">
      <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline />
      <Button
        type="button" variant="secondary" size="sm" className="absolute bottom-3 right-3"
        onClick={async () => {
          const s = scannerRef.current;
          if (!s || !(await s.hasFlash())) return;
          await s.toggleFlash();
          setTorch(s.isFlashOn());
        }}
      >
        <Flashlight className="size-4" /> {torch ? "Torch off" : "Torch"}
      </Button>
    </div>
  );
}
