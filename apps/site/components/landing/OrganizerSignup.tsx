"use client";

import { useState } from "react";
import { ArrowUpRight, LoaderCircle, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

type SubmissionState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "success"; email: string }
  | { kind: "error" };

export function OrganizerSignup() {
  const [state, setState] = useState<SubmissionState>({ kind: "idle" });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const email = String(formData.get("email") ?? "").trim();

    setState({ kind: "sending" });

    try {
      const { data, error } = await createClient().functions.invoke("organizer-inquiry", {
        body: {
          name: String(formData.get("name") ?? ""),
          email,
          organization: String(formData.get("organization") ?? ""),
          website: String(formData.get("website") ?? ""),
        },
      });

      if (error || !data?.ok) {
        setState({ kind: "error" });
        return;
      }

      form.reset();
      setState({ kind: "success", email });
    } catch {
      setState({ kind: "error" });
    }
  }

  const busy = state.kind === "sending";

  return (
    <div className="rounded-[28px] border border-forest/14 bg-white p-6 text-forest shadow-[0_26px_80px_rgb(13_48_35/.14)] sm:p-8">
      <div className="flex items-start justify-between gap-5 border-b border-forest/12 pb-6">
        <div>
          <p className="font-eyebrow text-[10px] font-bold uppercase tracking-[2px] text-primary">
            Organizer access
          </p>
          <h3 className="mt-2 font-display text-[26px] font-extrabold tracking-[-.7px]">
            Tell us about your race.
          </h3>
        </div>
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-primary">
          <MailCheck size={20} aria-hidden="true" />
        </span>
      </div>

      <form aria-label="Organizer signup" className="mt-6 space-y-5" onSubmit={submit}>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="organizer-name" className="text-[13px] font-semibold text-forest/78">
              Your name <span aria-hidden="true">*</span><span className="sr-only"> (required)</span>
            </Label>
            <Input
              id="organizer-name"
              name="name"
              autoComplete="name"
              minLength={2}
              maxLength={100}
              required
              placeholder="Juan dela Cruz"
              className="h-12 rounded-xl border-forest/14 bg-secondary/45 text-forest placeholder:text-forest/38 focus-visible:border-primary focus-visible:ring-primary/25"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="organizer-email" className="text-[13px] font-semibold text-forest/78">
              Work email <span aria-hidden="true">*</span><span className="sr-only"> (required)</span>
            </Label>
            <Input
              id="organizer-email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              required
              aria-describedby="organizer-form-note"
              placeholder="you@organization.com"
              className="h-12 rounded-xl border-forest/14 bg-secondary/45 text-forest placeholder:text-forest/38 focus-visible:border-primary focus-visible:ring-primary/25"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="organizer-organization" className="text-[13px] font-semibold text-forest/78">
            Organization or race name <span aria-hidden="true">*</span><span className="sr-only"> (required)</span>
          </Label>
          <Input
            id="organizer-organization"
            name="organization"
            autoComplete="organization"
            minLength={2}
            maxLength={160}
            required
            placeholder="Your club, company, or upcoming race"
            className="h-12 rounded-xl border-forest/14 bg-secondary/45 text-forest placeholder:text-forest/38 focus-visible:border-primary focus-visible:ring-primary/25"
          />
        </div>

        <div className="absolute -left-[9999px] top-auto size-px overflow-hidden" aria-hidden="true">
          <Label htmlFor="organizer-website">Website</Label>
          <Input id="organizer-website" name="website" tabIndex={-1} autoComplete="off" />
        </div>

        <Button
          type="submit"
          disabled={busy}
          className="h-12 w-full rounded-pill bg-primary text-[15px] font-bold text-primary-foreground shadow-none hover:bg-primary-focus"
        >
          {busy ? (
            <><LoaderCircle className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Sending request…</>
          ) : (
            <>Request organizer access <ArrowUpRight aria-hidden="true" /></>
          )}
        </Button>

        <p id="organizer-form-note" className="text-[12px] leading-5 text-muted-foreground">
          Your request goes to inquiries@racepace.com.ph. Race Pace will use these details only to contact you about organizer onboarding.
        </p>

        {state.kind === "success" ? (
          <p role="status" className="rounded-xl border border-primary/25 bg-secondary px-4 py-3 text-[13px] leading-5 text-forest">
            Request sent. We&apos;ll reply to {state.email} with the next steps.
          </p>
        ) : null}
        {state.kind === "error" ? (
          <p role="alert" className="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-[13px] leading-5 text-destructive">
            We couldn&apos;t send your request. Email inquiries@racepace.com.ph directly and we&apos;ll help you from there.
          </p>
        ) : null}
      </form>
    </div>
  );
}
