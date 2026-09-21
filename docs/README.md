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

## Web and admin readiness — September 2026

**Primary progress table:** [Launch progress](./operations/launch-progress.md). Update affected rows after each setup, implementation or verification step; show the next task and outstanding blockers.

**Required release path:** [Staging-first workflow](./operations/release-workflow.md). Every application and backend change must pass the exact staging revision before promotion into `main`.

Active verification ledger: [end-to-end checklist](./plans/2026-09-15-web-admin-e2e-checklist.md). Local refund ownership and durable callback reconciliation are implemented under [this plan](./plans/2026-09-16-durable-refund-requests.md). Staff invitation redirects, event restrictions and SMTP resend are implemented locally under [this plan](./plans/2026-09-16-staff-invitation-fixes.md). Hosted rollout and production readiness remain pending. The historical roadmap below records earlier checkpoints.

Fixed-price pilot payment work: [PayMongo fee contract](./specs/paymongo-provider-fees.md), [implementation plan](./plans/2026-09-18-paymongo-provider-fees.md), and [review findings](../.claude/code-reviews/2026-09-18-fixed-price-paymongo.md). Staging code and price disclosure are deployed; a fresh sandbox capture, session expiry, and durable reconciliation remain before production.

Zero-commission pilot organizer provisioning: [implementation plan](./plans/2026-09-18-zero-commission-org-provision.md). The form and provisioning function require an explicit nonnegative term and accept 0% or ₱0 for the pilot.

Protected production runner smoke: [provider fix plan](./plans/2026-09-18-production-runner-provider.md). The production root layout must supply the same React Query context as staging when the protected deployment URL serves runner pages.

Super-admin organization scope: [selection fix plan](./plans/2026-09-18-super-admin-org-scope.md). The validated organization selected in the console must be the one used by org-scoped queries, even when the super admin also holds an org admin role.

Platform user administration: [design](./specs/2026-09-20-platform-users-design.md) and [implementation plan](./plans/2026-09-20-platform-users.md). The approved table and inspector provide platform account, event, payment and Race Passport visibility, with protected Supabase Auth suspension staged before production.

Unbound PayMongo checkout review: [implementation plan](./plans/2026-09-18-unbound-paymongo-review.md). The fail-closed payment endpoint and platform alert are deployed to staging. A safe operator review queue and provider-backed resolution are planned; the payment launch gate remains open.

## Production purchasing

- [Services, subscriptions and domain checklist](./operations/production-services-checklist.md) — required accounts, optional upgrades, budget and activation order for web/admin production.
- [Hosted setup checkpoint](./operations/2026-09-17-hosted-setup.md) — purchased domain, staging database preparation, Resend DNS, connector status, and remaining deployment work.

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
- [x] **Payments · A1 — Real money engine** — [spec](./specs/2026-07-23-payments-real-money-engine-design.md) · [plan](./plans/17-payments-real-money-engine.md) — real PayMongo refunds via the `PaymentProvider.refund()` abstraction (chosen by `payments.provider`); a signature-verified `payments-webhook` owning `checkout_session.payment.paid` + `refund.updated`; atomic `confirm_payment_tx` / `refund_registration_tx` RPCs replacing the sequential money writes (confirm is now replay-safe — guards a refunded reg from re-confirmation). First slice of the Payments track (A1 → A2 refund approval queue → A3 commission rollup). (backend 54/54, web 51/51 green; real-PayMongo refund + webhook delivery pending a hosted test-mode smoke)
- [ ] **Plan 14 · Race-day check-in** — web QR scanner + manual lookup
- [ ] **Plan 15 · Settings + Dashboard** — org settings, KPIs/charts
- [ ] **Plan 16 · super_admin** — org provisioning, commission, payout statements
- [x] **Organization management** — [spec](./specs/2026-08-18-org-management-design.md) — rename · manage admins · suspend · delete from the Organizations page. Hard delete is money-guarded and runs as one `delete_organization_tx` RPC — not for FK-ordering reasons (a plain `delete from organizations` was tested and does not abort) but because the money guard and the deletes must be one atomic unit, and the RPC returns the counts the console consumes. `orgs_read_active` is widened so a suspended org stays visible to its own admins and the platform operator; suspended orgs leave the storefront and `registrations-checkout` refuses them. Also fixes the provisioning invite link — `site_url` was still `localhost:3000`, and neither app had a route that could consume a magic link — and defaults the create dialog to 3%. (backend 379/394, web 725/725, site 318/318 green — the 15 backend failures are pre-existing and unrelated to this branch: 14 are `payments-webhook` 401s from its signature check, since there is no local `supabase/functions/.env` holding the webhook secret, and 1 is `processor-rates.test.ts` asserting against a hardcoded `2026-08-15` date now in the past; deploy to hosted and end-to-end verification against `whaqarofxdlzxrelbcrq` still pending)

