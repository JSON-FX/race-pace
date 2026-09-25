"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { formatAddress, type PsgcAddress } from "@race-pace/shared";
import { Building2, ImageIcon, ScanLine } from "lucide-react";
import { updateOrgProfileAction, updateOrgCheckInDefaultAction, type SettingsState } from "@/lib/actions/settings";
import type { OrgBranding } from "@/lib/queries/org";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CropUploader } from "@/components/CropUploader";
import { PsgcAddressField } from "@/components/PsgcAddressField";
import { SettingsSection, SettingsSectionFooter } from "./settings-section";

export function SettingsForm({ org, canEdit }: { org: OrgBranding; canEdit: boolean }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(updateOrgProfileAction, {});
  const [checkInState, checkInAction, checkInPending] = useActionState<SettingsState, FormData>(updateOrgCheckInDefaultAction, {});
  const [homeBase, setHomeBase] = useState<PsgcAddress>({
    city_psgc_code: org.home_city_psgc_code,
    city_name: org.home_city_name,
    province_name: org.home_province_name,
    region_name: org.home_region_name,
  });
  const [queryClient] = useState(() => new QueryClient());
  // uploadOrgImage + updateOrgBrandingAction write straight to Postgres/Storage
  // and revalidatePath only affects the *next* server render — refresh so the
  // just-saved image shows without a manual reload.
  const onImageSaved = () => router.refresh();

  return (
    <>
      <SettingsSection
        id="profile"
        title="Organization profile"
        description="This name appears across public event pages and participant messages."
        icon={Building2}
        status="Public"
        className="h-full"
      >
        {/* Radix mounts native selects inside forms. Async PSGC options once cleared a saved city on hydration. */}
        <div className="flex flex-1 flex-col">
          <div className="flex-1 px-4 pb-5 md:px-5">
            <form id="org-profile-form" action={formAction}>
              <input type="hidden" name="orgId" value={org.id} />
              <Label htmlFor="org-name" className="mb-1.5 block text-[12px] font-bold">Organization name</Label>
              <Input
                id="org-name"
                name="name"
                defaultValue={org.name}
                required
                disabled={!canEdit}
                className="h-11 rounded-[10px] bg-background"
              />
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Use the full registered or public-facing organization name.
              </p>
              <div className="mt-5">
                <Label htmlFor="org-description" className="mb-1.5 block text-[12px] font-bold">Organizer Description</Label>
                <Textarea
                  id="org-description"
                  name="description"
                  defaultValue={org.description ?? ""}
                  maxLength={2000}
                  rows={4}
                  disabled={!canEdit}
                  placeholder="Tell runners what your organization is about."
                  className="min-h-28 rounded-[10px] bg-background"
                />
                <p className="mt-1.5 text-[11px] text-muted-foreground">Optional. This will appear on your public organizer profile.</p>
              </div>
            </form>
            <div className="mt-5">
              <p id="home-base-label" className="mb-1.5 text-[12px] font-bold">Home Base</p>
              {canEdit ? (
                <>
                  <QueryClientProvider client={queryClient}>
                    <PsgcAddressField value={homeBase} onChange={setHomeBase} nativeCitySelect cityForm="org-profile-form" cityName="homeCityPsgcCode" className="grid-cols-1 sm:grid-cols-3" />
                  </QueryClientProvider>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">Optional. Choose a city or municipality for your public organizer profile.</p>
                </>
              ) : (
                <p aria-labelledby="home-base-label" className="rounded-[10px] border bg-background px-3 py-2.5 text-[13px]">
                  {formatAddress(homeBase) || "Not set"}
                </p>
              )}
            </div>
            {state.error ? <p role="alert" className="mt-2 text-[13px] text-destructive">{state.error}</p> : null}
            {state.success ? <p role="status" className="mt-2 text-[13px] text-muted-foreground">{state.success}</p> : null}
          </div>
          <SettingsSectionFooter helper="Updates the public organization profile.">
            <Button type="submit" form="org-profile-form" disabled={!canEdit || pending} className="h-10 rounded-[10px] px-4">
              {pending ? "Saving…" : "Save profile"}
            </Button>
          </SettingsSectionFooter>
        </div>
      </SettingsSection>

      <SettingsSection
        id="checkin"
        title="Event check-in"
        description="Set the starting behavior for newly created events."
        icon={ScanLine}
        tone="info"
        status="Default"
        className="h-full"
      >
        <form action={checkInAction} className="flex flex-1 flex-col">
          <div className="flex-1 px-4 pb-5 md:px-5">
            <input type="hidden" name="orgId" value={org.id} />
            <input type="hidden" name="checkInRequired" value="false" />
            <label className="flex items-start gap-4 rounded-xl border bg-background p-3.5">
              <span className="min-w-0 flex-1">
                <strong className="block text-[13px]">Require participant check-in</strong>
                <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                  New events start with check-in enabled. Existing events keep their current setting.
                </span>
              </span>
              <span className="relative mt-0.5 inline-flex h-[26px] w-[46px] shrink-0">
                <input
                  type="checkbox"
                  name="checkInRequired"
                  value="true"
                  defaultChecked={org.check_in_required_default}
                  disabled={!canEdit}
                  aria-label="Require event check-in by default"
                  className="peer sr-only"
                />
                <span className="absolute inset-0 rounded-pill bg-border transition-colors peer-checked:bg-primary peer-disabled:opacity-50 peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/30" />
                <span className="pointer-events-none absolute left-[3px] top-[3px] size-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
              </span>
            </label>
            {checkInState.error ? <p role="alert" className="mt-2 text-[13px] text-destructive">{checkInState.error}</p> : null}
            {checkInState.success ? <p role="status" className="mt-2 text-[13px] text-muted-foreground">{checkInState.success}</p> : null}
          </div>
          <SettingsSectionFooter helper="This does not change existing events.">
            <Button type="submit" disabled={!canEdit || checkInPending} className="h-10 rounded-[10px] px-4">
              {checkInPending ? "Saving…" : "Save default"}
            </Button>
          </SettingsSectionFooter>
        </form>
      </SettingsSection>

      <SettingsSection
        id="branding"
        title="Branding"
        description="Your logo and cover appear on event pages. A featured photo appears on your organizer profile."
        icon={ImageIcon}
        status={org.logo_url && org.banner_url ? "Complete" : "In progress"}
        className="xl:col-span-2"
      >
        <div className="px-4 pb-5 md:px-5">
          {canEdit ? (
            <div className="grid gap-[18px] md:grid-cols-[190px_minmax(0,1fr)]">
              <CropUploader
                orgId={org.id}
                kind="avatar"
                aspect={1}
                field="logo_url"
                label="Organization avatar"
                currentUrl={org.logo_url}
                round
                onSaved={onImageSaved}
              />
              <CropUploader
                orgId={org.id}
                kind="cover"
                aspect={390 / 150}
                field="banner_url"
                label="Cover photo"
                currentUrl={org.banner_url}
                onSaved={onImageSaved}
              />
              <div className="md:col-span-2 max-w-[500px]">
                <CropUploader
                  orgId={org.id}
                  kind="featured"
                  aspect={7 / 5}
                  field="featured_image_url"
                  label="Organizer featured image"
                  currentUrl={org.featured_image_url}
                  onSaved={onImageSaved}
                />
                <p className="mt-1.5 text-[11px] text-muted-foreground">Optional. Choose a photograph without text or logos for your public organizer profile.</p>
              </div>
            </div>
          ) : (
            <p className="rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
              Only organization admins can update branding.
            </p>
          )}
        </div>
      </SettingsSection>
    </>
  );
}
