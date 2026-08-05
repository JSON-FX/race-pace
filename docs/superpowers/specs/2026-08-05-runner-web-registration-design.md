# Runner Web — Public Registration Site

**Status:** Approved, ready for implementation plan
**Scope:** New `apps/site` (Next.js 15, App Router) + **three Edge Function changes** in `supabase/` + **a migration of the backend to a new hosted Supabase project** (§3.2) + **deploying the existing admin console to Vercel** (§9.2). **No schema changes.** `apps/mobile` and `apps/web` change only in configuration.
**Branch:** `claude/event-registration-web-fff722`
**Driver:** an event is close. The critical path is **register → pay → ticket**; everything else is scaffolding around it.

## 1. Goals

Race Pace has a runner-facing native app (`apps/mobile`) and an organizer-facing admin console (`apps/web`). It has **no public web surface** — a runner without the app cannot enter a race.

1. **Runners can register, pay, and get a ticket from a browser**, using the same PayMongo rails and the same signed ticket tokens the mobile app already uses.
2. **Every web registration lands in the admin console** with no sync layer — same `registrations` and `payments` tables the console already reads.
3. **Event pages are shareable and indexable.** An organizer pasting an event link into a Facebook group gets a real preview card. For a near-term event this is the acquisition channel, not a nicety.
4. **One runner identity** across web and mobile — the same Supabase Auth user, via email/password or Google.
5. **The ticket survives a dead trailhead.** Emailed on payment confirmation, plus a printable page.

## 2. Non-goals

- **No marketplace parity with mobile.** Org landing pages, notifications, the Race Passport redesign, and the races feed's social surface are out. `/profile` is a minimal editable passport, not the mobile redesign.
- **No schema changes.** The flow works entirely against existing tables, and no new migration file is authored. A `source` column distinguishing web from mobile registrations was considered and rejected — the rows already reach the admin console, and it puts a schema change on the critical path for a badge. (The existing 31 migrations *are* applied to the new project per §3.2; that is a deployment step, not a schema change.)
- **No source changes to `apps/mobile` or `apps/web`.** Per §3.2 they get one env-configuration line each and a smoke test; per §9.2 `apps/web` also gains a `vercel.json`. No component, query, or logic changes to either app.
- **No admin console redesign or new admin features.** It is deployed as-is (§9.2).
- **No shared `packages/ui`.** `apps/web` is Vite, `apps/mobile` is NativeWind, `apps/site` is Next — three build pipelines for maybe six components, and it would put a refactor of the working admin console in front of a near event. Only `packages/shared` (framework-agnostic types, validators, formatters) is shared.
- **No changes to the money path's logic.** `registrations-checkout`, `payment-session`, `payment-verify`, `payments-webhook`, and `_shared/confirm.ts` keep their existing behaviour. They gain CORS headers and one best-effort email call.
- **No PDF library.** See §6.4.
- **No Firebase.** See §3.1.
- **No admin console changes.** Web registrations render in the existing Registrations table with no work.

## 3. Starting state

Measured on `2026-08-05`.

| Fact | Value |
|---|---|
| Backend | **Complete.** `registrations-checkout`, `payment-session`, `payment-verify`, `payments-webhook`, `check-in` all working |
| PayMongo | Live hosted checkout in test mode. `return_url` is already a request parameter |
| Public catalog RLS | `events`, `categories`, `addons`, `form_fields`, `organizations` are **`anon`-readable** for non-draft events (`grant select … to anon, authenticated`) |
| CORS on Edge Functions | **None.** Zero `Access-Control-Allow-Origin` anywhere in `supabase/functions/` |
| Email | **None configured.** Org invites are blocked on the same gap |
| Ticket | `ticket_token`, HMAC-signed, verified by `check-in`; mobile renders it as a QR cached in AsyncStorage |
| Workspace | `pnpm-workspace.yaml` globs `apps/*` — a new `apps/site` is picked up with no config change |
| `packages/shared` | Already exports every validator and formatter the wizard needs |

Two consequences shape the whole design:

- **The server work is nearly done.** This is predominantly a frontend build. The only backend changes are CORS, an email function, and a QR endpoint.
- **CORS is a hard blocker.** Mobile never needed it. A browser on a Vercel origin will fail preflight on every Edge Function call. Nothing works until §5.1 lands.

### 3.1 Authentication — why not Firebase

The original request mentioned setting up Firebase for OAuth. This design **uses Supabase Auth's native Google provider instead**, decided during brainstorming.

