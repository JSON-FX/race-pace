"use client";

import * as React from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * The event editor's section model.
 *
 * The old form was one 2,308px scroll of 36px controls with no headings, no
 * required markers, and nothing anywhere saying which parts still needed
 * attention — a race director had to read all of it to find out that Schedule
 * was empty. These pieces give it structure without changing what it saves.
 */

export type SectionMeta = {
  id: string;
  label: string;
  /** Filled-in count for the rail. `undefined` = not a countable section. */
  count?: number;
  /** Rail shows a filled dot when true. */
  done?: boolean;
};

/** One anchored block. `id` must match its SectionMeta so the rail can link. */
export function FormSection({
  id, title, hint, action, children, className, hideTitle,
}: {
  id: string;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** The child editor already renders its own heading. Omits the header row
   *  entirely rather than hiding it with sr-only — a visually-hidden duplicate
   *  is still a duplicate to a screen reader, and it made getByText("Images")
   *  ambiguous in tests, which is the same ambiguity a user would hear. */
  hideTitle?: boolean;
}) {
  return (
    // scroll-mt clears the sticky TopBar — without it an anchored jump puts the
    // section heading underneath the header and it reads as jumping to the
    // wrong place.
    <Card id={id} className={cn("scroll-mt-24 gap-0 rounded-xl border py-0 shadow-card", className)}>
      {hideTitle ? null : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3 md:px-5">
          <h2 className="text-[15px] font-bold tracking-[-0.01em]">{title}</h2>
          {hint ? <p className="text-[12px] text-muted-foreground">{hint}</p> : null}
          {action ? <div className="ml-auto">{action}</div> : null}
        </div>
      )}
      <div className="p-4 md:p-5">{children}</div>
    </Card>
  );
}

/**
 * A labelled field.
 *
 * Sentence case at 12.5px rather than the old 11px ALL-CAPS, which is the
 * hardest case to scan and wrapped "ELEVATION GAIN (M, OPTIONAL)" onto three
 * lines. Required is marked with an asterisk carrying an accessible name, not
 * by colour or by absence.
 *
 * Helper text renders BELOW the control it explains — above, it gets read as
 * part of the previous field.
 */
export function Field({
  label, htmlFor, required, hint, error, children, className,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <Label htmlFor={htmlFor} className="mb-1.5 block text-[12.5px] font-semibold text-foreground">
        {label}
        {required ? (
          <span className="ml-0.5 text-destructive" aria-label="required">*</span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="mt-1 text-[12px] font-medium text-destructive">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-[12px] leading-snug text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Sticky section navigator: a rail on desktop, a horizontal chip strip on
 * mobile.
 *
 * Answers "what still needs doing?" without scrolling — the dots and counts
 * show at a glance that Schedule and Add-ons are empty, which is the one thing
 * the old form could not tell you at any zoom level.
 */
export function SectionRail({ sections }: { sections: SectionMeta[] }) {
  const [active, setActive] = React.useState(sections[0]?.id);

  // Highlights whichever section is actually on screen, rather than trusting a
  // click — scrolling by hand must move the rail too, or it lies.
  React.useEffect(() => {
    // Scroll-spy is an ENHANCEMENT: without it the rail is still a working set
    // of anchor links, just without live highlighting. Guarded because
    // IntersectionObserver does not exist in jsdom, and a hard reference threw
    // during tests — a component that only works in a real browser is a
    // component that cannot be tested.
    if (typeof IntersectionObserver === "undefined") return;

    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      // Top-weighted band: a section counts as "current" once its heading is
      // near the top, not when its last pixel scrolls into view.
      { rootMargin: "-88px 0px -60% 0px", threshold: 0 },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [sections]);

  return (
    <nav aria-label="Form sections" className="lg:sticky lg:top-6">
      <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
        {sections.map((s) => {
          const on = s.id === active;
          return (
            <li key={s.id} className="shrink-0 lg:shrink">
              <a
                href={`#${s.id}`}
                aria-current={on ? "true" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-lg px-3 text-[13px] font-semibold transition-colors lg:px-2.5",
                  on ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-[7px] shrink-0 rounded-full",
                    s.done ? "bg-primary" : "bg-border",
                  )}
                />
                <span className="whitespace-nowrap">{s.label}</span>
                {s.count !== undefined ? (
                  <span className="ml-auto pl-2 text-[11px] font-bold tabular-nums text-muted-foreground">
                    {s.count}
                  </span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Save bar pinned to the bottom of the editor.
 *
 * Replaces a Save button stranded below three screens of form — and states
 * unsaved changes explicitly, because a long editor is exactly where someone
 * navigates away mid-edit and loses work they thought was saved.
 */
export function StickySaveBar({
  dirty, pending, error, onSave, onCancel,
}: {
  dirty: boolean;
  pending: boolean;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-30 -mx-4 mt-4 flex flex-wrap items-center gap-2 border-t border-border bg-card px-4 py-3 md:-mx-[30px] md:px-[30px]",
        "pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-3px_12px_rgb(16_24_40/0.06)]",
      )}
    >
      {error ? (
        <p role="alert" className="mr-auto text-[13px] font-medium text-destructive">{error}</p>
      ) : dirty ? (
        <p className="mr-auto flex items-center gap-1.5 text-[12.5px] font-semibold text-amber">
          <span aria-hidden className="size-[7px] rounded-full bg-amber" />
          Unsaved changes
        </p>
      ) : (
        <span className="mr-auto" />
      )}
      <button
        type="button"
        onClick={onCancel}
        className="min-h-11 rounded-pill border border-border bg-card px-5 text-[13.5px] font-semibold transition-colors hover:bg-muted"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={pending}
        className="min-h-11 rounded-pill bg-primary px-5 text-[13.5px] font-bold text-primary-foreground transition-colors hover:bg-primary-focus disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save event"}
      </button>
    </div>
  );
}