- 2026-09-16 readiness update: pending-refund browser recovery verified with a controlled local fixture. [Selected-event check-in guard](issues/issue-checkin-selected-event.md) fixed and validated locally. Race-kit release and durable check-in undo audit remain open in the [web/admin checklist](plans/2026-09-15-web-admin-e2e-checklist.md).
- 2026-09-16: [durable check-in audit](specs/checkin-audit.md) implemented and browser-verified locally. [Race-day operations plan](plans/2026-09-16-race-day-operations.md) tracks the remaining kit policy decision and implementation.
- 2026-09-16: [race-kit release](specs/race-kit-release.md) implemented and verified locally with runner-only collection, refund blocking, admin reversal history, scoped staff and CSV. Supersedes the earlier kit-policy blocker. Browser download acceptance, staff invitations and hosted rollout remain in the [readiness checklist](plans/2026-09-15-web-admin-e2e-checklist.md).
- 2026-09-16: [staff invitation validation](issues/2026-09-16-staff-invitation-readiness.md) found pilot blockers: operational staff land on Team, event scope cannot be assigned in Team, and existing-user invite feedback overstates email delivery. Real Mailtrap acceptance and immediate access removal passed locally; fixes and full admin-form retest remain pending.

### 2026-09-16: email authentication completion

Runner confirmation now waits for email and resumes the intended route. Web and admin have password recovery screens. See [spec](specs/email-auth-completion.md) and [plan](plans/2026-09-16-email-auth-completion.md). Local Mailpit confirmation and both browser password reset/sign-in journeys are verified. Hosted recovery redirect allowlist remains a deployment task.

## Planned registration revisions

- [Assisted registration and Passport revisions](./plans/2026-09-16-assisted-registration-passport-revisions.md) — implementation started locally: Passport identity/access foundation, self/managed editor and structured shipping addresses. Self-checkout completeness and canonical identity snapshots are enforced locally. Organizer waiver publishing, event selection and self-registration acceptance evidence are implemented locally. Basic assisted checkout, separate helper bookings and guest notification routing are available locally. Full payment/scanning verification, privacy controls, optional check-in and release validation remain pending.


### 2026-09-16 non-member payment walkthrough

Local PayMongo TEST payment, helper ticket email, guest kit release and repeat QR check-in were exercised. Callback, managed-ticket navigation, email total/name and helper kit-status access were corrected. Financial reporting still needs reconciliation: provider test fee differs from checkout estimate, and admin registration detail/history label base entry as paid gross. See the [revision plan](plans/2026-09-16-assisted-registration-passport-revisions.md). Status remains PARTIAL; no hosted deployment.


### Planned: group registration checkout

User-requested scope added to the [revision implementation plan](plans/2026-09-16-assisted-registration-passport-revisions.md): select multiple own/managed Passports, pay once, and issue a separate named QR per participant. Includes atomic slot holds, per-person waivers/kits, refund allocations and report/payout reconciliation. Internal reservation slices are now implemented locally; the public group flow remains disabled.


### 2026-09-17 group checkout architecture

