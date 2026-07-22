# Supabase: local Docker → cloud migration & cutover — Design Spec

**Status:** Approved (brainstorm) · 2026-07-22 · branch `worktree-supabase-cloud-migration`
**Cloud project ref:** `ytwdrsmclwghwktpupqd` → `https://ytwdrsmclwghwktpupqd.supabase.co`

## 1. Goal

Move the backend from the **local Docker Supabase stack** to the **hosted Supabase
project** and make the hosted project the app's real backend. After cutover, the
mobile app (Expo dev-client) and the web admin console talk to cloud — so the app
works from anywhere, on a real device, **without** being on the same LAN as this Mac
and **without** the local Docker stack running.

Primary user outcome: *"whenever I'm not connected on my computer, I'm still able to
use Expo on my end"* — and mobile testing must hit **cloud**, never local Docker.

## 2. Decisions locked (from brainstorming)

1. **Full cutover.** Cloud becomes the shared dev/staging backend. Local Docker stays
   only as an optional offline/experimental loop; it is no longer the default.
2. **Mirror the seed data.** Apply the existing `supabase/seed.sql` (5 orgs, 5 events,
   categories, add-ons, form fields, provisioned admin) so cloud looks exactly like
   what we've been building against. PSGC reference data ships via migration.
3. **Route = hybrid.** The **Supabase CLI** performs the migration (canonical, ordered,
   scriptable). The MCP server (`claude mcp add …`) is also wired up for interactive
   querying/debugging after the user authenticates it via `/mcp` — but it is **not** on
   the critical path.
4. **Fresh function secret.** Generate a strong `TICKET_SIGNING_SECRET` for cloud
   rather than reusing the dev placeholder.
5. **Branch name.** Native worktree tool created branch `worktree-supabase-cloud-migration`
   (based on `mobile-rnr-migration` HEAD `68e1776`, so it carries dev-client support +
   the `sync-lan-ip.mjs` script this spec hardens).

## 3. Current state (what we're migrating)

- **13 migrations** in `supabase/migrations/` — orgs/profiles, events catalog,
  registrations/payments, marketplace fields, runner profile, **PSGC tables + 116 KB
  data**, user_roles, events write RLS, and the `event-images` storage bucket + policies.
- **`seed.sql`** — 5 orgs (a1–a5), 5 events (e1–e5, incl. one rescheduled + one
  cancelled), 13 categories, e1 add-ons + form fields, and an **admin user**
  (`admin@racepace.test` / `password123`) inserted directly into `auth.users` +
  `auth.identities` + `user_roles` with fixed UUID `…b1`.
- **3 Edge Functions** — `fake-checkout`, `payments-webhook`, `registrations-checkout`
  (+ `_shared`). Local project id in `config.toml`: `race-pace`; custom local ports
  (API 54521, DB 54522, …). CLI currently **not linked** to any cloud project.
- **Apps** read Supabase from env:
  - mobile `apps/mobile/.env` → `EXPO_PUBLIC_SUPABASE_URL` (today a LAN IP
    `http://192.168.254.127:54521`), `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
  - web `apps/web/.env` → `VITE_SUPABASE_URL` (`http://127.0.0.1:54521`),
    `VITE_SUPABASE_ANON_KEY`.
  - **`.env` files are gitignored/untracked**; only `.env.example` is tracked.

### 3.1 Verification findings (de-risking)

- **`scripts/sync-lan-ip.mjs` is manual-only** (`pnpm sync-lan-ip`); it is **not** wired
  into any `prestart`/Metro hook. It rewrites a host **only when the value has a `:port`**
  (regex requires `:\d+`). The cloud URL has **no port**, so the script physically cannot
  rewrite `EXPO_PUBLIC_SUPABASE_URL` once it points at cloud. Mobile stays on cloud.
- **`PUBLIC_APP_URL` is vestigial** — no function or app code reads it (only the sync
  script rewrites it in `functions/.env`). The mobile app builds its own return link at
  runtime: `Linking.createURL("pay-callback")` → `racepace://pay-callback`
  (`apps/mobile/app/pay/[registrationId].tsx`), which works on-device regardless of
  cloud/local. So it is **not** a cloud secret.
