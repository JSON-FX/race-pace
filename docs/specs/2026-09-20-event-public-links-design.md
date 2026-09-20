# Event Public Links — Architecture

## Problem and goals

Public event pages currently use database UUIDs in their URLs. Organizers need a readable, stable link that is easy to share, while existing links and every UUID-based registration relationship must continue to work.

## Approaches considered

1. **Stable slug on each event — selected.** Add one globally unique public slug to `events`. The UUID remains the database identity, while the slug becomes the canonical public locator.
2. **Hard-coded slug aliases.** This avoids an initial schema change, but every event link would require a code deployment and manual mapping.
3. **Separate link-management page and alias table.** This supports multiple campaign links and redirect history, but it adds a second lifecycle that is unnecessary for one permanent link per event.

## Recommended approach

Store one nullable, globally unique `events.slug`. Generate it from the event name in the existing editor, allow organizers to customize it while the event is a draft, and prevent changes after publication. Public pages resolve either a UUID or slug, then use the resolved event UUID for categories, add-ons, entries, payments, and every other existing relationship.

The event editor owns this field because the link is part of one event's publishing identity. The event list provides a copy action. A separate link-management page is deferred until the product needs multiple aliases, campaign tracking, QR assets, or redirect history.

## Key decisions

- **Data model:** `events.slug` is nullable for backward-compatible rollout. A partial unique index enforces a single owner for every non-null slug.
- **Format:** lowercase ASCII kebab-case, 1–80 characters. The editor folds diacritics and normalizes punctuation.
- **Lifecycle:** a draft slug is editable. Once the event leaves `draft`, the database records a permanent lock timestamp and prevents changing an existing slug even if the event later returns to draft. A legacy published row with a null slug may receive its first slug.
- **Routing:** `/events/[id]` accepts a UUID or slug. UUID requests for events with slugs permanently redirect to the slug while preserving query parameters.
- **Canonical identity:** the public page publishes the slug URL as its canonical URL. Existing UUID URLs remain resolvable.
- **Admin experience:** the editor automatically generates the slug, shows the complete public URL, validates it, and offers a copy button after a usable value exists. The events table also offers `Copy public link`.
- **Production safety:** the migration changes no existing identifier or relationship. It conditionally assigns `yalabyalam-backyard-ultra` only to event `3f29e7df-fe90-44a6-bfa4-219ffeaad816`, after confirming the expected trimmed title.
- **Environment contract:** the admin uses `NEXT_PUBLIC_SITE_URL` to build links for local, staging, and production runner sites.

## Missing pieces

- Add the schema column, constraints, uniqueness index, grants, and immutability trigger.
- Add admin slug generation, validation, persistence, and copy controls.
- Add dual UUID/slug resolution, canonical metadata, and UUID redirects to the runner site.
- Configure `NEXT_PUBLIC_SITE_URL` for the admin Vercel projects before deployment.

## Spikes and experiments

No spike is required. The design uses existing Postgres constraints, Supabase row-level security, Next.js dynamic routes, and the repository's existing clipboard component.

## Open questions

- Multiple aliases and campaign tracking are deferred. They should use a separate alias table if required later.
- Published-slug override tooling is deferred. A correction would require an explicit, audited migration rather than a routine organizer edit.
