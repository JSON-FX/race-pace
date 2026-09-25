# Organizer profile fields in Settings

Status: deployed and verified on staging at `77a231b9cff199603fc2443a2d65e47b841a1434` through PRs #126–#132. Production promotion is outside this Settings task.

## Scope

Add Organizer Description and Home Base to the existing Organization profile card in admin `/settings`. Keep the Brand Studio page structure and all other settings behavior. Both values are optional for existing and new organizations.

## Data contract

- Reuse nullable `organizations.description` for the public organizer description.
- Store Home Base as a nullable Philippine Standard Geographic Code city reference and its city, province, and region labels. The labels come from the location tables on save so the future public directory can show a readable location and build region filters across the Philippines.
- Give authenticated users column-scoped update grants. A focused database trigger preserves admin-only writes because the existing organization row policy also permits editors. The Settings action keeps its admin-only check.
- Empty description and Home Base clear their values. Existing rows remain null until an admin saves them.

## Steps and validation

1. Add nullable Home Base columns and the missing description update grant in a new migration. Verify the SQL against the local database with column privilege queries.
2. Read the values in `getOrg`, then show a textarea and the existing Philippine location picker inside the Profile card. Check the focused Settings form test.
3. Save the values through the existing profile action after admin authorization. Resolve the chosen city against location tables before writing its labels. Check the focused Settings action test.
4. Run admin typecheck and focused tests. Inspect the final diff for unrelated Settings changes.

No public organizer directory, event display, race types, or Settings redesign is included here.
