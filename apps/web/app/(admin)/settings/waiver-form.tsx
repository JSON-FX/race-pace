"use client";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useActionState, useEffect, useMemo, useState } from "react";
import { ChevronRight, FileText } from "lucide-react";
import { publishWaiverAction, selectEventWaiverAction, type WaiverPublishState } from "@/lib/actions/waivers";
import type { WaiverVersion, EventWaiverSetting } from "@/lib/queries/waivers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableCombobox } from "@/components/ui/searchable-combobox";
import { fmtDate } from "@/lib/format";
import { SettingsSection } from "./settings-section";

export function WaiverForm({
  orgId,
  versions,
  canEdit,
  events = [],
}: {
  orgId: string;
  versions: WaiverVersion[];
  canEdit: boolean;
  events?: EventWaiverSetting[];
}) {
  const [eventState, eventAction, eventPending] = useActionState<WaiverPublishState, FormData>(selectEventWaiverAction, {});
  const [state, action, pending] = useActionState<WaiverPublishState, FormData>(publishWaiverAction, {});
  const [versionId, setVersionId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [eventId, setEventId] = useState("");
  const [waiverId, setWaiverId] = useState("");

  useEffect(() => { if (state.success) setReviewed(false); }, [state]);

  const versionById = useMemo(
    () => new Map(versions.map((version) => [version.id, version])),
    [versions],
  );

  const eventOptions = useMemo(() => events.map((event) => {
    const current = event.waiver_version_id ? versionById.get(event.waiver_version_id) : null;
    return {
      value: event.id,
      label: event.name,
      description: current ? `Current waiver: ${current.title}` : "No published waiver assigned",
      keywords: current ? [current.title] : ["unassigned"],
      badge: current ? "Assigned" : "Unassigned",
    };
  }), [events, versionById]);

  const waiverOptions = useMemo(() => versions.map((version, index) => {
    const published = fmtDate(version.published_at);
    return {
      value: version.id,
      label: version.title,
      description: `Published ${published} · Version ${versions.length - index}`,
      keywords: [version.published_at, published],
      badge: index === 0 ? "Latest" : undefined,
    };
  }), [versions]);

  // Editing after an uncertain response starts a new version; unchanged retries
  // keep their identity and cannot create another publication.
  function edited() {
    setVersionId(crypto.randomUUID());
    setReviewed(false);
  }

  return (
    <SettingsSection
      id="waiver"
      title="Organizer waiver"
      description="Publish permanent versions, then choose which one each event uses."
      icon={FileText}
      tone="warning"
      status={`${versions.length} published`}
      className="xl:col-span-2"
    >
      <div className="px-4 pb-5 md:px-5">
        {canEdit ? (
          <form action={action}>
            <input type="hidden" name="orgId" value={orgId} />
            <input type="hidden" name="versionId" value={versionId} />
            <div className="grid gap-4">
              <div>
                <Label htmlFor="waiver-title" className="mb-1.5 flex">
                  Version title
                  <span aria-hidden="true" className="ml-auto font-normal tabular-nums text-muted-foreground">{title.length} / 200</span>
                </Label>
                <Input
                  id="waiver-title"
                  name="title"
                  value={title}
                  onChange={(event) => { setTitle(event.target.value); edited(); }}
                  maxLength={200}
                  placeholder="Example: 2026 standard event waiver"
                  required
                  disabled={pending}
                  className="h-11"
                />
              </div>
              <div>
                <Label htmlFor="waiver-body" className="mb-1.5 block">Waiver text</Label>
                <Textarea
                  id="waiver-body"
                  name="body"
                  value={body}
                  onChange={(event) => { setBody(event.target.value); edited(); }}
                  maxLength={100000}
                  placeholder="Paste the approved waiver text here…"
                  required
                  disabled={pending}
                  className="min-h-44 resize-y leading-relaxed"
                />
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Published versions cannot be edited. Existing acceptances retain their original version.
                </p>
              </div>
              <Label className="flex items-start gap-3 border p-3.5">
                <Checkbox

                  name="reviewed"
                  checked={reviewed}
                  onCheckedChange={(checked) => setReviewed(checked === true)}
                  disabled={pending}
                  required
                  className="mt-0.5 size-[18px] shrink-0 accent-primary"
                />
                <span>
                  <strong className="block text-[12px]">I reviewed and approve this exact text</strong>
                  <span className="mt-1 block text-[10.5px] text-muted-foreground">
                    Publishing creates a permanent, timestamped version.
                  </span>
                </span>
              </Label>
            </div>
            {state.error ? <Alert variant="destructive" role="alert" className="mt-3"><AlertDescription>{state.error}</AlertDescription></Alert> : null}
            {state.success ? <p role="status" className="mt-3 text-[13px] text-muted-foreground">{state.success}</p> : null}
            <div className="mt-4 flex justify-end">
              <Button type="submit" disabled={pending || !reviewed || !title.trim() || !body.trim()} className="h-10">
                {pending ? "Publishing…" : "Publish waiver version"}
              </Button>
            </div>
          </form>
        ) : (
          <p className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
            Only organization admins can publish waiver versions.
          </p>
        )}

        {canEdit && versions.length > 0 ? (
          <>
            <div className="my-5 h-px bg-divider" />
            <div className="mb-3">
              <h3 className="text-[13px] font-bold">Event waiver</h3>
              <p className="mt-0.5 text-[10.5px] text-muted-foreground">Apply a published version to new registrations.</p>
            </div>
            <form action={eventAction}>
              <input type="hidden" name="orgId" value={orgId} />
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="waiver-event" className="mb-1.5 block">Event</Label>
                  <SearchableCombobox
                    id="waiver-event"
                    name="eventId"
                    value={eventId}
                    onValueChange={setEventId}
                    options={eventOptions}
                    ariaLabel="Event"
                    placeholder="Search or choose an event"
                    searchPlaceholder="Search events…"
                    emptyText="No matching events."
                    disabled={eventPending}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="event-waiver-version" className="mb-1.5 block">Published waiver</Label>
                  <SearchableCombobox
                    id="event-waiver-version"
                    name="waiverId"
                    value={waiverId}
                    onValueChange={setWaiverId}
                    options={waiverOptions}
                    ariaLabel="Published waiver"
                    placeholder="Search or choose a waiver"
                    searchPlaceholder="Search published waivers…"
                    emptyText="No matching waiver versions."
                    disabled={eventPending}
                    required
                  />
                </div>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Participants with an open registration form must review the newly selected version.
              </p>
              {eventState.error ? <Alert variant="destructive" role="alert" className="mt-2"><AlertDescription>{eventState.error}</AlertDescription></Alert> : null}
              {eventState.success ? <p role="status" className="mt-2 text-[13px] text-muted-foreground">{eventState.success}</p> : null}
              <div className="mt-3 flex justify-end">
                <Button
                  disabled={eventPending || !eventId || !waiverId}
                  type="submit"
                  variant="outline"
                  className="h-10"
                >
                  {eventPending ? "Saving…" : "Use waiver for event"}
                </Button>
              </div>
            </form>
          </>
        ) : null}

        <div className="my-5 h-px bg-divider" />
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-bold">Published versions</h3>
            <p className="mt-0.5 text-[10.5px] text-muted-foreground">Permanent history with the original text.</p>
          </div>
          <Badge variant="secondary" className="px-2 py-1 uppercase">
            Immutable
          </Badge>
        </div>
        {versions.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-muted/30 px-4 py-8 text-center text-[12px] text-muted-foreground">
            No versions published yet.
          </p>
        ) : (
          <div className="grid gap-2">
            {versions.map((version, index) => (
              <Collapsible key={version.id} className="group min-w-0 rounded-xl border bg-background">
                <CollapsibleTrigger className="flex min-h-12 w-full min-w-0 cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 text-left [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-[12px]">{version.title}</strong>
                    <span className="block text-[10px] text-muted-foreground">Published {fmtDate(version.published_at)}</span>
                  </span>
                  {index === 0 ? (
                    <Badge variant="secondary" className="px-2 py-1">Latest</Badge>
                  ) : null}
                </CollapsibleTrigger><CollapsibleContent forceMount className="data-[state=closed]:hidden">
                <p className="whitespace-pre-wrap break-words px-10 pb-4 text-[12px] leading-relaxed text-muted-foreground">
                  {version.body}
                </p>
              </CollapsibleContent></Collapsible>
            ))}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
