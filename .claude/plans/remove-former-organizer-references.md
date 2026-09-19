# Remove former organizer references

## Feature description

Remove the former organizer identity from the current repository so it cannot appear in production placeholders, local seed data, tests, previews, historical implementation documents, or bundled assets.

## Scope

- Replace every case variant of the former organizer name in tracked text with the neutral synthetic identity `TrailNorth`.
- Replace the organization creation placeholders with neutral examples.
- Delete both bundled login photographs because the image itself contains the former organizer logo.
- Replace them with one original Race Pace mountain-running illustration containing fictional runners and no text, logos, sponsor marks, or identifiable likenesses.
- Delete the production-incident document dedicated to that organizer.
- Preserve application behavior, identifiers, security rules, and production data.

## Implementation plan

1. Inventory every tracked text occurrence and related asset.
2. Neutralize code, tests, seed data, scripts, plans, previews, and historical documents.
3. Remove the branded login photographs and connect both login surfaces to the generated Race Pace illustration.
4. Run site, admin, mobile, and backend typechecks and tests.
5. Run production builds and a final repository-wide text and filename audit.
6. Review, commit, open a pull request, merge after required checks, and verify production no longer serves the removed asset or placeholder.

## Risks and controls

- Seed-dependent backend tests may fail if names, slugs, or test emails become inconsistent. Replace all three together and run the full backend suite.
- Historical applied migrations normally remain immutable. The only affected migration content is a comment; this explicit repository-wide removal requires a comment-only change with no SQL behavior change.
- Existing production rows are not renamed or deleted. Production currently has no organizations or events, and this task changes repository defaults only.

## Validation

- Run both Next.js typechecks, complete test suites, and production builds.
- Run the mobile test suite.
- Run the backend and shared-contract suite against local Supabase.
- Confirm no tracked or local project file or filename contains the former identity.