Supabase Auth issues the JWT that both RLS policies and every Edge Function verify (`db.auth.getUser(jwt)`). A Firebase-issued token is not that JWT. Wiring Firebase in would require a token-exchange shim — a new failure mode on the critical path, for identical setup effort.

The actual setup is a **Google Cloud OAuth 2.0 client**, with client ID and secret pasted into Supabase Dashboard → Authentication → Providers → Google. Authorized redirect URI — note this points at the **new** project (§3.2), not the retired one:

```
https://whaqarofxdlzxrelbcrq.supabase.co/auth/v1/callback
```

### 3.2 Backend migration — new hosted project

**Added 2026-08-05, after the original design was approved.** A new hosted Supabase project has been created under a different Google account and becomes the single source of truth for **all three apps**.

| | Old | New |
|---|---|---|
| Project ref | `ytwdrsmclwghwktpupqd` | `whaqarofxdlzxrelbcrq` |
| State | Paused (§10) | Empty — schema not yet applied |

This **widens the scope declared in §2**. `apps/mobile` and `apps/web` were listed as untouched; both now need their `.env` repointed. The code change is one line of configuration each — no source changes — but it means this branch alters the backend both other apps talk to, and they must be smoke-tested before merge.

The migration is mechanical, because everything needed is already version-controlled:

- `supabase/migrations/` — 31 migrations including the three `storage.buckets` inserts (`event-images`, `profile-images`, `org-images`), so `db push` recreates storage too.
- `supabase/seed.sql` — 5 organizations and 5 events.
- `supabase/functions/` — 11 functions, deployed with `functions deploy`.

Three things do **not** carry over and must be recreated by hand:

1. **Function secrets** — `TICKET_SIGNING_SECRET`, `PAYMONGO_SECRET_KEY`, `PAYMONGO_WEBHOOK_SECRET`, `PUBLIC_FUNCTIONS_URL`, plus this design's `RESEND_API_KEY` and `SITE_ORIGINS`.
2. **The PayMongo webhook** — it points at the old project's `payments-webhook` URL and must be re-registered against the new one, yielding a **new** `PAYMONGO_WEBHOOK_SECRET`.
3. **Auth configuration** — the Google provider, and the redirect allowlist.

**`TICKET_SIGNING_SECRET` deliberately does not need to match the old project's value.** Tickets are minted per registration against whichever secret is live; since the new project starts with no registrations, a fresh secret is correct. Reusing the old one would be harmless but pointless.

**The 20 seeded test events noted in prior work are *not* in `seed.sql`** — they were inserted directly into the old hosted database and are lost. `seed.sql` recreates 5 events, which is sufficient for development. Real event data for the upcoming race is entered through the admin console.

The old project is left untouched rather than deleted, so it remains available as a reference until the new one is verified end to end.

## 4. Application structure

### 4.1 The new app

`apps/site` — Next.js 15, App Router, TypeScript, Node 20 (matching `.nvmrc`).

Naming stays unambiguous across the monorepo:

| App | Audience | Surface |
|---|---|---|
| `apps/mobile` | Runners | Native (Expo) |
| `apps/web` | Organizers | Admin console (Vite) |
| `apps/site` | Runners | Public web (Next.js) |

**Dependencies:** `next`, `react`, `react-dom`, `@supabase/supabase-js`, `@supabase/ssr`, `@tanstack/react-query`, `tailwindcss@4`, `radix-ui`, `lucide-react`, `zod`, `qrcode`, and `@race-pace/shared` as `workspace:*`.

### 4.2 Supabase access — App Router SSR

Public catalog pages are **Server Components** fetching with the anon key. This buys fast first paint, `generateMetadata` for Open Graph cards, and indexable event pages (§1.3).

Session lives in **cookies** via `@supabase/ssr`, with a `middleware.ts` refreshing the token on every request. Server code calls **`getUser()`**, never `getSession()` — `getSession()` returns unverified cookie contents, while `getUser()` revalidates against the auth server.

Rejected alternatives:

- **Client-only** (every page `'use client'`, like `apps/mobile` and `apps/web`). Fastest to write, but event pages render blank until hydration and produce empty social previews — which defeats §1.3.
- **Static/ISR event pages.** Fastest possible, but category slot counts go stale. A sold-out distance showing as available during race week is a support incident. Slot counts render per request, no ISR.

### 4.3 Shared code

Imported from `packages/shared` unchanged:

