# trail-ultra — planning docs

Planning & design artifacts for **trail-ultra**, a multi-organization trail &
ultra-trail event platform (Mindanao, Philippines).

| Doc | What it is |
| --- | --- |
| [00-product-overview.md](./00-product-overview.md) | **The PRD** — product overview, scope, MVP feature list (§4.3), multi-tenancy model, data model, payments/settlement, roles, roadmap, risks. |
| [01-mobile-ios-mvp.md](./01-mobile-ios-mvp.md) | **iOS MVP spec** — the runner app: screens, navigation, data/offline, payment flow, custom fields, acceptance criteria. |
| [plans/01-local-backend-foundation.md](./plans/01-local-backend-foundation.md) | **Plan 1 of 4** — local backend foundation: Supabase schema + RLS + seed + Edge Functions + fake payments, as TDD steps. |
| [plans/02-app-foundation.md](./plans/02-app-foundation.md) | **Plan 2 of 4** — Expo app foundation: scaffold, auth, org selection, tab shell, profile, as TDD steps. |
| [trail-ultra-flows.html](./trail-ultra-flows.html) | **Visual companion** — MVP scope + the runner journey, multi-tenancy isolation, payments/settlement, and roles. Open in a browser. |
| [adr/0001-cross-platform-tech-stack.md](./adr/0001-cross-platform-tech-stack.md) | **ADR-0001** — the cross-platform tech-stack decision (Expo/RN + Supabase + PayMongo + getdesign), with options & trade-offs. |
| [adr/0002-repository-structure.md](./adr/0002-repository-structure.md) | **ADR-0002** — one monorepo; `apps/` · `packages/` · `supabase/` · `docs/` layout, with rationale. |

**Status:** Draft v0.4 · 2026-07-19

## Roadmap of planning docs

- [x] Product overview / PRD — `00-product-overview.md`
- [x] Visual flows — `trail-ultra-flows.html`
- [x] **Architecture / tech-stack decision** — [ADR-0001 · Cross-platform tech stack](./adr/0001-cross-platform-tech-stack.md)
- [x] **Repository structure** — [ADR-0002 · Repository & monorepo structure](./adr/0002-repository-structure.md)
- [x] **01 · Mobile (iOS) MVP** — [detailed spec](./01-mobile-ios-mvp.md) for the first build
- [x] **Plan 1 · Local backend foundation** — [built & merged](./plans/01-local-backend-foundation.md), 13 tests green
- [x] **Plan 2 · App foundation** — [built & merged](./plans/02-app-foundation.md), 7 app + 13 backend tests green (iOS-simulator walk-through pending)
- [ ] **Plan 3 · Browse & register** · **Plan 4 · Pay / ticket / offline** — to write
