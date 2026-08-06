"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EVENT_DISCIPLINES, DISCIPLINE_LABELS, disciplineLayout } from "@race-pace/shared";
import type { EditorData } from "@/lib/queries/event-editor";
import { saveEventAction, type CategoryDraft, type AddonDraft, type EventDraft, type EditorState } from "@/lib/actions/events";
import { eventInputSchema, categoryInputSchema, addonInputSchema, sanitizeListFields, coordPairError, EVENT_STATUSES } from "@/lib/validation";
import { CategoryEditor, addCategory } from "@/components/CategoryEditor";
import { AddonEditor } from "@/components/AddonEditor";
import { ScheduleEditor } from "@/components/ScheduleEditor";
import { InclusionsEditor } from "@/components/InclusionsEditor";
import { EventImagesEditor } from "@/components/EventImagesEditor";
import { PsgcAddressField } from "@/components/PsgcAddressField";
import { FormSection, Field, SectionRail, StickySaveBar, type SectionMeta } from "@/components/form-section";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// maplibre-gl reads `window` at module scope and throws during SSR — RouteEditor
// statically imports CourseDrawEditor (the actual map), so lazy-loading RouteEditor
// with ssr:false keeps the whole maplibre chunk out of the server render.
const RouteEditor = dynamic(
  () => import("@/components/RouteEditor").then((m) => m.RouteEditor),
  { ssr: false, loading: () => <div className="h-14 animate-pulse rounded-lg bg-muted" /> },
);

const fieldLabel = "mb-1.5 block text-[11px] font-semibold tracking-wide text-muted-foreground";

function blankDraft(orgId: string): EventDraft {
  return {
    org_id: orgId, name: "", city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null,
    event_date: null, end_date: null, flag_off: null, status: "draft", discipline: "trail",
    elevation_gain_m: null, cutoff_hours: null, start_lat: null, start_lng: null, finish_lat: null, finish_lng: null,
    route: null, description: null, hero_image_url: null, gallery: [], schedule: [], inclusions: [],
  };
}

function seedCats(data: EditorData): CategoryDraft[] {
  return data.categories.map((c) => ({
    id: c.id, code: c.code, label: c.label, distance_km: c.distance_km, base_price: c.base_price,
    slots_total: c.slots_total, elevation_gain_m: c.elevation_gain_m, cutoff_hours: c.cutoff_hours, blurb: c.blurb,
  }));
}
function seedAddons(data: EditorData): AddonDraft[] {
  return data.addons.map((a) => ({ id: a.id, name: a.name, price: a.price }));
}