- **Only two function secrets matter on cloud:** `TICKET_SIGNING_SECRET` (used by
  `_shared/confirm.ts`) and `PUBLIC_FUNCTIONS_URL` (used by `_shared/payments.ts` +
  `fake-checkout` to build the checkout URL). Without `PUBLIC_FUNCTIONS_URL`, checkout
  URLs fall back to `127.0.0.1:54521` — broken on device. `SUPABASE_URL` /
  `SUPABASE_SERVICE_ROLE_KEY` are **auto-injected** by the platform into Edge Functions
  — do not set them (the `SUPABASE_` prefix is reserved).
- Mobile uses **expo-dev-client**; `EXPO_PUBLIC_*` vars are inlined by Metro at bundle
  time, so an env change needs only a Metro restart with cache clear (`expo start -c`),
  **no native rebuild**.

## 4. Migration approach (CLI, hybrid)

All DB/function operations target the **remote** project, so they are
working-directory-independent and run from this worktree. Uses the global `supabase`
CLI (v2.98.2 present; pinned devDep is 2.109.1 — fine for push/deploy/secrets).

**Credential handoff — only the user can do these (secrets never enter chat):**
1. `supabase login` (browser OAuth) — authenticates the CLI globally.
2. From this worktree: `supabase link --project-ref ytwdrsmclwghwktpupqd`, entering the
   **database password** at the prompt (reset it in Dashboard → Project Settings →
   Database if unknown). If a later non-interactive step re-prompts, fall back to
   exporting `SUPABASE_DB_PASSWORD` in the shell that launched Claude.
