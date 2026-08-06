"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { updateOrgNameAction, type SettingsState } from "@/lib/actions/settings";
import type { OrgBranding } from "@/lib/queries/org";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { CropUploader } from "@/components/CropUploader";

export function SettingsForm({ org, canEdit }: { org: OrgBranding; canEdit: boolean }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(updateOrgNameAction, {});
  // uploadOrgImage + updateOrgBrandingAction write straight to Postgres/Storage
  // and revalidatePath only affects the *next* server render — refresh so the
  // just-saved image shows without a manual reload.
  const onImageSaved = () => router.refresh();

  return (
    <div className="flex flex-col gap-6">
      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your organization&apos;s display name.</CardDescription>
        </CardHeader>
        <form action={formAction}>
          <CardContent>
            <input type="hidden" name="orgId" value={org.id} />
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="org-name">Organization name</Label>
              <Input id="org-name" name="name" defaultValue={org.name} required disabled={!canEdit} className="rounded-lg" />
            </div>
            {state.error ? <div role="alert" className="mt-2 text-[13px] text-destructive">{state.error}</div> : null}
            {state.success ? <div className="mt-2 text-[13px] text-muted-foreground">{state.success}</div> : null}
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={!canEdit || pending} className="rounded-lg">
              {pending ? "Saving…" : "Save"}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card className="rounded-xl">
        <CardHeader>
          <CardTitle>Branding</CardTitle>
          <CardDescription>The logo and cover image shown on your public event pages.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-8">
          {canEdit ? (
            <>
              <CropUploader
                orgId={org.id}
                kind="avatar"
                aspect={1}
                field="logo_url"
                label="Avatar"
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
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Only organization admins can update branding.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
