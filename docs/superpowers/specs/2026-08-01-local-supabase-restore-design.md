# Local Supabase restore + dev container rebuild — Design Spec

**Date:** 2026-08-01
**Status:** approved, ready for implementation plan

## 1. Problem

The hosted Supabase project is disabled, and the local Docker containers that used to
serve `race-pace` were removed. Neither surface can reach a backend:

- `apps/web/.env` and `apps/mobile/.env` point at `https://ytwdrsmclwghwktpupqd.supabase.co`.
- The local Supabase containers for project `race-pace` are gone.
- The admin web container is gone.

Development is blocked until a local backend is running and both surfaces point at it.

## 2. Goal

Restore a working, fully offline-capable local development loop:

1. Local Supabase stack (Postgres, Auth, Storage, Realtime, Edge Functions) running again.
2. A populated database that makes the mobile UI worth looking at — two organizers,
   twenty events with real images, covering every lifecycle state.
3. Admin web console back at `https://admin.racepace.lan`.
4. iOS app rebuilt against the local backend and verified in the Simulator.

Reversal to hosted must stay a one-copy operation.

## 3. Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Scope of the cloud→local switch | **Untracked `.env` files only** | The cutover spec (`2026-07-22-supabase-cloud-migration-design.md` §"reversible") established the switch as env-only. Tracked defaults keep documenting hosted, so flipping back is trivial. |
| Database contents | **`db reset` + a re-runnable seeder script** | The surviving `supabase_db_race-pace` volume predates the cutover and is missing ~15 migrations. A reset guarantees schema/repo parity. |
| Test-data shape | **2 orgs × 10 events, every lifecycle state** | Muspo and RunwithPoint, each 3 completed / 3 cancelled / 1 rescheduled / 3 open. |
| Event images | **Downloaded from Unsplash into the local `event-images` bucket** | Exercises the same storage path the admin uploader writes, and renders offline once seeded. |
| Fixture packaging | **One idempotent Node script, `scripts/seed-dev-data.mjs`** | Image upload is a runtime step, so `seed.sql` alone cannot express the fixture. `seed.sql` stays untouched. |
| URL host | **`127.0.0.1` everywhere** | Preserves the HTTPS admin console (see §4). |
| iOS target | **Simulator only** | Follows from the `127.0.0.1` decision. |
| Payments | **Real PayMongo test mode** (`sk_test_…` retained) | Exercises the real checkout + `payment-verify` reconciliation path. |

## 4. The HTTPS / LAN-IP constraint

This constraint drove the URL decision and is worth recording, because it will resurface
the next time physical-device testing comes up.

The admin console is served over HTTPS (`https://admin.racepace.lan`, mkcert cert via
Traefik). Browsers exempt `http://127.0.0.1` from mixed-content blocking — it is a
"potentially trustworthy origin" per the Secure Contexts spec — which is why
`VITE_SUPABASE_URL=http://127.0.0.1:54521` worked before the cutover. `http://192.168.x.x:54521`
gets no such exemption and is blocked, for both `fetch` calls and `<img>` tags.

Event images are stored in the database as a **single absolute URL** (`events.hero_image_url`,
`events.gallery[]`). One value cannot be simultaneously LAN-IP (for a physical iPhone) and
localhost (for the HTTPS admin page).

**Resolution:** `127.0.0.1` everywhere. The admin console and the iOS Simulator both work
fully; a physical iPhone cannot reach the backend. Accepted.

Rejected alternatives:

- *LAN IP everywhere, admin over plain HTTP on a published port* — works on device, but
  gives up the HTTPS `.lan` URL and needs a Vite HMR change.
- *Split (web on localhost, mobile API on LAN IP, images on localhost)* — device loads data
  but every hero/gallery image falls back to the `ElevationHero` placeholder.
- *Supabase behind Traefik TLS at `https://supabase.racepace.lan`* — solves mixed content,
  but requires installing the mkcert root CA into the Simulator and device, and `.lan`
  DNS resolution on the phone. Too much machinery for the benefit.

## 5. Where the work happens

**The main checkout, `/Users/jsonse/Documents/development/trail-ultra` — not a worktree.**