Same-category group checkout confirmed by the user. [Architecture baseline](specs/group-checkout-architecture.md) defines one shared payment with separate participant registrations, atomic slot holds, fee allocations and order-aware refunds. Internal reservation work is implemented locally; combined payments, refunds and the public UI remain pending.


### 2026-09-17 group foundation implemented locally

[Internal schema and capacity guard](plans/2026-09-17-group-order-foundation.md) now support scoped order links and shared pending-slot accounting. Concurrency, rollback and access tests passed. Group checkout remains disabled pending payment/refund integration. The atomic reservation API is tracked below.


### 2026-09-17 atomic group reservations implemented locally

[Reservation API plan](plans/2026-09-17-group-reservation-api.md): a verified booker can reserve one to ten same-category Passports atomically, including guests-only groups. Saved identity, individual kit choices, organizer waiver evidence and add-on prices are validated and frozen. Replays keep the same IDs and hold expiry; capacity shares the legacy registration lock. The endpoint defaults to disabled. No combined payment or group QR delivery yet. See the [implementation report](../.claude/reports/2026-09-17-group-reservation-api-report.md) for validation.


### 2026-09-17 group payment preparation implemented locally

[Combined pricing and durable attempts](plans/2026-09-17-group-payment-preparation.md) now freeze per-participant commission, one shared processor fee, predicted allocations and the effective rate card. Retries reuse the same attempt; concurrent or unknown attempts prevent a second live quote. Zero-commission pilots and free entries are supported. Provider dispatch/capture, actual fee allocation, separate QR generation, refunds/reporting and grouped UI remain pending. The new endpoint defaults to disabled. [Validation report](../.claude/reports/2026-09-17-group-payment-preparation-report.md).


### 2026-09-17 internal group payment dispatch and confirmation

[Group capture slice](plans/2026-09-17-group-payment-capture.md) implements frozen PayMongo session dispatch, one-attempt retries, authoritative capture verification, atomic participant ticket generation, actual fee allocations and a delivery outbox. Late/extra/mismatched captures are retained for reconciliation. Local tests use mocked provider transport; no sandbox/browser group payment has been verified. Public flags remain off. Free fulfillment, refunds, recovery/expiry/delivery workers, reports/payouts and grouped UI remain activation gates. [Validation report](../.claude/reports/2026-09-17-group-payment-capture-report.md).


### 2026-09-17 internal group refunds

[Group refund plan](plans/2026-09-17-group-refunds.md) now has local backend support for selected-ticket and remaining-order refunds against one shared capture. Durable requests preserve fee policy, serialize uncertain outcomes, and revoke only successfully refunded tickets. Separate refund allocations preserve original payment history for the next reports/payout slice. The admin endpoint defaults to disabled. No live PayMongo refund or browser group flow verified. [Validation report](../.claude/reports/2026-09-17-group-refunds-report.md).


### 2026-09-17 group reports and payout accounting

[Financial reporting plan](plans/2026-09-17-group-financial-reporting.md) implemented locally: fulfilled group captures appear once in payments, participant allocations feed registrations/settlement/commission, and CSV carries shared references. Unknown actual fees/net remain explicit. Group refunds are netted before settlement or recovered once after settlement; snapshots reject stale payouts. Backend587 and web853 tests passed, with typecheck and in-app browser Payments/Commission smoke. Group checkout remains disabled pending recovery, delivery, reconciliation, free fulfillment, grouped UI and sandbox acceptance. [Report and limitations](../.claude/reports/2026-09-17-group-financial-reporting-report.md).


### 2026-09-17 group ticket-email delivery worker

[Delivery plan](plans/2026-09-17-group-ticket-delivery.md) implemented locally: protected worker, leased outbox claims, failed-send backoff, stale completion guards and one booker email containing named active participant tickets. Refunded tickets are omitted. Original booking total appears once. Backend593 tests and Deno checks passed. Runtime flag and scheduler remain off; transport verification and group browser flow are pending. [Report](../.claude/reports/2026-09-17-group-ticket-delivery-report.md).
