"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EVENT_DISCIPLINES, DISCIPLINE_LABELS, disciplineLayout } from "@race-pace/shared";
import type { EditorData } from "@/lib/queries/event-editor";
import { saveEventAction, type CategoryDraft, type AddonDraft, type EventDraft, type EditorState } from "@/lib/actions/events";
import { eventInputSchema, categoryInputSchema, addonInputSchema, sanitizeListFields, EVENT_STATUSES } from "@/lib/validation";
import { CategoryEditor } from "@/components/CategoryEditor";
import { AddonEditor } from "@/components/AddonEditor";
import { ScheduleEditor } from "@/components/ScheduleEditor";
import { InclusionsEditor } from "@/components/InclusionsEditor";
import { EventImagesEditor } from "@/components/EventImagesEditor";
import { PsgcAddressField } from "@/components/PsgcAddressField";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    if (!eventInputSchema.omit({ status: true }).safeParse(sanitizeListFields(event)).success) return "Fix the event fields (name is required, valid date/time, schedule times as HH:MM, inclusion lines under 140 characters).";
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

  return (
    <div className="px-4 pt-6 pb-10 md:px-[30px]">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="gap-0 p-[22px]">
          <CardHeader className="p-0">
            <CardTitle className="text-[15px] font-semibold">Event details</CardTitle>
          </CardHeader>
          <CardContent className="mt-4 flex flex-col gap-3.5 p-0">
            <div>
              <Label className={fieldLabel}>EVENT NAME</Label>
              <Input aria-label="Event name" value={event.name} onChange={(e) => set({ name: e.target.value })} />
            </div>
            <QueryClientProvider client={qc}>
              <PsgcAddressField
                value={{ city_psgc_code: event.city_psgc_code, city_name: event.city_name, province_name: event.province_name, region_name: event.region_name }}
                onChange={(a) => set(a)}
              />
            </QueryClientProvider>
            <div>
              <Label className={fieldLabel}>VENUE</Label>
              <Input aria-label="Venue" value={event.venue ?? ""} onChange={(e) => set({ venue: e.target.value || null })} />
            </div>
            <div>
              <Label className={fieldLabel}>DISCIPLINE — CHOOSES THE PUBLIC PAGE LAYOUT</Label>
              <Select value={event.discipline} onValueChange={(v) => set({ discipline: v as EventDraft["discipline"] })}>
                <SelectTrigger aria-label="Discipline" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENT_DISCIPLINES.map((d) => <SelectItem key={d} value={d}>{DISCIPLINE_LABELS[d]}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {disciplineLayout(event.discipline) === "profile"
                  ? "This shows an elevation profile on the public page."
                  : "This shows a route ribbon on the public page (no elevation profile)."}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <Label className={fieldLabel}>DATE</Label>
                <Input aria-label="Date" type="date" value={event.event_date ?? ""} onChange={(e) => set({ event_date: e.target.value || null })} />
              </div>
              <div>
                <Label className={fieldLabel}>END DATE</Label>
                <Input aria-label="End date" type="date" value={event.end_date ?? ""} onChange={(e) => set({ end_date: e.target.value || null })} />
              </div>
              <div>
                <Label className={fieldLabel}>FLAG-OFF</Label>
                <Input aria-label="Flag-off" type="time" value={event.flag_off ?? ""} onChange={(e) => set({ flag_off: e.target.value || null })} />
              </div>
              <div>
                <Label className={fieldLabel}>STATUS</Label>
                <Select value={event.status} onValueChange={(v) => set({ status: v })}>
                  <SelectTrigger aria-label="Status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className={fieldLabel}>ELEVATION GAIN (M)</Label>
                <Input aria-label="Elevation gain" type="number" value={event.elevation_gain_m ?? ""} onChange={(e) => set({ elevation_gain_m: num(e.target.value) })} />
              </div>
              <div>
                <Label className={fieldLabel}>CUTOFF (HOURS)</Label>
                <Input aria-label="Cutoff hours" type="number" value={event.cutoff_hours ?? ""} onChange={(e) => set({ cutoff_hours: num(e.target.value) })} />
              </div>
            </div>
            {/* Course locator. Optional — an event with no coordinates simply
                omits the map on the public page. `step` allows the 6 decimals
                the numeric(9,6) column stores; the browser's default step of 1
                would reject 6.771900 as invalid. */}
            <div>
              <Label className={fieldLabel}>START (LAT, LNG)</Label>
              <div className="grid grid-cols-2 gap-3">
                <Input aria-label="Start latitude" type="number" step="any" placeholder="6.771900" value={event.start_lat ?? ""} onChange={(e) => set({ start_lat: num(e.target.value) })} />
                <Input aria-label="Start longitude" type="number" step="any" placeholder="125.279400" value={event.start_lng ?? ""} onChange={(e) => set({ start_lng: num(e.target.value) })} />
              </div>
            </div>
            <div>
              <Label className={fieldLabel}>FINISH (LAT, LNG)</Label>
              <div className="grid grid-cols-2 gap-3">
                <Input aria-label="Finish latitude" type="number" step="any" placeholder="same as start for a loop" value={event.finish_lat ?? ""} onChange={(e) => set({ finish_lat: num(e.target.value) })} />
                <Input aria-label="Finish longitude" type="number" step="any" value={event.finish_lng ?? ""} onChange={(e) => set({ finish_lng: num(e.target.value) })} />
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Right-click a spot in Google Maps and choose the coordinates to copy them. Leave blank to hide the map.
              </p>
            </div>
            <RouteEditor route={event.route} onChange={(route) => set({ route })} startLat={event.start_lat} startLng={event.start_lng} />
            <div>
              <Label className={fieldLabel}>DESCRIPTION</Label>
              <Textarea aria-label="Description" className="h-[82px] resize-y" value={event.description ?? ""} onChange={(e) => set({ description: e.target.value || null })} />
            </div>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <EventImagesEditor orgId={event.org_id || orgId || ""} heroUrl={event.hero_image_url} gallery={event.gallery} onChange={(v) => set(v)} />
          <ScheduleEditor rows={event.schedule} onChange={(schedule) => set({ schedule })} />
          <InclusionsEditor rows={event.inclusions} onChange={(inclusions) => set({ inclusions })} />
          <CategoryEditor rows={cats} onChange={setCats} />
          <AddonEditor rows={addons} onChange={setAddons} />
        </div>
        <div className="col-span-full flex items-center justify-end gap-3">
          {error ? <span className="mr-auto text-[13px] text-destructive">{error}</span> : null}
          <Button variant="outline" className="rounded-pill" onClick={() => router.push("/events")}>Cancel</Button>
          <Button className="rounded-pill" onClick={onSave} disabled={pending}>{pending ? "Saving…" : "Save event"}</Button>
        </div>
      </div>
    </div>
  );
}
