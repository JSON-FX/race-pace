"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Icon-only copy affordance for a single value (an email, a reference id).
 *
 * Sized to the 24px hairline square the detail modal uses beside truncated
 * text, NOT to the Button component's 36px default — inline with a 11.5px
 * email, a full-height button would out-weigh the value it copies. The tap
 * target is still met: `before:` expands the hit area to 44px without moving
 * anything around it (a padded button would push the email's truncation point).
 *
 * `label` becomes the accessible name, so a screen reader hears "Copy email"
 * rather than "button" — the icon alone carries no meaning (§1 aria-labels).
 */
export function CopyButton({ value, label, className }: {
  value: string;
  /** What is being copied, lowercase: "email", "registration id". Used for
   *  both the accessible name and the toast. */
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The checkmark is on a timer, so it can outlive the modal that owns it —
  // React then warns about a state update on an unmounted component, and in a
  // fast open/close/open it would flash a stale "copied" on a different runner.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <button
      type="button"
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      className={cn(
        "relative inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors",
        "before:absolute before:left-1/2 before:top-1/2 before:size-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']",
        "hover:border-primary/40 hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          // Insecure origin, or the user denied clipboard permission. Say so
          // instead of showing a checkmark for something that never copied.
          toast.error(`Couldn't copy the ${label}.`);
          return;
        }
        setCopied(true);
        toast.success(`${label.charAt(0).toUpperCase()}${label.slice(1)} copied.`);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1600);
      }}
    >
      {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
    </button>
  );
}