The worktree has no `node_modules`, no `.env` files, and no `apps/mobile/ios/` (a 1.2 GB
native build that lives only in the main checkout). The Docker volumes
(`trail-ultra_repo_node_modules`, `trail-ultra_web_node_modules`, `trail-ultra_pnpm_store`)
derive their names from the main directory; running `docker compose` from a worktree would
create a second set and reinstall the whole workspace.

Implementation runs on a branch created in the main checkout.

## 6. Components

### 6.1 Local Supabase stack

```
pnpm exec supabase start        # ports 54521 (API) · 54522 (DB) · 54523 (Studio) · 54524 (Mailpit)
pnpm exec supabase db reset     # 30 migrations + seed.sql
pnpm exec supabase status -o env > .env.local
```

CLI is pinned at 2.109.1 (root `devDependencies`). The existing `supabase_db_race-pace` and
`supabase_storage_race-pace` volumes are reused; `db reset` rebuilds the database inside
them. If `start` fails on a Postgres image-version mismatch against the stale volume, the
fallback is `supabase stop --no-backup` followed by `docker volume rm supabase_db_race-pace`
and a clean start — no data is lost, since the database is being reset regardless. Volumes
belonging to other projects (`supabase_db_race-pace-a1`, `supabase_db_labaan*`, …) are not
touched.

Edge Functions need a **second terminal**. `supabase start`'s edge runtime does not read
`supabase/functions/.env`:

```
pnpm exec supabase functions serve --no-verify-jwt --env-file supabase/functions/.env
```

Without it, payments, check-in, org-members, and push all fail with "Edge Function returned
a non-2xx status code".

### 6.2 Environment files

Existing hosted values are copied to a sibling `.env.cloud.bak` before editing. `.env.*` is
already gitignored, so the backups never appear in `git status`. Flipping back to hosted is
a `cp` per file.

| File | Key | New value |
| --- | --- | --- |
| `apps/web/.env` | `VITE_SUPABASE_URL` | `http://127.0.0.1:54521` |
| | `VITE_SUPABASE_ANON_KEY` | local anon key from `supabase status -o env` |
| `apps/mobile/.env` | `EXPO_PUBLIC_SUPABASE_URL` | `http://127.0.0.1:54521` |
| | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | local anon key |
| | `EXPO_PUBLIC_PAYMONGO_PUBLIC_KEY` | unchanged |
| `supabase/functions/.env` | `PUBLIC_APP_URL` | `http://127.0.0.1:8081` |
| | `PUBLIC_FUNCTIONS_URL` | `http://127.0.0.1:54521/functions/v1` |
| | `PAYMONGO_SECRET_KEY` | unchanged — keeps real test-mode checkout, keeps `fake-checkout` returning 404 |
| | `TICKET_SIGNING_SECRET` | unchanged |

`PUBLIC_APP_URL` / `PUBLIC_FUNCTIONS_URL` currently hold a **stale** LAN IP (`192.168.68.50`;
the host is now on `192.168.68.52`), so they are wrong today regardless of this change.

No tracked file is modified by the switch. `.env.example` files, `supabase/README.md`,
`scripts/sync-lan-ip.mjs`, and the docs continue to document hosted as the default.

### 6.3 Seed fixture — `scripts/seed-dev-data.mjs`

A single idempotent Node script, run after every `db reset`. Reads `API_URL` and
`SERVICE_ROLE_KEY` from the root `.env.local`; uses the service-role key, so it bypasses RLS.

**Organizations.** Reuses the two organization ids already created by `seed.sql`, so the
`user_roles` row binding `admin@racepace.test` to org `…a1` survives:

- `…a1` → **Muspo**
- `…a2` → **RunwithPoint**
- `…a3` (Highland Endurance) deleted, cascading its events

`admin@racepace.test` is granted the `admin` role on **both** orgs so the console can manage
either.

**Events.** Ten per org, twenty total. Per org:

| Count | `status` | Extra |
| --- | --- | --- |
| 3 | `completed` | past `event_date` |
| 3 | `cancelled` | `status_note` explaining the cancellation |
| 1 | *rescheduled* | `status = 'open'`, `original_date` set to the old date, `status_note` set |
| 3 | `open` | future `event_date`, some multi-day via `end_date` |

There is deliberately **no `rescheduled` enum value** — `event_status` is
`draft·open·almost_full·closed·completed·cancelled`. The UI derives the Rescheduled badge
from `original_date` being non-null (`apps/mobile/components/StatusBadge.tsx:12`), matching
the intent recorded in `20260720110000_marketplace_fields.sql`. No migration is required.