`registrationInputSchema` · `customDataSchema` · `formFieldSchema` · `isProfileKey` · `PROFILE_KEYS` · `SHIRT_SIZES` · `BLOOD_TYPES` · `GENDERS` · `formatPeso` · `formatDateRange` · `formatAddress` · `RegistrationStatus`

The wizard therefore validates with **the same code the Edge Function validates with** — the browser cannot accept input the server will reject, and vice versa.

The data layer (`apps/site/lib/events.ts`, `lib/registration.ts`) deliberately mirrors the shapes in `apps/mobile/lib/` — same `EventRow`, same `mapReg`, same `REG_SELECT` column list. A future query change is then visibly needed in both places.

### 4.4 Design system

Tokens are ported from `apps/mobile/global.css` into `apps/site/app/globals.css`: trail-green `#159A55` primary, `#0f2a20` forest, the status palette, the apple-chassis type scale. Light and dark, as mobile ships. Logos reuse `login-logo.png` and `topnav-logo.png`.

**Visual direction: editorial trail magazine.** Large landscape hero photography, oversized tight-tracked headlines, generous whitespace, green reserved for CTAs and status. It should read as a race brochure, not a dashboard.

Concretely, this means `apps/site`'s `Button` and `Card` do **not** inherit the admin console's proportions — larger radii, taller CTAs, heavier headline tracking. Same tokens, different scale. The `frontend-design` skill is invoked when building these surfaces.

Components are pulled from the shadcn registry at current versions (§4.5), then rethemed — not copied from `apps/web/src/components/ui`.

### 4.5 Tooling — shadcn MCP

The shadcn MCP server is registered and reachable. It is used for:

- `view_items_in_registries` — read a component's current source before adding it, rather than reproducing shadcn from memory. **Verified working.**
- `search_items_in_registries` — discover blocks worth starting from for the editorial pages.
- `get_audit_checklist` — post-generation verification.

**Known limitation:** the server resolves `components.json` from its working directory, which is the worktree root. No `components.json` exists there (only `apps/web/` and `apps/mobile/`), so `get_project_registries` returns empty and `search_items_in_registries` finds nothing. `view_items_in_registries` works regardless.

Resolution, in preference order:

1. After `apps/site` is scaffolded (`shadcn init` creates `apps/site/components.json`), the MCP server is re-registered scoped to that directory. Requires one command from the user.
2. Fallback: add a thin root `components.json` mirroring `apps/site`'s config, purely for MCP registry resolution. `shadcn add` is still run from inside `apps/site`. Needs nothing from the user.

Implementation proceeds under (2) if (1) has not happened, and is not blocked by either.

## 5. Backend changes

**No schema migration.** Three code changes in `supabase/functions/`, plus secrets configuration.

### 5.1 CORS — `_shared/cors.ts` (blocking)

A shared helper: origin allowlist read from a `SITE_ORIGINS` secret (comma-separated, supporting `*.vercel.app` wildcards for preview deploys), an `OPTIONS` preflight responder, and a header-merging wrapper for JSON responses.

Applied to **every function a browser calls directly** — six, not three. The original three are the new site's:

- `registrations-checkout`
- `payment-session`
- `payment-verify`

The other three are the **admin console's**, discovered while scoping §9.2:

- `org-members` — `apps/web/src/lib/team.ts:32`
- `admin-refund` — `apps/web/src/lib/registrations.ts:106`
- `check-in` — staged in `apps/web/src/lib/checkin.ts`

These already run cross-origin from the admin console and have no CORS handling, and there is none at the gateway either (`supabase/config.toml` contains no CORS configuration). Moving the console to a Vercel origin (§9.2) makes correct preflight handling mandatory for them. Covering all six now costs three extra edits of the same shape.

`payments-webhook` is deliberately **excluded** — PayMongo calls it server-to-server, where CORS does not apply.

Rejected alternative: proxying Edge Function calls through Next.js Route Handlers to sidestep CORS. It adds a network hop and buries PayMongo's error bodies behind a second layer, degrading the error mapping in §7.

### 5.2 `send-ticket-email`

New function. Sends the ticket confirmation via the **Resend** HTTP API (no SMTP libraries in Deno; free tier covers 3k/month; also unblocks the stalled org-invite emails later).

**Trigger point:** called best-effort from `_shared/confirm.ts`'s `confirmPayment()`. That function is the single choke point both `payment-verify` and `payments-webhook` already funnel through, so the email fires **exactly once per payment regardless of which path confirms it** — and mobile registrations gain ticket emails as a side effect.

