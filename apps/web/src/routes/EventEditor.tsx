import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useMyRoles } from "../lib/roles";
import { useEventForEditor } from "../lib/events";
import { saveEvent, type CategoryDraft, type AddonDraft, type EventDraft } from "../lib/eventWrites";
import { eventInputSchema, categoryInputSchema, addonInputSchema, EVENT_STATUSES } from "../lib/validation";
import { CategoryEditor } from "../components/CategoryEditor";
import { AddonEditor } from "../components/AddonEditor";

const label = { display: "block", fontSize: 11, fontWeight: 600, letterSpacing: ".4px", color: "var(--ink-muted)", marginBottom: 6 } as const;
const input = { background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: 11, padding: "12px 13px", color: "var(--ink)", fontSize: 14, width: "100%" } as const;
const card = { background: "var(--canvas)", border: "1px solid var(--hairline)", borderRadius: "var(--radius-card)", padding: 22 } as const;
const blank: EventDraft = { org_id: "", name: "", place: null, region: null, event_date: null, flag_off: null, status: "draft", elevation_gain_m: null, cutoff_hours: null, description: null, hero_image_url: null };

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
      setEvent({ ...d.event });
      setCats(d.categories.map((c) => ({ id: c.id, code: c.code, label: c.label, distance_km: c.distance_km, base_price: c.base_price, slots_total: c.slots_total })));
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
    if (!eventInputSchema.omit({ status: true }).safeParse({ ...event }).success) return "Fix the event fields (name is required, valid date/time).";
    for (const c of cats) if (!categoryInputSchema.safeParse(c).success) return "Fix the category rows (code, label, non-negative price/slots).";
    for (const a of addons) if (!addonInputSchema.safeParse(a).success) return "Fix the add-on rows (name, non-negative price).";
    return null;
  }, [event, cats, addons]);

  async function onSave() {
    if (invalid) { setError(invalid); return; }
    setBusy(true); setError(null);
    try {
      const res = await saveEvent({ event: { ...event, id, org_id: orgId }, categories: { current: cats, original: origCats }, addons: { current: addons, original: origAddons } });
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
        setBusy(false);
        return;
      }
      nav("/events");
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  if (id && loaded.isLoading) return <div style={{ padding: "26px 30px" }}>Loading…</div>;

  return (
    <div style={{ padding: "26px 30px 40px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
        <div style={card}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Event details</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16 }}>
            <div><span style={label}>EVENT NAME</span><input aria-label="Event name" style={input} value={event.name} onChange={(e) => set({ name: e.target.value })} /></div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div><span style={label}>PLACE</span><input aria-label="Place" style={input} value={event.place ?? ""} onChange={(e) => set({ place: e.target.value || null })} /></div>
              <div><span style={label}>REGION</span><input aria-label="Region" style={input} value={event.region ?? ""} onChange={(e) => set({ region: e.target.value || null })} /></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div><span style={label}>DATE</span><input aria-label="Date" placeholder="YYYY-MM-DD" style={input} value={event.event_date ?? ""} onChange={(e) => set({ event_date: e.target.value || null })} /></div>
              <div><span style={label}>FLAG-OFF</span><input aria-label="Flag-off" placeholder="HH:MM" style={input} value={event.flag_off ?? ""} onChange={(e) => set({ flag_off: e.target.value || null })} /></div>
              <div><span style={label}>STATUS</span>
                <select aria-label="Status" style={input} value={event.status} onChange={(e) => set({ status: e.target.value })}>
                  {EVENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div><span style={label}>ELEVATION GAIN (M)</span><input aria-label="Elevation gain" type="number" style={input} value={event.elevation_gain_m ?? ""} onChange={(e) => set({ elevation_gain_m: num(e.target.value) })} /></div>
              <div><span style={label}>CUTOFF (HOURS)</span><input aria-label="Cutoff hours" type="number" style={input} value={event.cutoff_hours ?? ""} onChange={(e) => set({ cutoff_hours: num(e.target.value) })} /></div>
            </div>
            <div><span style={label}>DESCRIPTION</span><textarea aria-label="Description" style={{ ...input, height: 82, resize: "vertical" }} value={event.description ?? ""} onChange={(e) => set({ description: e.target.value || null })} /></div>
            <div><span style={label}>HERO IMAGE URL</span><input aria-label="Hero image URL" placeholder="https://…" style={input} value={event.hero_image_url ?? ""} onChange={(e) => set({ hero_image_url: e.target.value || null })} /></div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <CategoryEditor rows={cats} onChange={setCats} />
          <AddonEditor rows={addons} onChange={setAddons} />
        </div>
        <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
          {error ? <span style={{ color: "var(--danger)", fontSize: 13, marginRight: "auto" }}>{error}</span> : null}
          <button onClick={() => nav("/events")} style={{ background: "var(--canvas)", border: "1px solid var(--hairline)", color: "var(--ink)", fontSize: 14, fontWeight: 600, padding: "11px 22px", borderRadius: "var(--radius-pill)", cursor: "pointer" }}>Cancel</button>
          <button onClick={onSave} disabled={busy} style={{ background: "var(--primary)", color: "#fff", fontSize: 14, fontWeight: 600, padding: "11px 26px", borderRadius: "var(--radius-pill)", border: 0, cursor: "pointer" }}>{busy ? "Saving…" : "Save event"}</button>
        </div>
      </div>
    </div>
  );
}