export function EventEditorForm({ initial, orgId }: { initial: EditorData | null; orgId: string | null }) {
  const router = useRouter();

  const [event, setEvent] = useState<EventDraft>(() =>
    initial ? { ...initial.event, inclusions: initial.event.inclusions ?? [] } : blankDraft(orgId ?? ""));
  const [cats, setCats] = useState<CategoryDraft[]>(() => (initial ? seedCats(initial) : []));
  const [addons, setAddons] = useState<AddonDraft[]>(() => (initial ? seedAddons(initial) : []));
  const [origCats, setOrigCats] = useState<{ id?: string }[]>(() => (initial ? initial.categories.map((c) => ({ id: c.id })) : []));
  const [origAddons, setOrigAddons] = useState<{ id?: string }[]>(() => (initial ? initial.addons.map((a) => ({ id: a.id })) : []));
  const [error, setError] = useState<string | null>(null);
  const [qc] = useState(() => new QueryClient());

  // A snapshot of what the SERVER last handed us, so "unsaved changes" means
  // exactly that rather than "you touched something". Reset by the reseed effect
  // below, so a successful partial save clears the warning instead of leaving it
  // stuck on for work that did land.
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify({
      event: initial ? { ...initial.event, inclusions: initial.event.inclusions ?? [] } : blankDraft(orgId ?? ""),
      cats: initial ? seedCats(initial) : [],
      addons: initial ? seedAddons(initial) : [],
    }));

  // Structural comparison, not a touched-flag: typing a character and deleting
  // it again leaves the form clean, which is what an operator expects when they
  // decide whether it is safe to navigate away.
  const dirty = JSON.stringify({ event, cats, addons }) !== baseline;

  // Data now arrives as a prop, not a query — reseed local state whenever the
  // server hands us a NEW `initial` object (a genuine reference change: the
  // first mount, or a later router.refresh()/navigation after a partial save
  // reconciles child ids). Local edits never change `initial`'s identity, so
  // this does not fight with typing.
  const seededRef = useRef(initial);
  useEffect(() => {
    if (initial && initial !== seededRef.current) {
      seededRef.current = initial;
      setEvent({ ...initial.event, inclusions: initial.event.inclusions ?? [] });
      setCats(seedCats(initial));
      setAddons(seedAddons(initial));
      setOrigCats(initial.categories.map((c) => ({ id: c.id })));
      setOrigAddons(initial.addons.map((a) => ({ id: a.id })));
      setBaseline(JSON.stringify({
        event: { ...initial.event, inclusions: initial.event.inclusions ?? [] },
        cats: seedCats(initial),
        addons: seedAddons(initial),
      }));
    }
  }, [initial]);

  const [state, formAction] = useActionState<EditorState, FormData>(saveEventAction, {});
  const [pending, startTransition] = useTransition();

  const set = (patch: Partial<EventDraft>) => setEvent((e) => ({ ...e, ...patch }));
  const num = (v: string) => (v === "" ? null : Number(v));

  const invalid = useMemo(() => {
    // Status isn't validated here: "cancelled" (set only via the Cancel modal) is
    // intentionally outside EVENT_STATUSES, and the dropdown already restricts input
    // to valid values — validating it here would permanently block Save on a
    // cancelled event with a misleading "fix the event fields" message.
    // Parse once and reuse the OUTPUT for coordPairError, not the raw `event`
    // state — the schema's start/finish lat/lng fields are `.default(null)`,
    // so a value that's `undefined` (never happens from this form's own
    // inputs, but matters for anything else that might construct an
    // EventDraft) is normalized to `null` by the parse rather than slipping
    // past this check into the DB's CHECK constraint.
    const parsed = eventInputSchema.omit({ status: true }).safeParse(sanitizeListFields(event));
    if (!parsed.success) return "Fix the event fields (name is required, valid date/time, schedule times as HH:MM, inclusion lines under 140 characters).";
    const coordError = coordPairError(parsed.data);
    if (coordError) return coordError;
    if (event.end_date && event.event_date && event.end_date < event.event_date) return "End date can't be before the start date.";
    for (const c of cats) if (!categoryInputSchema.safeParse(c).success) return "Fix the category rows (code, label, non-negative price/slots, gain 0-30000m, cut-off 0-240h).";
    for (const a of addons) if (!addonInputSchema.safeParse(a).success) return "Fix the add-on rows (name, non-negative price).";
    return null;
  }, [event, cats, addons]);

  function onSave() {
    if (invalid) { setError(invalid); return; }
    setError(null);
    const sanitized = sanitizeListFields(event);
    const payload = {
      event: { ...sanitized, id: event.id, org_id: event.org_id || orgId || "" },
      categories: { current: cats, original: origCats },
      addons: { current: addons, original: origAddons },
    };
    const fd = new FormData();
    fd.set("payload", JSON.stringify(payload));
    startTransition(() => { formAction(fd); });
  }

  useEffect(() => {
    if (state.error) {
      setError(state.error);
      toast.error(state.error);
      if (state.eventId && !event.id) {
        // Create-mode partial save: no URL id yet. Move to the edit route so
        // the URL (and the next server fetch) carries the new event's real
        // id — a retry then reconciles against fresh state instead of
        // re-inserting an already-saved child as a duplicate.
        router.replace(`/events/${state.eventId}/edit`);
      } else if (state.eventId) {
        // Edit-mode partial save: force a fresh server fetch so the reseed
        // effect above repopulates cats/addons with their real (saved) ids.
        router.refresh();
      }
    } else if (state.eventId) {
      router.push("/events");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Rail state. `done` marks a section as having real content, so the dots
  // answer "what still needs doing?" without scrolling — the one thing the old
  // single-scroll form could not tell you at any zoom level.
  const sections: SectionMeta[] = [
    { id: "sec-basics", label: "Basics", done: !!event.name && !!event.event_date },
    { id: "sec-location", label: "Location", done: !!event.city_psgc_code || !!event.venue },
    { id: "sec-course", label: "Course", done: event.start_lat != null || (event.route?.length ?? 0) > 0 },
    { id: "sec-categories", label: "Categories", count: cats.length, done: cats.length > 0 },
    { id: "sec-images", label: "Images", done: !!event.hero_image_url || (event.gallery?.length ?? 0) > 0 },
    { id: "sec-schedule", label: "Schedule", count: event.schedule?.length ?? 0, done: (event.schedule?.length ?? 0) > 0 },
    { id: "sec-inclusions", label: "Inclusions", count: event.inclusions?.length ?? 0, done: (event.inclusions?.length ?? 0) > 0 },
    { id: "sec-addons", label: "Add-ons", count: addons.length, done: addons.length > 0 },
  ];

  const inputCls = "h-11 rounded-lg text-[13.5px]";

  return (
    <div className="px-4 pb-4 pt-6 md:px-[30px]">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[190px_minmax(0,1fr)]">
        <SectionRail sections={sections} />

        <div className="min-w-0 space-y-4">
          <FormSection id="sec-basics" title="Basics" hint="Shown on the public race page">
            <div className="space-y-3.5">
              <Field label="Event name" required>
                <Input aria-label="Event name" className={inputCls} value={event.name} onChange={(e) => set({ name: e.target.value })} />
              </Field>
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field
                  label="Discipline"
                  required
                  hint={disciplineLayout(event.discipline) === "profile"
                    ? "Shows an elevation profile on the public page."
                    : "Shows a route ribbon on the public page (no elevation profile)."}
                >
                  <Select value={event.discipline} onValueChange={(v) => set({ discipline: v as EventDraft["discipline"] })}>
                    <SelectTrigger aria-label="Discipline" className={`w-full ${inputCls}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EVENT_DISCIPLINES.map((d) => <SelectItem key={d} value={d}>{DISCIPLINE_LABELS[d]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Status" required>
                  <Select value={event.status} onValueChange={(v) => set({ status: v })}>
                    <SelectTrigger aria-label="Status" className={`w-full ${inputCls}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EVENT_STATUSES.map((st) => <SelectItem key={st} value={st}>{st}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                <Field label="Date" required>
                  <Input aria-label="Date" type="date" className={inputCls} value={event.event_date ?? ""} onChange={(e) => set({ event_date: e.target.value || null })} />
                </Field>
                <Field label="End date" hint="Only for multi-day races">
                  <Input aria-label="End date" type="date" className={inputCls} value={event.end_date ?? ""} onChange={(e) => set({ end_date: e.target.value || null })} />
                </Field>
                <Field label="Flag-off">
                  <Input aria-label="Flag-off" type="time" className={inputCls} value={event.flag_off ?? ""} onChange={(e) => set({ flag_off: e.target.value || null })} />
                </Field>
              </div>
              <Field label="Description">
                <Textarea aria-label="Description" className="min-h-[92px] resize-y rounded-lg text-[13.5px]" value={event.description ?? ""} onChange={(e) => set({ description: e.target.value || null })} />
              </Field>
            </div>
          </FormSection>

          <FormSection id="sec-location" title="Location">
            <div className="space-y-3.5">
              <QueryClientProvider client={qc}>
                <PsgcAddressField
                  value={{ city_psgc_code: event.city_psgc_code, city_name: event.city_name, province_name: event.province_name, region_name: event.region_name }}
                  onChange={(a) => set(a)}
                />
              </QueryClientProvider>
              <Field label="Venue" hint="Where runners assemble — e.g. Barangay Songco covered court">
                <Input aria-label="Venue" className={inputCls} value={event.venue ?? ""} onChange={(e) => set({ venue: e.target.value || null })} />
              </Field>
            </div>
          </FormSection>

          <FormSection id="sec-course" title="Course" hint="Optional — an event with no coordinates simply omits the map">
            <div className="space-y-3.5">
              <div className="grid gap-3.5 sm:grid-cols-2">
                <Field label="Elevation gain (m)">
                  <Input aria-label="Elevation gain" type="number" inputMode="numeric" className={inputCls} value={event.elevation_gain_m ?? ""} onChange={(e) => set({ elevation_gain_m: num(e.target.value) })} />
                </Field>
                <Field label="Cut-off (hours)">
                  <Input aria-label="Cutoff hours" type="number" inputMode="decimal" className={inputCls} value={event.cutoff_hours ?? ""} onChange={(e) => set({ cutoff_hours: num(e.target.value) })} />
                </Field>
              </div>
              {/* step="any" allows the 6 decimals the numeric(9,6) column stores;
                  the browser default of 1 rejects 6.771900 as invalid. */}
              <Field label="Start (lat, lng)" hint="Right-click a spot in Google Maps and copy the coordinates.">
                <div className="grid grid-cols-2 gap-3">
                  <Input aria-label="Start latitude" type="number" step="any" placeholder="6.771900" className={inputCls} value={event.start_lat ?? ""} onChange={(e) => set({ start_lat: num(e.target.value) })} />
                  <Input aria-label="Start longitude" type="number" step="any" placeholder="125.279400" className={inputCls} value={event.start_lng ?? ""} onChange={(e) => set({ start_lng: num(e.target.value) })} />
                </div>
              </Field>
              <Field label="Finish (lat, lng)" hint="Leave blank for a loop that finishes where it starts.">
                <div className="grid grid-cols-2 gap-3">
                  <Input aria-label="Finish latitude" type="number" step="any" placeholder="same as start" className={inputCls} value={event.finish_lat ?? ""} onChange={(e) => set({ finish_lat: num(e.target.value) })} />
                  <Input aria-label="Finish longitude" type="number" step="any" className={inputCls} value={event.finish_lng ?? ""} onChange={(e) => set({ finish_lng: num(e.target.value) })} />
                </div>
              </Field>
              {/* Full width of the section now, instead of sharing a squeezed
                  column with every other field. */}
              <RouteEditor route={event.route} onChange={(route) => set({ route })} startLat={event.start_lat} startLng={event.start_lng} />
            </div>
          </FormSection>

          <FormSection
            id="sec-categories"
            title="Categories"
            hint="The distances runners choose between"
            action={
              <Button variant="outline" size="sm" className="rounded-pill" onClick={() => setCats(addCategory(cats))}>
                + Add distance
              </Button>
            }
          >
            <CategoryEditor rows={cats} onChange={setCats} />
          </FormSection>

          <FormSection id="sec-images" title="Images" hideTitle>
            <EventImagesEditor orgId={event.org_id || orgId || ""} heroUrl={event.hero_image_url} gallery={event.gallery} onChange={(v) => set(v)} />
          </FormSection>

          <FormSection id="sec-schedule" title="Race-morning schedule" hideTitle>
            <ScheduleEditor rows={event.schedule} onChange={(schedule) => set({ schedule })} />
          </FormSection>

          <FormSection id="sec-inclusions" title="What's included" hideTitle>
            <InclusionsEditor rows={event.inclusions} onChange={(inclusions) => set({ inclusions })} />
          </FormSection>

          <FormSection id="sec-addons" title="Add-ons" hideTitle>
            <AddonEditor rows={addons} onChange={setAddons} />
          </FormSection>

          <StickySaveBar
            dirty={dirty}
            pending={pending}
            error={error}
            onSave={onSave}
            onCancel={() => router.push("/events")}
          />
        </div>
      </div>
    </div>
  );
}
