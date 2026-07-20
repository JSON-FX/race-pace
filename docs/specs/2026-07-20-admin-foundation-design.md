# Admin Web Console — Foundation — Design Spec (Plan 09; first of the M3 admin console)

- **Status:** Approved (brainstorm 2026-07-20)
- **Owner:** Product (jayson@voltcontent.com)
- **Feeds:** superpowers:writing-plans → implementation plan
- **Relates to:** the admin screens in [2026-07-20-screen-design-brief.md](../design/2026-07-20-screen-design-brief.md) §4; PRD [00-product-overview.md](../00-product-overview.md) §4.3 (M3), §8 (roles/RLS); [ADR-0001](../adr/0001-cross-platform-tech-stack.md) (React + Vite + TS for web)

## 1. Goal

Stand up the **Admin web console** as a running, Dockerized app reachable at **`http://admin.racepace.lan`**, with the **roles foundation** the whole console depends on, an **authenticated role-adaptive shell**, and the **Events list** as the first real (read-only) org-scoped screen. This is the first vertical slice of M3 — it proves **infra → auth → role-scoped RLS → data → UI** end-to-end so the remaining admin plans (events CRUD, registrations/payments, check-in, settings, super_admin) build on a real foundation.

`apps/web/` today is just a `README.md`. The backend has **no `user_roles`** (deferred from Plan 1), so nothing can gate by role yet — this plan adds it.

## 2. Decisions (from brainstorm)

1. **First slice = Foundation + Events list** (not infra-only). Build the full vertical; the Events list (read-only) is the proof-of-data screen. Create/Edit is Plan 10.
2. **Access = this Mac only.** `admin.racepace.lan` resolves via a single **`/etc/hosts`** entry; served over plain **HTTP**. No LAN DNS (dnsmasq) and no reverse proxy this slice — Docker publishes host **`:80`** straight to the Vite dev server. (Caddy/HTTPS is added in Plan 12 when the check-in camera needs a secure context.)
3. **Stack = React + Vite + TypeScript** (ADR-0001), **React Router** + **TanStack Query** + **`supabase-js`** (browser, session in `localStorage`) — mirrors the mobile data patterns. Tests: **Vitest + React Testing Library (jsdom)**.
4. **getdesign `apple` tokens shared by value.** Web mirrors `apps/mobile/lib/theme.ts` as CSS variables so both surfaces read as one product.
5. **Roles now, but only what this slice needs.** Add `user_roles` + role-scoped read RLS (via `security definer` helpers) + a **seeded org admin** for Run With Point. Registrations/payments admin-read (for gross ₱) is **deferred to Plan 11**.
6. **Events list is org-scoped to the org admin.** The seeded account is an **org `admin`**; the app filters events by that admin's `org_id`. **super_admin** cross-org views + org switcher come with Plan 14 (the sidebar shows the super_admin items as placeholders).

## 3. Infra — Docker + `admin.racepace.lan` (Mac-only, HTTP)

