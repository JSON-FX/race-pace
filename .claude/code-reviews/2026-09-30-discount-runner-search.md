# Discount runner search review

Scope: follow-up migration, discount picker, server action types, and regression tests.

Code review passed. No technical issues detected.

- Both discovery and assignment accept globally registered, non-anonymous accounts without
  organization event history. Managed Passports keep the existing organization boundary.
- `auth_manage_discounts` still gates both functions. No table grants or row policies changed.
  Event/category scope validation and discount tenant ownership are unchanged.
- Name metadata is display data only. Claimed email uses the account; managed email uses
  participant_email. The lookup returns only id, label and email.
- SQL uses static parameters, an empty search path, explicit grants, bounded literal search
  and deterministic ordering. The return projection is replaced inside one transaction;
  old deployed clients retain their id/label fields until the frontend release.
- The rest of discount creation is copied unchanged. Redemption, commission, payment,
  reservation and refund code is outside this diff.
- UI selections retain UUIDs across result changes. Email text wraps at 390, 768 and 1440
  pixels. Existing Fieldnotes and accessible checkbox/input primitives are reused.
- Seven backend regression tests cover outsiders, identity fallbacks, email ownership,
  managed participants, authorization, invalid assignments, grants and result bounds.
  Two UI tests cover email search, missing names and selection/submission across searches.

Validation: 861 backend/shared tests, 525 runner tests, 1,020 admin tests and 13 shared UI
tests passed. App/shared UI typechecks, 179-migration replay, Fieldnotes audit and admin
build passed. Runner build passed on an unchanged retry after the existing font-loader
failure. Hosted release checks remain pending.

Browser acceptance: local org with zero events and zero registrations found an outside
runner by account metadata name and email. Selection survived a non-matching search.
Generating a special code succeeded, and SQL readback confirmed the selected Passport.

No changes to the investigation plan. All test fixtures were local.
