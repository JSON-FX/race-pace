# Feature: Stable Event Public Links

The following plan implements the decisions in `docs/specs/2026-09-20-event-public-links-design.md`.

## Feature Description

Add readable event URLs such as `/events/yalabyalam-backyard-ultra`. Organizers receive an automatically generated link in the existing event editor, may customize it while the event is a draft, and can copy it from the editor or events table.

## User Story

As a race organizer, I want a readable and stable event link so that runners can recognize and share the event URL.

## Problem Statement

The public route currently resolves only `events.id`, and all internal event links expose UUIDs. The admin has no event-link workflow or stable public slug.

## Solution Statement

Add a nullable, globally unique event slug with database-enforced format and immutability. Extend the existing admin editor and list. Resolve public routes by UUID or slug, redirect UUID routes to the canonical slug, and continue all downstream reads by event UUID.

## Out of Scope / Non-Goals

- Multiple aliases, campaign links, click analytics, and generated QR codes.
- Replacing UUID primary or foreign keys.
- Changing registrations, payments, categories, or finance logic.
- Deploying the migration or changing hosted production in this implementation step.

## Feature Metadata

**Feature Type**: Enhancement

**Estimated Complexity**: Medium

**Primary Systems Affected**: Supabase schema, admin event editor/list, runner event route
**Dependencies**: Existing Supabase client, Next.js App Router, Zod, clipboard component

## Related Work

**Implements**: approved event custom-link request
**Architecture**: `docs/specs/2026-09-20-event-public-links-design.md`

---

## CONTEXT REFERENCES

### Relevant Codebase Files

- `supabase/migrations/20260718182858_events_catalog.sql` — original event schema and grants.
- `supabase/migrations/20260721100000_events_write_rls.sql` — existing organizer write boundary.
- `apps/web/lib/actions/events.ts` — authoritative event save path.
- `apps/web/lib/queries/event-editor.ts` — editor read shape.
- `apps/web/app/(admin)/events/event-editor-form.tsx` — event creation and editing interface.
- `apps/web/lib/queries/events.ts` — events-table row shape.
- `apps/web/app/(admin)/events/events-table.tsx` — event row actions.
- `apps/site/lib/events.ts` — public event query and mapped type.
- `apps/site/app/events/[id]/page.tsx` — dynamic public event route and metadata.
- `apps/site/components/EventCard.tsx` and `FeaturedRace.tsx` — primary public event links.
- `docs/operations/launch-progress.md` — required progress ledger.

### New Files to Create

- `apps/web/lib/event-slug.ts` and test — normalization and URL helpers.
- `supabase/tests/event-slugs.test.ts` — schema, uniqueness, and immutability coverage.
- One CLI-generated migration under `supabase/migrations/`.
- `.claude/reports/event-public-links-report.md` — implementation report.

### Relevant Documentation

- Supabase row-level security guide: grants and policies both apply to Data API access.
- Next.js `permanentRedirect`: Server Components emit a permanent redirect for canonical resources.
- Next.js `generateMetadata`: dynamic canonical and Open Graph metadata belong in the route.

### Patterns to Follow

- Keep `EventDraft`, `EVENT_COLS`, and editor query column lists synchronized.
- Return friendly server-action errors without exposing database messages.
- Use the existing `CopyButton` for clipboard behavior and feedback.
- Keep the public route dynamic and resolve all child queries through `event.id`.
- Add explicit column grants and revoke public execution from new trigger functions.

---

## IMPLEMENTATION PLAN

### Phase 1: Database foundation

- Create the migration with the Supabase CLI.
- Add `events.slug`, format and length checks, a partial unique index, and explicit grants.
- Add a trigger that freezes an existing slug after draft status.
- Guardedly assign the approved slug to the exact live event UUID when the migration is eventually deployed.
- Add backend tests for valid slugs, invalid slugs, duplicate slugs, and published immutability.

### Phase 2: Admin generation and persistence

- Add tested slug normalization and public URL helpers.
- Extend event validation, editor query types, draft types, and write payloads.
- Generate from the name until the organizer customizes the slug.
- Render the public-link field and copy action in the Basics section.
- Disable slug editing after draft and return specific duplicate/locked errors.

### Phase 3: Admin list sharing

- Select the slug in event table queries.
- Add `Copy public link` to writable event row actions when a slug exists.
- Preserve current edit, reschedule, and cancel behavior.

### Phase 4: Public routing and canonical URLs

- Select and map the slug on public event rows.
- Resolve a route token by UUID or slug.
- Redirect UUID requests to the slug while preserving search parameters.
- Use `event.id` for child reads after resolution.
- Emit canonical metadata and update marketplace/featured links to prefer slugs.

### Phase 5: Documentation and verification

- Add the admin runner-site URL variable to environment and deployment documentation.
- Run focused admin, site, and backend tests.
- Run both app type checks and the relevant full suites.
- Update the launch progress ledger with completed work, blockers, and the next deployment task.
- Write the PIV implementation report.

## STEP-BY-STEP TASKS

1. **Database slug contract**
   `VALIDATE: pnpm exec vitest run supabase/tests/event-slugs.test.ts`
2. **Admin slug helpers and save contract**
   `VALIDATE: pnpm --filter web exec vitest run lib/event-slug.test.ts lib/validation.test.ts lib/actions/events.test.ts`
3. **Admin editor and event-list experience**
   `VALIDATE: pnpm --filter web exec vitest run 'app/(admin)/events/event-editor-form.test.tsx' 'app/(admin)/events/events-table.test.tsx'`
4. **Runner dual-resolution and canonical links**
   `VALIDATE: pnpm --filter site exec vitest run lib/__tests__/events.test.ts components/__tests__/event-card.test.tsx`
5. **Final verification and reporting**
   `VALIDATE: pnpm --filter web typecheck && pnpm --filter site typecheck && git diff --check`

## Testing Strategy

- Unit-test normalization, diacritics, punctuation, length, and environment-aware URLs.
- Server-action tests assert slug persistence and friendly duplicate/frozen responses.
- Component tests cover automatic generation, draft customization, published lock, and copy actions.
- Supabase integration tests assert constraints and database-level immutability.
- Runner tests assert UUID-versus-slug query choice and slug-preferred event links.

## Risks and mitigations

- **Collision:** database uniqueness remains authoritative even if two organizers save simultaneously.
- **Broken existing links:** UUID lookup remains supported and redirects only after successful resolution.
- **Wrong child identifier:** category, add-on, and entry reads use the resolved `event.id`, never the route token.
- **Wrong environment link:** the admin requires the runner site's `NEXT_PUBLIC_SITE_URL` per environment.
- **Production mutation:** local implementation does not run the migration against hosted projects.

## Open Questions / Assumptions

- Settled: one globally unique link per event.
- Settled: editable during draft and frozen after publication.
- Assumed: platform corrections after publication use a reviewed migration, not an organizer-facing override.
