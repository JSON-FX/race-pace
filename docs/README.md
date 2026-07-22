# race-pace — planning docs

Planning & design artifacts for **race-pace**, a multi-organization trail &
ultra-trail event platform (Mindanao, Philippines).

| Doc | What it is |
| --- | --- |
| [00-product-overview.md](./00-product-overview.md) | **The PRD** — product overview, scope, MVP feature list (§4.3), multi-tenancy model, data model, payments/settlement, roles, roadmap, risks. |
| [01-mobile-ios-mvp.md](./01-mobile-ios-mvp.md) | **iOS MVP spec** — the runner app: screens, navigation, data/offline, payment flow, custom fields, acceptance criteria. |
| [plans/01-local-backend-foundation.md](./plans/01-local-backend-foundation.md) | **Plan 1 of 4** — local backend foundation: Supabase schema + RLS + seed + Edge Functions + fake payments, as TDD steps. |
| [plans/02-app-foundation.md](./plans/02-app-foundation.md) | **Plan 2 of 4** — Expo app foundation: scaffold, auth, org selection, tab shell, profile, as TDD steps. |
| [plans/03-browse-register.md](./plans/03-browse-register.md) | **Plan 3 of 4** — browse events, event detail, dynamic custom-field registration → pending registration, as TDD steps. |
| [race-pace-flows.html](./race-pace-flows.html) | **Visual companion** — MVP scope + the runner journey, multi-tenancy isolation, payments/settlement, and roles. Open in a browser. |
| [adr/0001-cross-platform-tech-stack.md](./adr/0001-cross-platform-tech-stack.md) | **ADR-0001** — the cross-platform tech-stack decision (Expo/RN + Supabase + PayMongo + getdesign), with options & trade-offs. |
| [adr/0002-repository-structure.md](./adr/0002-repository-structure.md) | **ADR-0002** — one monorepo; `apps/` · `packages/` · `supabase/` · `docs/` layout, with rationale. |

**Status:** Draft v0.5 · 2026-07-20

## Roadmap

**Planning artifacts** — all done: PRD (`00-product-overview.md`), visual flows (`race-pace-flows.html`), [ADR-0001 · tech stack](./adr/0001-cross-platform-tech-stack.md), [ADR-0002 · repo structure](./adr/0002-repository-structure.md), [01 · iOS MVP spec](./01-mobile-ios-mvp.md).

**Runner iOS app (M1)** — built & merged:
- [x] **Plan 1 · Local backend foundation** — [plan](./plans/01-local-backend-foundation.md), backend tests green
- [x] **Plan 2 · App foundation** — [plan](./plans/02-app-foundation.md), **verified end-to-end on iOS Simulator** ✓
- [x] **Plan 3 · Browse & register** — [plan](./plans/03-browse-register.md)
- [x] **Plan 4 · Pay · confirm · ticket · offline** — [plan](./plans/04-pay-ticket-offline.md)
- [x] **Plan 5 · Marketplace (data + event page)** · **Plan 6 · Orgs + nav cleanup** — [05](./plans/05-marketplace-data-event.md) · [06](./plans/06-orgs-cleanup.md)
- [x] **Plan 7 · Runner profile (passport)** · **Plan 8 · PSGC standardized addresses** — [07](./plans/07-runner-profile-core.md) · [08](./plans/08-psgc-addresses.md)
- [x] **Mobile UI → React Native Reusables migration** — [spec](./specs/2026-07-22-mobile-rnr-migration-design.md) · [plan](./plans/mobile-rnr-migration.md) — all 13 screens re-platformed to [React Native Reusables](https://reactnativereusables.com/) on NativeWind with full **light + dark** theming (trail-green semantic tokens in `apps/mobile/global.css`; legacy `lib/theme.ts` removed). Money-path screens (register/pay/ticket) migrated with checkout/payment/offline logic verified byte-identical (diff/MD5/SHA-256). mobile 55/55, tsc clean. *On-device iOS + Android light/dark walkthrough pending (Task 34 §2–3).*

**Admin web console (M3)** — `apps/web`, served at `https://admin.racepace.lan` (Docker + Traefik):
- [x] **Plan 9 · Admin foundation** — [spec](./specs/2026-07-20-admin-foundation-design.md) · [plan](./plans/09-admin-foundation.md) — `user_roles` + role-scoped RLS + role-adaptive shell + read-only Events list (backend `admin-roles` 7/7, web 8/8 green)
- [x] **Plan 10 · Events management** — [spec](./specs/2026-07-21-events-management-design.md) · [plan](./plans/10-events-management.md) — create/edit events (RLS-gated direct writes), categories/add-ons sub-editors, one-Save child reconcile, reschedule + cancel (hard-delete draft-only) (event-editor 3/3, web 16/16 green). *Custom-field editor deferred (form_fields still read-only).*
- [x] **Plan 11 · Event images** — [plan](./plans/11-event-images.md) — featured + gallery upload (Supabase Storage, client-side compression) and mobile rendering (event cards + detail carousel) (storage 2/2, web 27/27, mobile 45/45 green)
- [x] **Plan 12 · Editor structured inputs** — [plan](./plans/12-editor-structured-inputs.md) — PSGC Region→Province→City pickers + Venue, native date/time inputs (web)
- [x] **Plan 13 · Registrations & payments** — [spec](./specs/2026-07-22-registrations-payments-design.md) · [plan](./plans/13-registrations-payments.md) — org-scoped admin read RLS (registrations/addons/payments/profiles) + `decrement_slot`; event-scoped roster + detail; read-only payments ledger; full slot-freeing refunds via the `admin-refund` Edge Function (backend+shared 41/41, web 49/49 green)
- [x] **Event cards UX polish** — [spec](./specs/2026-07-22-event-cards-ux-polish-design.md) · [plan](./plans/event-cards-ux-polish.md) — mobile event cards show address/date-range/paid-joined-count; admin + mobile support optional multi-day `end_date`; native Select dropdowns fixed (bounded scroll + right-edge positioning); profile field values de-bolded; global pull-to-refresh (`useGlobalRefresh`) on all four data screens; home-screen icon rebranded from `topnav-logo.png`. (Featured image + event-page carousel were already shipped in Plan 11.)
- [ ] **Plan 14 · Race-day check-in** — web QR scanner + manual lookup
- [ ] **Plan 15 · Settings + Dashboard** — org settings, KPIs/charts
- [ ] **Plan 16 · super_admin** — org provisioning, commission, payout statements