Each event carries: `name`, `description`, `event_date` (+ `end_date` where multi-day),
`flag_off`, `elevation_gain_m`, `cutoff_hours`, `inclusions[]`, structured PSGC address
(`city_psgc_code`, `region_name`, `province_name`, `city_name`, `venue`) queried from the
seeded `psgc_*` tables for real Mindanao locations, plus legacy `place`/`region` as fallback.
Two to three `categories` per event with `distance_km`, `base_price` (integer centavos),
`slots_total`, `slots_taken`.

The seeder creates **no registrations or payments** — those are produced by hand during
verification (§7.5) so the real checkout path gets exercised.

**Images.** 24 curated Unsplash photographs (trail, mountain, ultrarunning), URL-verified
to resolve before being written into the script. Downloaded once into a gitignored cache
directory so re-runs need no network. Uploaded to `event-images/{org_id}/{uuid}.jpg` — the
same path shape the admin `EventImagesEditor` writes, satisfying the
`auth_can_admin_org((storage.foldername(name))[1])` write policy. Each event gets a distinct
hero; galleries draw from the per-org pool. Org branding (`logo_url`, `banner_url`) is
uploaded to `org-images/{org_id}/…`.

Objects under the two managed org prefixes are cleared at the start of each run so repeated
seeding does not accumulate orphans.

Resulting URLs: `http://127.0.0.1:54521/storage/v1/object/public/event-images/{org_id}/{uuid}.jpg`.

### 6.4 Admin web container

```
cd /Users/jsonse/Documents/development/trail-ultra && docker compose up -d
```

Traefik and the external `dev-net` network are already running, and the node_modules /
pnpm-store named volumes are warm, so this recreates the container rather than reinstalling
from scratch. The service binds no host port; Traefik routes `Host(admin.racepace.lan)` to
port 5173 with the mkcert `*.lan` certificate.

Login: `admin@racepace.test` / `password123` (seeded in `seed.sql`, survives `db reset`).

### 6.5 iOS rebuild

```
cd apps/mobile && pnpm exec expo run:ios
```

A full rebuild is required rather than a reload: `EXPO_PUBLIC_*` values are inlined into the
bundle at build time, and this project has no working Fast Refresh (the Simulator runs an
embedded bundle). The existing `apps/mobile/ios/` directory makes this an incremental
native build.

## 7. Verification

Each of these must be observed, not assumed:

1. `pnpm exec supabase status` — every service healthy.
2. `pnpm test` — unit, RLS, and e2e suites green against the local stack.
3. Admin console at `https://admin.racepace.lan` — login succeeds, events list shows 20
   events across the two orgs, hero images render.
4. iOS Simulator — browse list populated, event detail gallery scrolls, and all four badge
   states appear: Open, Completed, Cancelled, Rescheduled.
5. One registration driven through PayMongo test checkout (card `4343 4343 4343 4345`)
   reconciling to `paid` via `payment-verify`.

## 8. Known limitations

Accepted, not defects:

- **Webhooks cannot reach localhost.** `payments-webhook` will not fire, so refund
  reconciliation and other async transitions do not complete locally. The pay path is
  covered because `payment-verify` re-fetches the session rather than trusting the redirect.
- **Physical iPhone is out of scope** — a consequence of the `127.0.0.1` decision (§4).
- **The seeded fixture does not survive `db reset`.** Re-run `scripts/seed-dev-data.mjs`.
- **`supabase/.temp/linked-project.json` still points at the hosted project.** Harmless, but
  `supabase db push` and `supabase db query --linked` target **hosted**, not local. Use
  `--local` while in this mode.
- **The hosted project is untouched.** Nothing in this work writes to or destroys cloud state.

## 9. Out of scope

- Flipping tracked repo defaults (`.env.example`, `supabase/README.md`,
  `scripts/sync-lan-ip.mjs`, docs) back to local-first. Deliberately deferred; revisit if
  local becomes the long-term default.
- Storing storage paths instead of absolute URLs in `hero_image_url`/`gallery[]`. This is
  the correct fix for the §4 constraint, but it touches the admin uploader, both apps, and
  existing rows — a separate piece of work.
- Android. The native `apps/mobile/android/` directory exists but is not part of this task.
- Migrating hosted data down to local.
