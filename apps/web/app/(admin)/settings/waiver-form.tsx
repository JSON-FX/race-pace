"use client";
import { useActionState, useEffect, useState } from "react";
import { publishWaiverAction, selectEventWaiverAction, type WaiverPublishState } from "@/lib/actions/waivers";
import type { WaiverVersion, EventWaiverSetting } from "@/lib/queries/waivers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function WaiverForm({ orgId, versions, canEdit, events = [] }: { orgId: string; versions: WaiverVersion[]; canEdit: boolean; events?: EventWaiverSetting[] }) {
 const [eventState, eventAction, eventPending] = useActionState<WaiverPublishState, FormData>(selectEventWaiverAction, {});
 const [state, action, pending] = useActionState<WaiverPublishState, FormData>(publishWaiverAction, {});
 const [versionId, setVersionId] = useState("");
 const [title, setTitle] = useState("");
 const [body, setBody] = useState("");
 const [reviewed, setReviewed] = useState(false);
 useEffect(() => { if (state.success) setReviewed(false); }, [state]);
 // Editing after an uncertain response starts a new version; unchanged retries
 // keep their identity and cannot create another publication.
 function edited() { setVersionId(crypto.randomUUID()); setReviewed(false); }
 return <section className="mt-6 rounded-xl border bg-card p-6" aria-labelledby="waiver-heading">
  <h2 id="waiver-heading" className="text-lg font-semibold">Organizer waiver</h2>
  <p className="mt-2 text-sm text-muted-foreground">Publish your organization's approved waiver. Published versions cannot be edited. Choose a published version for each event below. Existing acceptances retain their original version.</p>
  {canEdit ? <form action={action} className="mt-4 space-y-4">
   <input type="hidden" name="orgId" value={orgId} /><input type="hidden" name="versionId" value={versionId} />
   <div><Label htmlFor="waiver-title">Title</Label><Input id="waiver-title" name="title" value={title} onChange={e => { setTitle(e.target.value); edited(); }} maxLength={200} required disabled={pending} /></div>
   <div><Label htmlFor="waiver-body">Waiver text</Label><textarea id="waiver-body" name="body" value={body} onChange={e => { setBody(e.target.value); edited(); }} maxLength={100000} required disabled={pending} className="mt-1 min-h-56 w-full rounded-lg border bg-background p-3 text-sm" /></div>
   <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="reviewed" checked={reviewed} onChange={e => setReviewed(e.target.checked)} disabled={pending} required />I reviewed this text and approve publishing it as a permanent version.</label>
   {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
   {state.success ? <p role="status" className="text-sm">{state.success}</p> : null}
   <Button type="submit" disabled={pending || !reviewed || !title.trim() || !body.trim()}>{pending ? "Publishing…" : "Publish waiver version"}</Button>
  </form> : <p className="mt-4 text-sm">Only organization admins can publish waiver versions.</p>}
  {canEdit && versions.length > 0 ? <form action={eventAction} className="mt-6 space-y-3">
   <h3 className="font-medium">Event waiver</h3>
   <input type="hidden" name="orgId" value={orgId} />
   <Label htmlFor="waiver-event">Event</Label>
   <select id="waiver-event" name="eventId" required disabled={eventPending} defaultValue="" className="block w-full rounded-lg border bg-background p-2">
    <option value="" disabled>Choose event</option>
    {events.map(event => <option key={event.id} value={event.id}>{event.name} · {versions.find(v => v.id === event.waiver_version_id)?.title ?? "Legacy waiver"}</option>)}
   </select>
   <Label htmlFor="event-waiver-version">Published waiver</Label>
   <select id="event-waiver-version" name="waiverId" required disabled={eventPending} defaultValue="" className="block w-full rounded-lg border bg-background p-2">
    <option value="" disabled>Choose waiver version</option>
    {versions.map(version => <option key={version.id} value={version.id}>{version.title} · {version.published_at}</option>)}
   </select>
   <p className="text-sm text-muted-foreground">This applies to new registrations. Participants with an open form must review the selected version.</p>
   {eventState.error ? <p role="alert">{eventState.error}</p> : null}
   {eventState.success ? <p role="status">{eventState.success}</p> : null}
   <Button disabled={eventPending} type="submit">Use waiver for event</Button>
  </form> : null}
  <h3 className="mt-6 font-medium">Published versions</h3>
  {versions.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">No versions published yet.</p> : versions.map(version => <details key={version.id} className="mt-3 rounded-lg border p-3">
   <summary className="cursor-pointer text-sm font-medium">{version.title} · {new Date(version.published_at).toISOString().slice(0, 10)}</summary>
   <p className="mt-3 whitespace-pre-wrap break-words text-sm">{version.body}</p>
  </details>)}
 </section>;
}