Failure to send **must not** fail the payment confirmation. The call is wrapped and logged.

**Content:** event name, category, date, venue, reference code, the QR as an embedded image (§5.3), and a link to the ticket page.

### 5.3 `ticket-qr`

New function. `GET /functions/v1/ticket-qr?token=<ticket_token>` returns a PNG of that token's QR.

Needed because Gmail and most clients strip `data:` URIs, so the email cannot inline the QR directly.

Generated with `npm:qrcode`'s `toBuffer` via Deno's npm compatibility — pure-JS PNG encoding through `pngjs`, with **no native canvas dependency**, which would not survive the Edge runtime.

**Unauthenticated by design.** It renders a QR of a token the caller already holds — it discloses nothing the caller does not already have. `check-in` independently gates on `status = 'paid'` plus staff authorization for the scanner's org, so possession of a token is not sufficient to do anything.

### 5.4 Secrets

| Secret | Where | Value |
|---|---|---|
| `RESEND_API_KEY` | Supabase function secret | From the Resend dashboard |
| `SITE_ORIGINS` | Supabase function secret | Comma-separated allowlist of the Vercel origins |

## 6. Routes and flows

### 6.1 Route map

**Server Components** — anon key, no session, indexable:

| Route | Content |
|---|---|
| `/` | Hero for the nearest upcoming event, plus an upcoming events grid |
| `/events` | All published events; filter by distance, region, month |
| `/events/[id]` | Hero, description, gallery, categories with live slot counts and price, inclusions, venue, organizer |

Each defines `generateMetadata` producing Open Graph tags from the event's hero image, name, date, and distances.

**Client Components** — session required, TanStack Query:

| Route | Content |
|---|---|
| `/register/[categoryId]` | The registration wizard (§6.2) |
| `/pay/[registrationId]` | Method selection → PayMongo handoff |
| `/pay/callback` | Return landing → `payment-verify` → redirect |
| `/ticket/[registrationId]` | QR ticket, print stylesheet |
| `/races` | My Races — upcoming and past registrations |
| `/profile` | Minimal Race Passport |
| `/sign-in`, `/sign-up` | Email/password and Google |
| `/auth/callback` | OAuth code exchange |

**Route protection:** unauthenticated access to a protected route redirects to `/sign-in?next=<path>`. A runner landing cold on a register link is returned to that link after signing in, not dumped on the homepage.

### 6.2 The registration wizard

Three in-form steps, then the pay page. Presented as a four-dot progress rail so the runner sees the whole journey.

1. **Runner details** — full name, bib name, date of birth, gender, emergency contact. Prefilled from `profiles` when present.
2. **Kit & event questions** — shirt size, blood type, "first ultra at this distance", then the organizer's `form_fields` rendered dynamically, then add-ons with prices.
3. **Review & waiver** — full summary, price breakdown, waiver text, accept toggle. Submit calls `registrations-checkout`.
4. **Pay** — `/pay/[registrationId]`.

Step 1 exists because mobile does **not** ask for these fields — it reads them from the runner's Race Passport. A first-time web signup has an empty profile, so the data has to be collected somewhere.

**Draft persistence.** Wizard state is held in `sessionStorage` keyed by `categoryId`, restored on mount, cleared on successful checkout. `sessionStorage` rather than `localStorage`: a registration takes minutes, and stale drafts should not persist on a shared machine.

**Idempotency key.** Mobile generates its key with `useState(() => \`${categoryId}:${Date.now()}\`)`. On the web that mints a **new key on every refresh**, producing duplicate pending registrations. The key is therefore generated once and **stored with the draft**, never regenerated on restore. The server's `onConflict: "user_id,idempotency_key"` upsert then correctly deduplicates.

**Save-back to profile** mirrors mobile's logic — defaults on when the profile was empty (`filledFromEmpty`), shows a toggle when editing values that already existed (`editedExisting`).

### 6.3 Payment

The pay page ports mobile's screen: ticket-stub total, charge breakdown (entry fee / add-ons / booking fee free), what's included, and a Card / GCash / Maya radio.

Pay calls `payment-session` with `return_url = https://<origin>/pay/callback?rid=<id>`, then `window.location.assign(checkout_url)`.

**Structural difference from mobile:** mobile opens an in-app browser and awaits its dismissal, holding state in memory. Web performs a **full-page redirect off-site and back**, so there is no in-memory state to preserve — `/pay/callback` *is* the resume point. This is simpler, not merely different.