3. *(optional, user's original step 2)* `/mcp` → authenticate the `supabase` MCP server.

**Then the CLI drives (from the worktree):**
- `supabase db push` — apply all 13 migrations (incl. PSGC data) to cloud.
- Apply `seed.sql` to the remote DB (see §5 for the auth-user handling).
- `supabase functions deploy` — deploy the 3 functions.
- `supabase secrets set` — `TICKET_SIGNING_SECRET` (fresh), `PUBLIC_FUNCTIONS_URL`
  (`https://ytwdrsmclwghwktpupqd.supabase.co/functions/v1`).
- `supabase projects api-keys` — fetch the cloud **anon** key (public/shippable) for the
  app env files.

## 5. Seeding on hosted — the one real risk

`seed.sql` inserts straight into `auth.users`/`auth.identities` using `crypt()` /
`gen_salt()` from **pgcrypto**. On hosted Postgres those live in the `extensions` schema
and are not on the default `search_path` for a `psql`/`db push` session, so the raw seed
can fail with *"function crypt does not exist"*. Two-tier plan:

- **Primary:** apply `seed.sql` inside a transaction with `set search_path = public,
  extensions;` (or prefix `extensions.crypt` / `extensions.gen_salt`). Deterministic
  UUIDs make the non-auth rows (orgs/events/categories/add-ons/form_fields) safe.
- **Fallback:** if hosted GoTrue rejects the direct `auth.users` insert, create the admin
  via the Admin API (service-role `auth.admin.createUser`) and insert the matching
  `user_roles` row. (Admin API generates its own UUID; the `user_roles` insert is
  adjusted to that id — the fixed `…b1` is only referenced within the seed.)

Re-seeding: `seed.sql` uses plain `insert` (no `db reset` safety net on cloud). We apply
it **once**. Making it re-runnable (on-conflict guards) is noted as a follow-up, not done
now. The `runner@test.dev` test user is **not** seeded — create it via app sign-up when
needed (it persists on cloud; there is no reset to wipe it).

## 6. App cutover

- **mobile** `apps/mobile/.env`: `EXPO_PUBLIC_SUPABASE_URL=https://ytwdrsmclwghwktpupqd.supabase.co`,
  `EXPO_PUBLIC_SUPABASE_ANON_KEY=<cloud anon>`. No port → immune to `sync-lan-ip`.
- **web** `apps/web/.env`: `VITE_SUPABASE_URL=https://ytwdrsmclwghwktpupqd.supabase.co`,
  `VITE_SUPABASE_ANON_KEY=<cloud anon>`.
- **Tracked `.env.example`** files updated to the cloud shape (URL pattern + "get anon key
  from Dashboard/CLI") and committed.
- **`.env` are untracked + per-directory.** This worktree's `ios/` is gitignored (absent
  here), so **device testing runs from the user's main checkout**. Cutover therefore
  writes the cloud values into **both** the worktree and the main checkout `.env` files
  (or the values are handed over) so whichever directory runs Expo hits cloud.
- **Harden `scripts/sync-lan-ip.mjs`** — drop `EXPO_PUBLIC_SUPABASE_URL` from its targets
  and reword the header to "only for the optional local/offline Docker workflow", so
  nothing implicit can ever point mobile back at Docker.

## 7. Verification / smoke tests (after cutover)

- REST: anon `GET /rest/v1/events?select=id,name&status=eq.open` against cloud returns the
  seeded open events.
- Function: `registrations-checkout` reachable; returned `checkout_url` starts with the
  **cloud** functions origin (proves `PUBLIC_FUNCTIONS_URL` is set).
- Auth: sign in as `admin@racepace.test` / `password123` against cloud.
- Mobile: launch from the main checkout with `expo start -c`; confirm network requests go
  to `ytwdrsmclwghwktpupqd.supabase.co` (not `192.168.*`/`127.0.0.1`), marketplace loads,
  and a sign-in works. Web: `pnpm --filter web dev`, marketplace + admin login load.

## 8. Rollback

Cutover is env-only and reversible: restore the local `.env` values (and start the Docker
stack) to return to local. The cloud project is additive — nothing local is destroyed. If
a cloud push goes wrong, the empty project can be reset from the Dashboard and re-pushed.

## 9. Out of scope (later)

- Real PayMongo (functions still use the `fake` provider — unchanged by this migration).
- Custom domain / auth email SMTP / production hardening (rate limits, network
  restrictions), CI-based `db push`, and branching/preview environments.
- Making `seed.sql` idempotent for repeatable cloud re-seeds.
- Retiring the local Docker stack / `docker-compose.yml` (kept for offline).

## 10. Execution steps (ordered — doubles as the plan)

1. `claude mcp add --scope project --transport http supabase "https://mcp.supabase.com/mcp?project_ref=ytwdrsmclwghwktpupqd&features=…"` (writes `.mcp.json`; no secrets).
2. **[user]** `supabase login`; `supabase link --project-ref ytwdrsmclwghwktpupqd` (DB password).
3. Pre-flight: `supabase projects list` / confirm the project is empty & Postgres-compatible; `supabase db diff --linked` sanity.
4. `supabase db push` (13 migrations → cloud); verify PSGC + tables present.
5. Apply `seed.sql` to remote (search_path/extensions handling; fallback to Admin API for the admin user if needed); verify 5 orgs / 5 events / admin login.
6. `supabase functions deploy fake-checkout payments-webhook registrations-checkout`.
7. `supabase secrets set TICKET_SIGNING_SECRET=<fresh> PUBLIC_FUNCTIONS_URL=https://ytwdrsmclwghwktpupqd.supabase.co/functions/v1`.
8. Fetch cloud anon key; write mobile + web `.env` (worktree **and** main checkout); update `.env.example`; harden `sync-lan-ip.mjs`.
9. Smoke tests (§7). Commit committable changes on the branch.

## 11. File touch-list (for writing-plans)

- **new:** `.mcp.json` (project MCP config), `docs/specs/2026-07-22-supabase-cloud-migration-design.md` (this file).
- **edit (tracked):** `apps/mobile/.env.example`, `apps/web/.env.example`, `scripts/sync-lan-ip.mjs`, `docs/README.md` (roadmap note).
- **edit (untracked, local):** `apps/mobile/.env`, `apps/web/.env` (worktree + main checkout).
- **remote-only (no repo change):** migrations pushed, seed applied, functions deployed, secrets set on `ytwdrsmclwghwktpupqd`.
- **unchanged:** Edge Function source, `supabase/config.toml` (local-only), `docker-compose.yml`.
