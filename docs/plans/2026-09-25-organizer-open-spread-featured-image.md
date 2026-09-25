# Organizer Open spread hero and featured image

Status: implemented and verified on staging. The approved [Open spread preview](../previews/organizers/featured-hero-options.html#open-spread) remains the visual reference. Production promotion requires separate acceptance.

## Goal and scope

As an organizer admin, I can choose a separate featured photograph for my public profile. Runners see that image beside the organizer identity without a cropped promotional cover. Existing organizations with no featured image remain valid and show a text-led profile.

This changes the public organizer profile hero and adds one uploader in the existing admin Settings Branding card. It leaves the directory layout, event rows, cover photo, and Settings page layout in place. The generated preview photograph is illustrative. It was assigned only to a clearly marked staging QA organizer for visual review, never to a real organizer.

## Existing seams

- `apps/web/app/(admin)/settings/settings-form.tsx` and `apps/web/components/CropUploader.tsx` already offer avatar and cover upload with a crop dialog.
- `apps/web/lib/org-upload.ts` writes into the existing `org-images` bucket under an organization ID. `updateOrgBrandingAction` checks the current user's organization admin role.
- `apps/web/lib/queries/org.ts` selects the Settings record. `apps/site/lib/organizers.ts` selects the public record and maps it to `Organizer`.
- `apps/site/components/organizers/TrailAtlas.tsx` renders the current split hero. `apps/site/app/organizers/trail-atlas.css` owns its scoped styles.
- `supabase/migrations/20260925000644_organizer_profile_home_base.sql` makes organizer profile fields nullable and prevents editors from changing them through direct database calls.

## Implementation

1. Add nullable `organizations.featured_image_url` with a column-scoped authenticated update grant. Extend the existing admin-only profile guard and trigger to cover it. Keep public select through the existing organization row policy.
2. Extend the Settings query, branding action, upload kind, and crop uploader. Place a 7:5 featured image control inside Branding, matching the existing controls. Allow an admin to clear it.
3. Map the new field to the public organizer model. Render Open spread with the featured image only. If absent, render the name and existing data without a photo panel. Never substitute `banner_url` or an event image in the profile hero.
4. Add focused tests for admin save/clear, nullable mapping, and photo selection. Run both app test/typecheck/build gates. Verify desktop and phone layouts and no horizontal overflow. Use isolated database validation; do not reset the other session's local stack.
5. Open a staging pull request, wait for checks, then deploy and verify the exact staging revision and migration. Record exact evidence in the launch ledger. Production remains a separate release.

## Acceptance criteria

- The approved unboxed Open spread composition appears on organizer profiles at desktop and phone widths.
- The organizer admin can upload, replace, and clear an optional featured image in the existing Settings Branding card.
- Existing production organizations need no backfill. A null image yields an intentional text-led layout.
- The cover photo is never used as the profile hero image. Image pixels are not stretched.
- Non-admin users cannot edit the featured image field, including with a direct database call.
- Staging deploy uses a single reviewed revision with its matching migration. No synthetic data is inserted into production.

## Documentation

- [Supabase standard uploads](https://supabase.com/docs/guides/storage/uploads/standard-uploads) supports the current small compressed upload pattern.
- [Supabase column privileges](https://supabase.com/docs/guides/database/postgres/column-level-security) explains why the new field needs an explicit grant.

## Open questions and assumptions

None. The user selected Open spread. The separate nullable image and null fallback were established in the approved preview and earlier feedback.