**`/pay/callback`** calls `payment-verify`, which re-fetches the PayMongo session server-side. **The redirect is never trusted**, exactly as on mobile. Outcomes:

| Result | Behaviour |
|---|---|
| Verified paid | Redirect to `/ticket/<rid>` |
| Still pending | Waiting screen, re-polls every 3s, "Check again" button, "still processing" message at 90s (mirroring mobile's `TIMEOUT_MS`) |
| `status=cancel` | Back to `/pay/<rid>` with a cancelled notice |
| Tab closed entirely | `payments-webhook` confirms the payment regardless |

### 6.4 The ticket

`/ticket/[registrationId]` renders the QR from `ticket_token` as an inline SVG via `qrcode`. The race-pass card carries a forest header with event name and date, a dashed perforation, the QR, the reference code, and a runner / bib / category / distance grid — the same composition as mobile's ticket.

**On PDF.** No PDF library. A `@media print` stylesheet plus a "Save as PDF / Print" button calling `window.print()` produces a real PDF through the OS dialog on desktop, iOS, and Android — without a ~350kb dependency or a second rendering path to keep in sync with the ticket design.

This is a **deliberate simplification for the deadline**, recorded as such. The durable offline artifact is the email (§5.2), which carries the QR as an image and stays in the runner's inbox. A true one-click `.pdf` can be added later without disturbing anything here.

## 7. Error handling

Edge Function errors are parsed out of `FunctionsHttpError`'s response body, matching the pattern already in `apps/mobile/lib/registration.ts`'s `startCheckout`, then mapped to human copy:

| Server error | Runner sees |
|---|---|
| `sold_out` | "This distance just sold out" + links to the event's other distances |
| `not_pending` | "You've already paid — view your ticket" + link |
| `waiver_required` | Step 3 waiver toggle highlighted |
| `invalid_custom_data` | Field-level highlights on the offending step, using `details.fieldErrors` |
| `unauthorized` | Redirect to `/sign-in?next=<path>` |
| Anything else | Generic failure with a retry, error logged |

**Sold-out races.** The wizard displays live slot counts, but the authoritative guard is the server's `slots_taken >= slots_total` check returning 409 on submit. The UI treats the 409 as truth, not the count it rendered.

**Abandoned payments.** A pending registration persists. `/races` surfaces it with a "Complete payment" CTA, and mirrors mobile's `cancelRegistration` for discarding an own-pending row (RLS policy `registrations_delete_own_pending`).

**Email failure** never blocks payment confirmation (§5.2).

## 8. Testing

**Vitest + Testing Library**, matching `apps/web`'s existing setup:

- Wizard step validation against the shared schemas
- Draft persist/restore, asserting **idempotency-key stability across a simulated refresh** (§6.2)
- Price computation — base price plus selected add-ons
- Error-code → message mapping (§7)
- `mapReg` shape
- Ticket render with and without a token
- Route protection — protected route without a session redirects with the `next` param intact

**Deno-side**, alongside the existing `authz.test.ts` / `ticket.test.ts` pattern:

- `_shared/cors.ts` — allowlist matching, preflight response, rejection of a disallowed origin
- The Resend email provider

**Manual go-live smoke**, once §10 is cleared: full register → pay → ticket run on the Vercel preview with PayMongo test card `4343 4343 4343 4345`, then confirm the row appears in the admin console's Registrations table.

## 9. Deployment

**Two Vercel projects from this one monorepo**, both on `*.vercel.app` subdomains for now. Custom domains can be attached later without redeploying — only `SITE_ORIGINS` and the Supabase redirect allowlist need updating when that happens.

| Project | Root directory | Framework | URL |
|---|---|---|---|
| `race-pace` | `apps/site` | Next.js | `https://race-pace.vercel.app` |
| `race-pace-admin` | `apps/web` | Vite | `https://race-pace-admin.vercel.app` |

### 9.1 Public site — `apps/site`

Vercel's Next.js preset, root directory `apps/site`, building through the pnpm workspace so `@race-pace/shared` resolves.

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://whaqarofxdlzxrelbcrq.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The new project's anon key |
| `NEXT_PUBLIC_SITE_URL` | `https://race-pace.vercel.app` |

`NEXT_PUBLIC_SITE_URL` is what the pay flow uses to build its `return_url`. If it is wrong, PayMongo redirects the runner to a dead origin after paying — the payment still confirms via webhook, but the runner sees a broken page at the worst possible moment.

### 9.2 Admin console — `apps/web`

**New in this design.** The console currently runs LAN-only at `https://admin.racepace.lan` via Docker + Traefik. It moves to Vercel so organizers can work from anywhere, including race day on mobile data.

Vercel's Vite preset, root directory `apps/web`, output `dist`.

A `vercel.json` is added to `apps/web` because the console uses `react-router-dom` client-side routing — without an SPA rewrite, a hard refresh on any route below `/` returns 404:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://whaqarofxdlzxrelbcrq.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | The new project's anon key |

**Vite embeds env vars at build time**, not runtime. Changing either value requires a redeploy, not just an env-var edit — unlike the Next.js app, where server-side reads pick up changes on the next request.

**Security posture — decided, not incidental.** The console becomes reachable from the public internet. This is acceptable because access is gated by Supabase Auth and every query is constrained by org-scoped RLS (`auth_can_admin_org`), so the browser bundle carries no privileged secret; the anon key is designed to be public. Vercel password protection was considered and rejected — it is a paid feature and introduces a shared password for organizers to distribute and rotate. The existing Docker + Traefik setup stays available for local development.

The one consequence that must not be missed: this is what makes CORS on `org-members`, `admin-refund`, and `check-in` mandatory (§5.1).

### 9.3 Shared configuration

| Secret | Where | Value |
|---|---|---|
| `RESEND_API_KEY` | Supabase function secret | From Resend |
| `SITE_ORIGINS` | Supabase function secret | `https://race-pace.vercel.app,https://race-pace-admin.vercel.app,*.vercel.app,http://localhost:3000,http://localhost:5173,https://admin.racepace.lan` |

The `*.vercel.app` wildcard covers preview deployments, which get a fresh subdomain per branch and can never be enumerated in advance. The two `localhost` entries and `admin.racepace.lan` keep local development working against the hosted backend.

Also required:

- Supabase Dashboard → Authentication → URL Configuration: both Vercel production URLs plus `https://*-race-pace.vercel.app` preview patterns added to the redirect allowlist.
- Google Cloud OAuth client configured per §3.1.
- Resend sending domain verified.

## 10. Pre-launch blockers

**Superseded 2026-08-05 by §3.2.** The original two blockers — the old project being paused, and a possibly-unapplied `db push` leaving `20260804120000_admin_list_views.sql` missing — are both resolved by migrating to a fresh project, since `db push` applies all 31 migrations from scratch.

The replacement blockers, all owned by the user because they need account access:

1. **MCP authentication.** `.mcp.json` now points at `whaqarofxdlzxrelbcrq`, but the server needs an OAuth flow that cannot run in a non-interactive session. Until the user runs `/mcp` in an interactive terminal and authenticates, the Supabase MCP tools are unavailable and all database work goes through the CLI instead.
2. **CLI link.** `supabase link --project-ref whaqarofxdlzxrelbcrq` needs the new project's database password.
3. **PayMongo webhook re-registration** against the new project's `payments-webhook` URL, producing a new `PAYMONGO_WEBHOOK_SECRET` (§3.2).
4. **Google OAuth client** pointed at the new callback (§3.1).
5. **Resend account** with a verified sending domain.

Items 3–5 are external-account work. Items 1–2 gate the implementation itself.

## 11. Sequencing

The order the implementation plan should follow, chosen so the risky and blocking pieces land first:

0. **Migrate the backend to the new hosted project** (§3.2) — link, `db push`, seed, deploy functions, set secrets, repoint all three apps. Nothing else can be verified against a live backend until this is done.
1. **CORS** (§5.1) — blocks every browser call; nothing is testable before it.
2. **Scaffold `apps/site`** — Next.js, Tailwind v4, tokens, Supabase SSR client, middleware, `components.json`.
3. **Auth** — sign-in, sign-up, Google, `/auth/callback`, route protection.
4. **Public catalog** — `/`, `/events`, `/events/[id]` with `generateMetadata`.
5. **Wizard** (§6.2) — the largest single piece.
6. **Pay + callback** (§6.3).
7. **Ticket page** (§6.4).
8. **Email + QR endpoint** (§5.2, §5.3) — last, because it is the only piece with an external account dependency, and the ticket works without it.
9. **My Races and profile.**
10. **Deploy both Vercel projects and smoke** (§8, §9). The admin console deploys alongside the public site — it depends only on Task 0's repoint and the widened CORS in step 1, so it can ship as soon as those land.
