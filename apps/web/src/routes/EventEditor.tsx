import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { EVENT_DISCIPLINES, DISCIPLINE_LABELS, disciplineLayout } from "@race-pace/shared";
import { useMyRoles } from "../lib/roles";
import { useEventForEditor } from "../lib/events";
import { saveEvent, type CategoryDraft, type AddonDraft, type EventDraft } from "../lib/eventWrites";
import { eventInputSchema, categoryInputSchema, addonInputSchema, sanitizeListFields, EVENT_STATUSES } from "../lib/validation";
import { CategoryEditor } from "../components/CategoryEditor";
import { AddonEditor } from "../components/AddonEditor";
import { ScheduleEditor } from "../components/ScheduleEditor";
import { RouteEditor } from "../components/RouteEditor";
import { InclusionsEditor } from "../components/InclusionsEditor";
import { EventImagesEditor } from "../components/EventImagesEditor";
import { PsgcAddressField } from "../components/PsgcAddressField";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Label } from "../components/ui/label";
import { Button } from "../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

const fieldLabel = "mb-1.5 block text-[11px] font-semibold tracking-wide text-muted-foreground";
const blank: EventDraft = { org_id: "", name: "", city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null, event_date: null, end_date: null, flag_off: null, status: "draft", discipline: "trail", elevation_gain_m: null, cutoff_hours: null, start_lat: null, start_lng: null, finish_lat: null, finish_lng: null, route: null, description: null, hero_image_url: null, gallery: [], schedule: [], inclusions: [] };

export function EventEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const roles = useMyRoles();
  const loaded = useEventForEditor(id);

  const [event, setEvent] = useState<EventDraft>(blank);
  const [cats, setCats] = useState<CategoryDraft[]>([]);
  const [addons, setAddons] = useState<AddonDraft[]>([]);
  const [origCats, setOrigCats] = useState<{ id?: string }[]>([]);
  const [origAddons, setOrigAddons] = useState<{ id?: string }[]>([]);
  // On a create-mode partial-save (see onSave), we navigate here with the child
  // errors passed through location.state since there's no local state to preserve them.
  const [error, setError] = useState<string | null>(() => (location.state as { childErrors?: string[] } | null)?.childErrors?.join(" ") ?? null);
  const [busy, setBusy] = useState(false);
  const seededFor = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (id && loaded.data && seededFor.current !== id) {
      seededFor.current = id;
      const d = loaded.data;
      // inclusions has no DB default (unlike gallery/schedule) so a legacy row can
      // still have it null — coalesce so InclusionsEditor never sees non-array rows.
      setEvent({ ...d.event, inclusions: d.event.inclusions ?? [] });
      setCats(d.categories.map((c) => ({ id: c.id, code: c.code, label: c.label, distance_km: c.distance_km, base_price: c.base_price, slots_total: c.slots_total, elevation_gain_m: c.elevation_gain_m, cutoff_hours: c.cutoff_hours, blurb: c.blurb })));
      setAddons(d.addons.map((a) => ({ id: a.id, name: a.name, price: a.price })));
      setOrigCats(d.categories.map((c) => ({ id: c.id })));
      setOrigAddons(d.addons.map((a) => ({ id: a.id })));
    }
  }, [id, loaded.data]);

  const orgId = event.org_id || roles.data?.orgId || "";
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

  async function onSave() {
    if (invalid) { setError(invalid); return; }
    setBusy(true); setError(null);
    try {
      const sanitized = sanitizeListFields(event);
      const res = await saveEvent({ event: { ...sanitized, id, org_id: orgId }, categories: { current: cats, original: origCats }, addons: { current: addons, original: origAddons } });
      if (res.childErrors.length) {
        // The event row (and any children that succeeded) persisted, but the editor's
        // cats/addons state is now stale vs. the DB — e.g. a newly inserted category
        // still has no client-side `id`. Reseed from the server so a retry reconciles
        // against fresh state instead of re-inserting an already-saved child as a duplicate.
        if (!id) {
          // Create mode: no URL id yet. Navigate to the edit route so the URL carries
          // the new event's id — useEventForEditor then fetches fresh state on mount,
          // and the seed effect repopulates cats/addons with their real (saved) ids.
          nav(`/events/${res.eventId}/edit`, { replace: true, state: { childErrors: res.childErrors } });
        } else {
          // Edit mode: force the seed effect to re-run once fresh data arrives.
          seededFor.current = undefined;
          await qc.invalidateQueries({ queryKey: ["event-editor", id] });
          setError(res.childErrors.join(" "));
        }
        toast.error(res.childErrors.join(" "));
        setBusy(false);
        return;
      }
      nav("/events");
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      toast.error(message);
      setBusy(false);
    }
  }

  if (id && loaded.isLoading) return <div className="px-[30px] py-[26px]">Loading…</div>;

  return (
    <div className="px-[30px] pt-[26px] pb-10">
      <div className="grid grid-cols-[1.4fr_1fr] gap-4">
        <Card className="gap-0 p-[22px]">
          <CardHeader className="p-0">
            <CardTitle className="text-[15px] font-semibold">Event details</CardTitle>
          </CardHeader>
          <CardContent className="mt-4 flex flex-col gap-3.5 p-0">
            <div>
              <Label className={fieldLabel}>EVENT NAME</Label>
              <Input aria-label="Event name" value={event.name} onChange={(e) => set({ name: e.target.value })} />
            </div>
            <PsgcAddressField
              value={{ city_psgc_code: event.city_psgc_code, city_name: event.city_name, province_name: event.province_name, region_name: event.region_name }}
              onChange={(a) => set(a)}
            />
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
            <div className="grid grid-cols-4 gap-3">
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
            <RouteEditor route={event.route} onChange={(route) => set({ route })} />
            <div>
              <Label className={fieldLabel}>DESCRIPTION</Label>
              <Textarea aria-label="Description" className="h-[82px] resize-y" value={event.description ?? ""} onChange={(e) => set({ description: e.target.value || null })} />
            </div>
          </CardContent>
        </Card>
        <div className="flex flex-col gap-4">
          <EventImagesEditor orgId={orgId} heroUrl={event.hero_image_url} gallery={event.gallery} onChange={(v) => set(v)} />
          <ScheduleEditor rows={event.schedule} onChange={(schedule) => set({ schedule })} />
          <InclusionsEditor rows={event.inclusions} onChange={(inclusions) => set({ inclusions })} />
          <CategoryEditor rows={cats} onChange={setCats} />
          <AddonEditor rows={addons} onChange={setAddons} />
        </div>
        <div className="col-span-full flex items-center justify-end gap-3">
          {error ? <span className="mr-auto text-[13px] text-destructive">{error}</span> : null}
          <Button variant="outline" className="rounded-pill" onClick={() => nav("/events")}>Cancel</Button>
          <Button className="rounded-pill" onClick={onSave} disabled={busy}>{busy ? "Saving…" : "Save event"}</Button>
        </div>
      </div>
    </div>
  );
}
