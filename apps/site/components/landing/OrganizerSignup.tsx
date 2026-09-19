"use client";

import { useState } from "react";
import { ArrowUpRight, LoaderCircle, MailCheck, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getOrganizerInquiryCaptchaToken } from "@/lib/recaptcha";
import { createClient } from "@/lib/supabase/client";

type SubmissionState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "success"; email: string }
  | { kind: "error" };

const fieldClass = "h-12 rounded-xl border-forest/14 bg-secondary/45 text-forest placeholder:text-forest/38 focus-visible:border-primary focus-visible:ring-primary/25";

export function OrganizerSignup() {
  const [open, setOpen] = useState(false);
  const [messageLength, setMessageLength] = useState(0);
  const [state, setState] = useState<SubmissionState>({ kind: "idle" });

  function changeOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setMessageLength(0);
      setState({ kind: "idle" });
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = String(formData.get("email") ?? "").trim();

    setState({ kind: "sending" });

    try {
      const captchaToken = await getOrganizerInquiryCaptchaToken();
      const { data, error } = await createClient().functions.invoke("organizer-inquiry", {
        body: {
          firstName: String(formData.get("firstName") ?? ""),
          lastName: String(formData.get("lastName") ?? ""),
          email,
          audience: String(formData.get("audience") ?? ""),
          subject: String(formData.get("subject") ?? ""),
          message: String(formData.get("message") ?? ""),
          website: String(formData.get("website") ?? ""),
          captchaToken,
        },
      });

      if (error || !data?.ok) {
        setState({ kind: "error" });
        return;
      }

      form.reset();
      setMessageLength(0);
      setState({ kind: "success", email });
    } catch {
      setState({ kind: "error" });
    }
  }

  const busy = state.kind === "sending";

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <div className="rounded-[28px] border border-forest/14 bg-white p-6 text-forest shadow-[0_26px_80px_rgb(13_48_35/.14)] sm:p-8">
        <div className="flex items-start justify-between gap-5 border-b border-forest/12 pb-6">
          <div>
            <p className="font-eyebrow text-[10px] font-bold uppercase tracking-[2px] text-primary">
              Talk to Race Pace
            </p>
            <h3 className="mt-2 font-display text-[28px] font-extrabold tracking-[-.8px]">
              What can we help with?
            </h3>
          </div>
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-primary">
            <MailCheck size={20} aria-hidden="true" />
          </span>
        </div>

        <p className="mt-6 text-[15px] leading-7 text-foreground/70">
          Whether you are preparing to run or organizing the start line, send us your question. We&apos;ll route it to the right person.
        </p>

        <div className="mt-5 flex flex-wrap gap-2" aria-label="Who can inquire">
          <span className="rounded-pill border border-forest/12 bg-secondary/55 px-3 py-2 text-[12px] font-semibold text-forest">
            Runner support
          </span>
          <span className="rounded-pill border border-forest/12 bg-secondary/55 px-3 py-2 text-[12px] font-semibold text-forest">
            Organizer access
          </span>
        </div>

        <DialogTrigger asChild>
          <Button className="mt-7 h-12 w-full rounded-pill bg-primary text-[15px] font-bold text-primary-foreground shadow-none hover:bg-primary-focus">
            Send an inquiry <ArrowUpRight aria-hidden="true" />
          </Button>
        </DialogTrigger>

        <p className="mt-4 text-[12px] leading-5 text-muted-foreground">
          Messages go directly to inquiries@racepace.com.ph.
        </p>
      </div>

      <DialogContent className="bottom-0 top-auto max-h-[calc(100dvh-1rem)] max-w-none translate-y-0 gap-0 overflow-y-auto rounded-b-none rounded-t-[28px] border-forest/12 p-0 text-forest sm:bottom-auto sm:top-1/2 sm:max-w-2xl sm:-translate-y-1/2 sm:rounded-[28px]">
        <DialogHeader className="border-b border-forest/12 px-6 py-6 pr-16 sm:px-8">
          <p className="font-eyebrow text-[10px] font-bold uppercase tracking-[2px] text-primary">
            Race Pace inquiries
          </p>
          <DialogTitle className="font-display text-[30px] font-extrabold tracking-[-.9px] text-forest">
            How can we help?
          </DialogTitle>
          <DialogDescription className="text-[14px] leading-6">
            Share the details below. We&apos;ll reply to the email you provide.
          </DialogDescription>
        </DialogHeader>

        <form aria-label="Inquiry form" className="space-y-5 px-6 py-6 sm:px-8" onSubmit={submit}>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="inquiry-first-name" className="text-[13px] font-semibold text-forest/78">
                First name <span aria-hidden="true">*</span><span className="sr-only"> (required)</span>
              </Label>
              <Input id="inquiry-first-name" name="firstName" autoComplete="given-name" minLength={1} maxLength={80} required placeholder="Juan" className={fieldClass} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inquiry-last-name" className="text-[13px] font-semibold text-forest/78">
                Last name <span aria-hidden="true">*</span><span className="sr-only"> (required)</span>
              </Label>
              <Input id="inquiry-last-name" name="lastName" autoComplete="family-name" minLength={1} maxLength={80} required placeholder="dela Cruz" className={fieldClass} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="inquiry-email" className="text-[13px] font-semibold text-forest/78">
              Email <span aria-hidden="true">*</span><span className="sr-only"> (required)</span>
            </Label>
            <Input id="inquiry-email" name="email" type="email" autoComplete="email" maxLength={254} required placeholder="you@example.com" className={fieldClass} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="inquiry-audience" className="text-[13px] font-semibold text-forest/78">
              I&apos;m reaching out as <span aria-hidden="true">*</span><span className="sr-only"> (required)</span>
            </Label>
            <select id="inquiry-audience" name="audience" required defaultValue="" className={`${fieldClass} w-full px-3 outline-none focus-visible:ring-[3px]`}>
              <option value="" disabled>Select one</option>
              <option value="runner">Runner</option>
              <option value="organizer">Organizer</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="inquiry-subject" className="text-[13px] font-semibold text-forest/78">
              Subject <span aria-hidden="true">*</span><span className="sr-only"> (required)</span>
            </Label>
            <Input id="inquiry-subject" name="subject" minLength={2} maxLength={160} required placeholder="What do you need help with?" className={fieldClass} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="inquiry-message" className="text-[13px] font-semibold text-forest/78">
              Message <span aria-hidden="true">*</span><span className="sr-only"> (required)</span>
            </Label>
            <textarea
              id="inquiry-message"
              name="message"
              minLength={2}
              maxLength={5000}
              required
              placeholder="Tell us what you need help with..."
              onChange={(event) => setMessageLength(event.currentTarget.value.length)}
              className="min-h-36 w-full resize-y rounded-xl border border-forest/14 bg-secondary/45 px-3 py-3 text-[14px] text-forest outline-none placeholder:text-forest/38 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/25"
            />
            <div className="flex items-start justify-between gap-4 text-[11px] leading-5 text-muted-foreground">
              <span>Include the race or event name when relevant.</span>
              <span aria-live="polite" className="shrink-0 tabular-nums">{messageLength.toLocaleString()} / 5,000</span>
            </div>
          </div>

          <div className="absolute -left-[9999px] top-auto size-px overflow-hidden" aria-hidden="true">
            <Label htmlFor="inquiry-website">Website</Label>
            <Input id="inquiry-website" name="website" tabIndex={-1} autoComplete="off" />
          </div>

          <Button type="submit" disabled={busy} className="h-12 w-full rounded-pill bg-primary text-[15px] font-bold text-primary-foreground shadow-none hover:bg-primary-focus">
            {busy ? (
              <><LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Sending message…</>
            ) : (
              <>Send message <Send aria-hidden="true" /></>
            )}
          </Button>

          <p className="text-center text-[11px] leading-5 text-muted-foreground">
            Your message goes to inquiries@racepace.com.ph. We&apos;ll only use these details to respond to your inquiry.
          </p>

          {state.kind === "success" ? (
            <p role="status" className="rounded-xl border border-primary/25 bg-secondary px-4 py-3 text-[13px] leading-5 text-forest">
              Message sent. A confirmation email is on its way to {state.email}.
            </p>
          ) : null}
          {state.kind === "error" ? (
            <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-[13px] leading-5 text-destructive">
              We couldn&apos;t send your message. Email inquiries@racepace.com.ph directly and we&apos;ll help you from there.
            </p>
          ) : null}
        </form>
      </DialogContent>
    </Dialog>
  );
}
