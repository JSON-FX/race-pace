# Discount assignment cannot find registered runners

Status: implemented and locally verified; release validation in progress.

## Report and confirmed cause

The production special-code picker shows four Passports for Point Run Series. Searching
by runner email cannot find another account. The owner explicitly authorized searching
any registered runner by name or email, including runners who have never joined that
organization's events.

`discount_passport_options` in migration `20260930053856` requires an existing registration
or pre-screening application in the selected organization. Its limit is 50, not four.
`discount_create` repeats this eligibility restriction. Updating only the picker would
therefore leave assignment broken.

The lookup also searches only split Passport names and the UUID. It ignores account email,
legacy names, profile names, and account display names. A production read-only presence
check confirmed one of the two generic Runner labels has an account metadata name. The
other has no name in those fields but does have an account email.

## Proposed fix

1. Add a follow-up migration; never edit the applied migration. Let both functions accept
   claimed, non-anonymous registered accounts globally. Retain existing organization-scoped
   managed Passports so current assignments keep working. Do not expose unrelated managed
   Passports globally.
2. Keep the organization-admin/super-admin authorization check and tenant code isolation.
   Return only Passport ID, display name, and email through the guarded lookup. Do not
   broaden direct Passport or profile table policies.
3. Resolve the display name from split Passport names, legacy full name, profile full name,
   then account metadata full_name/name. These metadata fields are display data only.
   Search that name, the Passport UUID, and email case-insensitively. Claimed account email
   comes from auth.users; managed Passport email comes from participant_email, never its
   booker or manager. Keep the 100-character input bound and 50-result limit.
4. Preserve the current RPC name and inputs. Recreate its return projection transactionally
   to append email, retaining id/label for existing clients. Restore explicit grants.
5. Update the existing picker text and email display, preserving selections across searches.
   Follow the approved Fieldnotes layout; no new UI framework or redesign.

## Regression and acceptance checks

- Find and assign an outside runner by name or email before any organization participation.
- Exercise split, legacy, profile, metadata and missing-name identities.
- Retain known managed Passports without exposing unrelated managed identities or booker emails.
- Deny anonymous callers, editors, runners and admins targeting another organization.
- Reject nonexistent/ineligible assignments and duplicate assignment batches.
- Verify direct Passport reads and another organization's discount rows remain isolated.
- Verify input matching, 50-result bound and explicit function privileges.
- In the UI, search, display email, retain selections, and submit the selected Passport UUID.
- Run the local CI workflow: migration replay, shared UI checks, both app typechecks/tests/
  builds, backend/shared tests, and Fieldnotes audit. Verify desktop/tablet/mobile.
- Stage and verify this exact change before any production promotion. Use production-safe
  read-only checks after promotion; do not create production test codes or payments.

## Scope

Follow-up SQL migration; discount page/action/workspace types and display; focused backend
and UI regression tests; release evidence and launch-progress documentation. No payment
calculation, commission, reservation or redemption changes.