**`apps/web`** — a Vite React-TS app (workspace package `web`, matching `apps/mobile`'s `mobile`). Auto-included by the existing `apps/*` workspace glob. Env in `apps/web/.env` (mirrors mobile):

```
VITE_SUPABASE_URL=http://127.0.0.1:54521
VITE_SUPABASE_ANON_KEY=<local anon key>
```

The app runs in **your Mac's browser**, so it reaches Supabase at `127.0.0.1:54521` directly — the container only serves the JS bundle.

**`docker-compose.yml`** (repo root) — one service:

```yaml
services:
  web:
    image: node:22-bookworm-slim
    working_dir: /repo
    command: sh -c "corepack enable && pnpm install --frozen-lockfile=false && pnpm --filter web dev --host 0.0.0.0"
    ports: ["80:5173"]            # host admin.racepace.lan:80 → Vite
    volumes:
      - ./:/repo                  # source, for HMR
      - repo_node_modules:/repo/node_modules          # container-owned (Linux esbuild binary)
      - web_node_modules:/repo/apps/web/node_modules
volumes:
  repo_node_modules:
  web_node_modules:
```

The **named volumes over `node_modules`** are the key detail: mounting the host repo would otherwise shadow the container's Linux `esbuild`/native binaries with macOS ones and break Vite. Root + `apps/web` node_modules stay container-owned.

**`apps/web/vite.config.ts`** must allow the custom host and make HMR + file-watching work through the port map on macOS Docker:

```ts
server: {
  host: true,                                   // listen on 0.0.0.0
  port: 5173,
  allowedHosts: ["admin.racepace.lan", "localhost"],
  hmr: { clientPort: 80 },                      // browser hits :80, not :5173
  watch: { usePolling: true },                  // bind-mount fs events don't propagate on macOS
}
```

**One-time host entry** (you run it — needs sudo; I'll provide it verbatim):

```
echo "127.0.0.1 admin.racepace.lan" | sudo tee -a /etc/hosts
```

Then `docker compose up` → open **http://admin.racepace.lan**. Host **port 80 must be free** (verified during build; if taken we surface it rather than fail silently).

## 4. Backend — `user_roles` + role-scoped RLS

**Migration** — role enum + table:

```sql
create type app_role as enum ('user','marshal','editor','admin','super_admin');

create table user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        app_role not null,
  org_id      uuid references orgs(id) on delete cascade,     -- null = platform-wide (super_admin)
  event_scope uuid references events(id) on delete cascade,   -- optional per-event narrowing (marshal)
  created_at  timestamptz not null default now(),
  unique (user_id, role, org_id, event_scope)
);
create index on user_roles(user_id);

alter table user_roles enable row level security;
create policy "user_roles_read_own" on user_roles for select using (user_id = auth.uid());
-- no client writes; roles are provisioned (seed now, super_admin flow in Plan 14)
```

**Helper functions** (`security definer` → check only the caller's own rows, no RLS recursion into `user_roles` from other policies):

```sql
create or replace function auth_is_super_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from user_roles where user_id = auth.uid() and role = 'super_admin');
$$;

create or replace function auth_can_admin_org(target uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select auth_is_super_admin()
      or exists (select 1 from user_roles
                 where user_id = auth.uid() and org_id = target and role in ('editor','admin'));
$$;
```

**Additive admin-read policies** (RLS policies are OR'd, so these *widen* visibility for admins without touching the public ones). Org admins/editors — and super_admins — can read **all** their org's `events` **and** `categories`, **including `draft`** (the public `events_read_published` only exposes `status <> 'draft'`):

```sql
create policy "events_read_org_admin" on events for select
  using (auth_can_admin_org(org_id));

create policy "categories_read_org_admin" on categories for select
  using (auth_can_admin_org((select e.org_id from events e where e.id = categories.event_id)));
```

**Seed a dev admin that survives `db reset`** (`supabase/seed.sql`): insert one **email-confirmed** `auth.users` row + its `identities` row (email provider) with `encrypted_password = crypt('password123', gen_salt('bf'))`, then a `user_roles` row `(role='admin', org_id='…a1')` for **Run With Point**. Credentials: **`admin@runwithpoint.test` / `password123`** (exact `auth.users`/`identities` column list is a plan detail; follows the standard local-GoTrue seed pattern). This is separate from the runner sign-up flow (admins are provisioned; no self-signup on web).

## 5. Frontend — app, auth, shell

**Structure** (`apps/web/src/`):

```
main.tsx                 React root + Router + QueryClientProvider + AuthProvider
lib/supabase.ts          browser client (VITE_* env, localStorage session)
lib/auth.tsx             AuthProvider (session) + useAuth()  { session, signIn, signOut }
lib/roles.ts             useMyRoles() → { loading, role, orgId, isSuperAdmin, isAdmin }
lib/events.ts            useOrgEvents(orgId) → TanStack Query over supabase-js
theme.css                apple tokens as CSS variables (§7)
components/Sidebar.tsx    role-adaptive nav
components/TopBar.tsx     org name + user menu (sign out)
components/AppShell.tsx   sidebar + top bar + <Outlet/>
routes/Login.tsx         email + password (no self-signup)
routes/Events.tsx        the first real screen (§6)
routes/Placeholder.tsx   "Coming soon" for the not-yet-built sidebar destinations
routes/NoAccess.tsx      signed in but lacks an admin/editor/super_admin role
```

**Auth + guard:**
- `AuthProvider` reads `supabase.auth.getSession()` and subscribes to `onAuthStateChange`.
- A **`RequireAdmin`** route wrapper: no session → redirect `/login`; session but `useMyRoles()` resolves to no `editor|admin|super_admin` → `/no-access`; otherwise render the shell.
- `useMyRoles()` queries `user_roles` for `auth.uid()` (RLS returns own rows), reducing to `{ role, orgId, isSuperAdmin }`. Cached with TanStack Query.

**Shell / sidebar (role-adaptive):**
- **Org admin:** Dashboard · Events · Registrations · Payments · Check-in · Settings.
- **super_admin:** the above **plus** Organizations · Commission · Payouts.
- In this slice only **Events** routes to a real screen; every other item renders `Placeholder` ("Coming soon"). Active-item tint = Action accent from tokens.
- **TopBar:** the admin's org name (from `orgs` by `orgId`) + a user menu with **Sign out**.

## 6. Events list — the first screen

`routes/Events.tsx` renders a table of **the admin's org** events (`useOrgEvents(orgId)` → `select … from events where org_id = :orgId order by event_date`; RLS additionally guarantees draft visibility for that org). Columns:

| Column | Source |
| --- | --- |
| Name | `events.name` |
| Date | `events.event_date` (+ "Rescheduled — was …" when `original_date` set) |
| Status | pill from `events.status` (`draft` shown too — this is the admin view) |
| Categories | count of the event's `categories` |
| Fill | Σ `categories.slots_taken` / Σ `slots_total` |

- **Read-only** (no create/edit — Plan 10). A disabled/absent "Create event" affordance is fine; do not wire it.
- **Gross ₱ is deferred** (needs registrations/payments admin-read → Plan 11) — omit the column here rather than fake it.
- **States:** loading (skeleton rows), empty ("No events yet"), error (message + retry) — per the design brief's cross-cutting rules.
- Status color language mirrors mobile: open = ink/neutral, almost_full = amber, cancelled = danger, rescheduled = info/Action-Blue, draft = muted/parchment.

## 7. Design tokens (apple, shared look)

`apps/web/src/theme.css` defines CSS variables mirroring `apps/mobile/lib/theme.ts` **by value** (single source is the mobile palette; web restates it as CSS): `--primary`, `--primary-focus`, `--forest`, `--ink`, `--ink-muted`, `--canvas`, `--parchment`, `--hairline`, `--danger`, `--amber`, `--info`, radii, spacing. Components style from these variables only — no ad-hoc hex. (Hoisting the palette into `packages/shared` as framework-neutral constants is a **future** cleanup, not this slice.)

## 8. Edge cases & error handling

| Case | Behavior |
| --- | --- |
| Not signed in | `RequireAdmin` → `/login` |
| Signed in, no admin role (e.g. a runner account) | `/no-access` (with sign-out) — the same Supabase project serves runners |
| super_admin logs in | Sidebar shows platform items; **Events screen** is org-scoped, so it shows an "org switcher coming in a later step" empty/notice (full cross-org is Plan 14) |
| Org has zero events | Empty state on the Events list |
| Draft event | Visible to its org admin (new RLS); still hidden from the public marketplace |
| Supabase down / query error | Error state + retry (no offline story for admin — unlike the runner app) |
| Host port 80 busy | Surfaced at `docker compose up`; document the conflict rather than fail opaquely |
| `/etc/hosts` entry missing | `admin.racepace.lan` won't resolve — README + plan call out the one-time `sudo` step |
| `db reset` | Re-applies the seeded admin (it lives in `seed.sql`), so login keeps working |

## 9. Testing

- **Web (Vitest + RTL, jsdom)** — `apps/web/vitest.config.ts` (jsdom env; the root Vitest keeps owning `packages/**` + `supabase/**` and must not glob `apps/web`):
  - Auth guard: no session → redirects to Login; session without an admin role → NoAccess; admin → shell.
  - Sidebar adapts: org admin sees 6 items; super_admin sees 9 (mock `useMyRoles`).
  - Events list: renders rows from mocked `useOrgEvents`; loading / empty / error states.
  - (Supabase + role/query hooks mocked, like the mobile jest suites.)
- **Backend (root Vitest, live local stack)** — mirrors the existing `supabase/tests` style:
  - `user_roles` RLS: a signed-in user reads **only** their own role rows.
  - `auth_can_admin_org` / `events_read_org_admin`: the seeded RWP admin can read RWP's **draft** events; an anon client cannot; the admin does **not** gain write access.
  - Seed sanity: the `admin@runwithpoint.test` user exists, is email-confirmed, and has an `admin` role on `…a1`.

## 10. Out of scope (later admin plans)

- **Events create/edit**, categories/add-ons editors, reschedule/cancel, custom-fields editor, image upload → **Plan 10**.
- **Registrations** table/detail, **Payments**, admin **refunds**, and therefore **gross ₱** on the events list → **Plan 11**.
- **Check-in** QR scanner (needs HTTPS at the hostname → add Caddy/TLS then) → **Plan 12**.
- **Settings** (org profile edit) + **Dashboard** KPIs/charts → **Plan 13**.
- **super_admin**: Organizations + provisioning, Commission, Payout statements, and the **org switcher** → **Plan 14**.
- LAN-wide access (dnsmasq), production build image, CI for the web app.

## 11. File touch-list (for writing-plans)

- **Create (infra):** `apps/web/` Vite React-TS app (`package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/**`) · `apps/web/.env` + `.env.example` · `apps/web/vitest.config.ts` · root `docker-compose.yml`.
- **Create (backend):** migration `user_roles` + `app_role` enum + RLS + helper functions (`auth_is_super_admin`, `auth_can_admin_org`) + admin-read policies on `events`/`categories`.
- **Modify (backend):** `supabase/seed.sql` (seed the confirmed admin `auth.users` + `identities` + `user_roles` row).
- **Create (frontend):** `src/lib/{supabase,auth,roles,events}.ts(x)` · `src/theme.css` · `src/components/{AppShell,Sidebar,TopBar}.tsx` · `src/routes/{Login,Events,Placeholder,NoAccess}.tsx` · `src/main.tsx`.
- **Modify:** `apps/web/README.md` (run instructions incl. the `/etc/hosts` step) · possibly `pnpm-workspace.yaml` only if it doesn't already glob `apps/*`.
- **Tests:** web — auth guard, sidebar role adaptation, events list states · backend — `user_roles` RLS, admin draft-events read, seed sanity.
- **Docs:** add Plan 09 to `docs/plans/`; update the `docs/README.md` roadmap (which is stale — still says "Plan 4 to write").
