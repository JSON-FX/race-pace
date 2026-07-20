# Admin Web Console — Foundation — Implementation Plan (Plan 09; first of M3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Admin web console as a Dockerized app at **`https://admin.racepace.lan`** (behind the machine's existing Traefik/dnsmasq `.lan` setup) with the deferred **`user_roles`** roles foundation, a **role-adaptive authenticated shell**, and a read-only **org-scoped Events list** — proving infra → auth → role-scoped RLS → data → UI end-to-end.

**Architecture:** A new Vite + React + TS app in `apps/web`, run by a Docker service that joins the machine's existing external **`dev-net`** and is exposed by the shared **Traefik** proxy via labels (`Host(admin.racepace.lan)`, http→https redirect, `tls=true`, `loadbalancer.server.port=5173`) — no host-port bind, dnsmasq resolves the name. Auth + data go through `supabase-js` in the browser against the local Supabase stack; role gating rests on a new `user_roles` table with `security definer` helper functions and **additive** admin-read RLS policies that let an org admin see their org's draft events. The seeded admin (`admin@runwithpoint.test`) survives `db reset`.

**Tech Stack:** Vite, React 19, React Router v6, `@tanstack/react-query` v5, `@supabase/supabase-js` v2, TypeScript 6, Vitest + `@testing-library/react` (jsdom), Docker Compose, Supabase (Postgres migrations + seed), root Vitest (backend, against the live local stack).

## Global Constraints

- **Access is this Mac only, via the existing dnsmasq + Traefik infra.** dnsmasq already resolves `*.lan` → `127.0.0.1` (**no `/etc/hosts` entry**). The `web` container joins the external **`dev-net`** and carries **Traefik labels** routing `Host(admin.racepace.lan)` — http→https redirect, `tls=true`, `loadbalancer.server.port=5173` — binding **no host port**. Served over **HTTPS** at **`https://admin.racepace.lan`** using Traefik's default mkcert `*.lan` cert (mirror `runwithpoint.lan`'s label pattern). The shared Traefik infra on `dev-net` (`/Users/jsonse/Documents/development/infra`) must be running.
- **The org table is `organizations`** (not `orgs`). Run With Point id = **`00000000-0000-0000-0000-0000000000a1`**.
- **Roles:** `app_role` enum = `user`, `marshal`, `editor`, `admin`, `super_admin`. `user_roles.org_id` null = platform-wide (super_admin). Users read **only their own** role rows; **no client writes** (roles are provisioned).
- **Admin-read RLS is additive** — new policies widen visibility (RLS policies OR together); never weaken `events_read_published` / `categories_read_published`.
- **Seeded dev admin:** `admin@runwithpoint.test` / `password123`, role `admin` on Run With Point — lives in `seed.sql` so it survives `db reset`.
- **Design tokens** mirror `apps/mobile/lib/theme.ts` **by value** as CSS variables (primary `#159A55`, forest `#0F2A20`, ink `#1D1D1F`, ink-muted `#7A7A7A`, canvas `#ffffff`, parchment `#F5F5F7`, hairline `#E0E0E0`, danger `#FF3B30`, amber `#B45309`, info `#0066CC`). No ad-hoc hex in components.
- **Events list is read-only and org-scoped.** Filter by the admin's `org_id`. **Gross ₱ is omitted** (needs Plan 11's registration/payment access). **super_admin** cross-org views + org switcher are **Plan 14** (sidebar shows the platform items as "Coming soon").
- **Money is integer centavos** everywhere (relevant to later plans).
- **Node 20** (`.nvmrc`), **pnpm 9.7.0** (`packageManager`). Web tests run via `cd apps/web && pnpm test`; backend tests via root `pnpm test` (needs `supabase start` — the Edge Functions `functions serve` is **not** needed for these RLS/auth tests).
- **Env, never hard-coded:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` in `apps/web/.env`.

## File Structure

```
docker-compose.yml                         NEW — web service on dev-net + Traefik labels (admin.racepace.lan)
supabase/
├── migrations/
│   └── 20260720150000_user_roles.sql      NEW — app_role enum, user_roles, RLS, helpers, admin-read policies
├── seed.sql                               MODIFY — append the provisioned admin (auth.users + identities + user_roles)
└── tests/
    └── admin-roles.test.ts                NEW — user_roles RLS, admin draft-read, seed sanity (root Vitest)
apps/web/
├── package.json                           NEW — deps + scripts (dev/build/test/typecheck)
├── index.html                             NEW
├── vite.config.ts                         NEW — react plugin + server (host/allowedHosts/hmr) + vitest (jsdom)
├── tsconfig.json                          NEW — extends ../../tsconfig.base.json, jsx react-jsx
├── vitest.setup.ts                        NEW — @testing-library/jest-dom
├── .env / .env.example                    NEW — VITE_SUPABASE_URL / _ANON_KEY
├── README.md                              MODIFY — run instructions (Traefik/dev-net; no /etc/hosts)
└── src/
    ├── main.tsx                           NEW — root render: providers + <App/>
    ├── App.tsx                            NEW — <BrowserRouter> + <Routes> + guard
    ├── theme.css                          NEW — apple tokens as CSS variables
    ├── lib/
    │   ├── supabase.ts                    NEW — browser client
    │   ├── auth.tsx                        NEW — AuthProvider / useAuth
    │   ├── roles.ts                        NEW — useMyRoles()
    │   └── events.ts                       NEW — useOrgEvents()
    ├── components/
    │   ├── AppShell.tsx                    NEW — sidebar + topbar + <Outlet/>
    │   ├── Sidebar.tsx                     NEW — role-adaptive nav
    │   └── TopBar.tsx                      NEW — org name + sign out
    └── routes/
        ├── Login.tsx                       NEW
        ├── Events.tsx                      NEW — the first real screen
        ├── Placeholder.tsx                 NEW — "Coming soon"
        └── NoAccess.tsx                    NEW
```

---

## Task 1: Backend — `user_roles`, enum, own-read RLS, helper functions

**Files:**
- Create: `supabase/migrations/20260720150000_user_roles.sql`
- Test: `supabase/tests/admin-roles.test.ts`

**Interfaces:**
- Produces (SQL): type `app_role`; table `user_roles(id, user_id, role, org_id, event_scope, created_at)`; policy `user_roles_read_own`; functions `auth_is_super_admin() → boolean`, `auth_can_admin_org(uuid) → boolean`.

- [ ] **Step 1: Write the migration** — `supabase/migrations/20260720150000_user_roles.sql`:

```sql
-- Roles foundation for the admin console (deferred from Plan 1).
create type app_role as enum ('user','marshal','editor','admin','super_admin');

create table user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        app_role not null,
  org_id      uuid references organizations(id) on delete cascade,   -- null = platform-wide (super_admin)
  event_scope uuid references events(id) on delete cascade,          -- optional per-event narrowing
  created_at  timestamptz not null default now(),
  unique (user_id, role, org_id, event_scope)
);
create index on user_roles(user_id);

alter table user_roles enable row level security;
-- Users read only their own role rows; there are no client write policies (roles are provisioned).
create policy "user_roles_read_own" on user_roles
  for select using (user_id = auth.uid());

-- security definer: these check ONLY the caller's own rows, so they don't need a
-- user_roles select policy to fire inside other tables' policies, and never recurse.
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

- [ ] **Step 2: Apply + verify the table exists**

Run: `pnpm exec supabase db reset` (rebuilds from migrations + seed).
Expected: completes with no error; `docker exec supabase_db_race-pace psql -U postgres -c "\d user_roles"` shows the table. (Container name from `pnpm exec supabase status` if it differs.)

- [ ] **Step 3: Write the failing test** — `supabase/tests/admin-roles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey } = loadEnv();
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });
const service = () => createClient(url, serviceKey, { auth: { persistSession: false } });
const authed = (token: string) =>
  createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });

async function makeUser(email: string) {
  const svc = service();
  const created = await svc.auth.admin.createUser({ email, password: "password123", email_confirm: true });
  const signedIn = await anon().auth.signInWithPassword({ email, password: "password123" });
  return { id: created.data.user!.id, token: signedIn.data.session!.access_token };
}
const RWP = "00000000-0000-0000-0000-0000000000a1";

describe("user_roles RLS", () => {
  it("a user reads only their own role rows", async () => {
    const svc = service();
    const alice = await makeUser(`ur_alice_${Date.now()}@test.dev`);
    const bob = await makeUser(`ur_bob_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert([
      { user_id: alice.id, role: "admin", org_id: RWP },
      { user_id: bob.id, role: "admin", org_id: RWP },
    ]);

    const { data } = await authed(alice.token).from("user_roles").select("user_id, role");
    expect(data).toEqual([{ user_id: alice.id, role: "admin" }]);

    await svc.from("user_roles").delete().in("user_id", [alice.id, bob.id]);
  });
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- admin-roles` (repo root; `supabase start` must be up).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260720150000_user_roles.sql supabase/tests/admin-roles.test.ts
git commit -m "feat(admin): user_roles table + own-read RLS + role helpers"
```

---

## Task 2: Backend — admin-read policies on `events` + `categories`

**Files:**
- Modify: `supabase/migrations/20260720150000_user_roles.sql` (append the two policies)
- Test: `supabase/tests/admin-roles.test.ts` (append a describe)

**Interfaces:**
- Consumes: `auth_can_admin_org(uuid)` (Task 1).
- Produces (SQL): policies `events_read_org_admin`, `categories_read_org_admin`.

- [ ] **Step 1: Append the additive admin-read policies** to `supabase/migrations/20260720150000_user_roles.sql`:

```sql
-- Additive: org admins/editors (and super_admins) read ALL their org's events +
-- categories, INCLUDING draft. RLS policies are OR'd, so the public
-- events_read_published / categories_read_published still apply for everyone else.
create policy "events_read_org_admin" on events for select
  using (auth_can_admin_org(org_id));

create policy "categories_read_org_admin" on categories for select
  using (auth_can_admin_org((select e.org_id from events e where e.id = categories.event_id)));
```

- [ ] **Step 2: Apply**

Run: `pnpm exec supabase db reset`.
Expected: no error.

- [ ] **Step 3: Write the failing test** — append to `supabase/tests/admin-roles.test.ts`:

```ts
describe("admin draft-event read", () => {
  it("an org admin reads their org's draft event; anon cannot; admin can't write", async () => {
    const svc = service();
    const draft = await svc.from("events")
      .insert({ org_id: RWP, name: `Draft ${Date.now()}`, status: "draft" }).select().single();
    const cat = await svc.from("categories")
      .insert({ org_id: RWP, event_id: draft.data!.id, code: "21k", label: "21K", base_price: 150000, slots_total: 50 })
      .select().single();

    const admin = await makeUser(`adm_${Date.now()}@test.dev`);
    await svc.from("user_roles").insert({ user_id: admin.id, role: "admin", org_id: RWP });

    // admin sees the draft event + its categories
    const seen = await authed(admin.token).from("events").select("id,status").eq("id", draft.data!.id);
    expect(seen.data).toEqual([{ id: draft.data!.id, status: "draft" }]);
    const cats = await authed(admin.token).from("categories").select("id").eq("event_id", draft.data!.id);
    expect(cats.data).toEqual([{ id: cat.data!.id }]);

    // anon cannot see the draft
    const anonSeen = await anon().from("events").select("id").eq("id", draft.data!.id);
    expect(anonSeen.data).toEqual([]);

    // read-only: admin cannot update the event (no write policy)
    const upd = await authed(admin.token).from("events").update({ name: "hacked" }).eq("id", draft.data!.id).select();
    expect(upd.data ?? []).toEqual([]);

    await svc.from("user_roles").delete().eq("user_id", admin.id);
    await svc.from("categories").delete().eq("id", cat.data!.id);
    await svc.from("events").delete().eq("id", draft.data!.id);
  });
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- admin-roles`.
Expected: PASS (both describes).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260720150000_user_roles.sql supabase/tests/admin-roles.test.ts
git commit -m "feat(admin): additive admin-read RLS for org draft events + categories"
```

---

## Task 3: Backend — seed the provisioned dev admin

**Files:**
- Modify: `supabase/seed.sql` (append at the end — after organizations exist)
- Test: `supabase/tests/admin-roles.test.ts` (append a describe)

**Interfaces:**
- Produces: an email-confirmed `auth.users` row `admin@runwithpoint.test` (id `…b1`) + `auth.identities` row + a `user_roles` row (`admin`, org `…a1`).

- [ ] **Step 1: Append the seed** to the end of `supabase/seed.sql`:

```sql
-- Provisioned admin for the web console (survives db reset). Password: password123
-- crypt()/gen_salt() come from pgcrypto (installed in Supabase local). If they error,
-- prefix with extensions. (i.e. extensions.crypt / extensions.gen_salt).
do $$
declare admin_id uuid := '00000000-0000-0000-0000-0000000000b1';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', admin_id, 'authenticated', 'authenticated',
    'admin@runwithpoint.test', crypt('password123', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), admin_id, admin_id::text,
    jsonb_build_object('sub', admin_id::text, 'email', 'admin@runwithpoint.test', 'email_verified', true),
    'email', now(), now(), now()
  );

  insert into user_roles (user_id, role, org_id)
  values (admin_id, 'admin', '00000000-0000-0000-0000-0000000000a1');
end $$;
```

- [ ] **Step 2: Apply + spot-check login manually**

Run: `pnpm exec supabase db reset`, then:
```bash
ANON=$(grep -E "^EXPO_PUBLIC_SUPABASE_ANON_KEY=" apps/mobile/.env | cut -d= -f2-)
curl -s -X POST "http://127.0.0.1:54521/auth/v1/token?grant_type=password" \
  -H "apikey: $ANON" -H 'Content-Type: application/json' \
  -d '{"email":"admin@runwithpoint.test","password":"password123"}' | grep -q access_token && echo OK
```
Expected: `OK`. (If it fails with a `crypt` error, change `crypt`/`gen_salt` to `extensions.crypt`/`extensions.gen_salt` and re-reset.)

- [ ] **Step 3: Write the failing test** — append to `supabase/tests/admin-roles.test.ts`:

```ts
describe("seeded admin", () => {
  it("admin@runwithpoint.test signs in and holds admin on Run With Point", async () => {
    const signedIn = await anon().auth.signInWithPassword({
      email: "admin@runwithpoint.test", password: "password123",
    });
    expect(signedIn.error).toBeNull();
    const token = signedIn.data.session!.access_token;
    const { data } = await authed(token).from("user_roles").select("role, org_id");
    expect(data).toEqual([{ role: "admin", org_id: RWP }]);
  });
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- admin-roles`.
Expected: PASS (all three describes).

- [ ] **Step 5: Commit**

```bash
git add supabase/seed.sql supabase/tests/admin-roles.test.ts
git commit -m "feat(admin): seed provisioned admin (survives db reset)"
```

---

## Task 4: Web app scaffold + Docker + `admin.racepace.lan`

**Files:**
- Create: `apps/web/package.json`, `apps/web/index.html`, `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/vitest.setup.ts`, `apps/web/.env`, `apps/web/.env.example`, `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/routes/Placeholder.tsx`, `apps/web/src/theme.css`, `apps/web/src/__tests__/smoke.test.tsx`, `docker-compose.yml`
- Modify: `apps/web/README.md`

**Interfaces:**
- Produces: a running app at `https://admin.racepace.lan` (via Traefik on `dev-net`); `<Placeholder title/>` component; the `web` workspace package with `dev`/`build`/`test`/`typecheck` scripts.

- [ ] **Step 1: `apps/web/package.json`**

```json
{
  "name": "web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.110.7",
    "@tanstack/react-query": "^5.101.2",
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "react-router-dom": "^6.28.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "typescript": "^6.0.3",
    "vite": "^6.0.0",
    "vitest": "^4.1.10"
  }
}
```

- [ ] **Step 2: `apps/web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Race Pace Admin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: `apps/web/vite.config.ts`** (server config for the `.lan` host + Docker HMR, plus the jsdom test config)

```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,                                    // listen on 0.0.0.0 (Docker)
    port: 5173,
    allowedHosts: ["admin.racepace.lan", "localhost"],
    hmr: { protocol: "wss", host: "admin.racepace.lan", clientPort: 443 }, // HMR over Traefik TLS
    watch: { usePolling: true },                   // macOS bind-mount fs events don't propagate
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

- [ ] **Step 4: `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "types": ["vite/client", "vitest/globals"],
    "noEmit": true
  },
  "include": ["src", "vite.config.ts", "vitest.setup.ts"]
}
```

- [ ] **Step 5: `apps/web/vitest.setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 6: env files** — `apps/web/.env` and `apps/web/.env.example` (same content; the anon key is the shared local dev key from `apps/mobile/.env`):

```
VITE_SUPABASE_URL=http://127.0.0.1:54521
VITE_SUPABASE_ANON_KEY=<copy EXPO_PUBLIC_SUPABASE_ANON_KEY from apps/mobile/.env>
```

- [ ] **Step 7: `apps/web/src/theme.css`** (apple tokens as CSS variables + base reset)

```css
:root {
  --primary: #159A55; --primary-focus: #0F7A42; --forest: #0F2A20;
  --ink: #1D1D1F; --ink-muted: #7A7A7A; --ink-subtle: #8A8A8E;
  --canvas: #ffffff; --parchment: #F5F5F7; --hairline: #E0E0E0; --divider: #EFEFF1;
  --danger: #FF3B30; --amber: #B45309; --info: #0066CC;
  --radius: 11px; --radius-pill: 9999px;
}
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
  color: var(--ink); background: var(--parchment);
}
```

- [ ] **Step 8: `apps/web/src/routes/Placeholder.tsx`**

```tsx
export function Placeholder({ title }: { title: string }) {
  return (
    <div style={{ padding: 32 }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--ink)" }}>{title}</h1>
      <p style={{ color: "var(--ink-muted)" }}>Coming soon.</p>
    </div>
  );
}
```

- [ ] **Step 9: `apps/web/src/App.tsx`** (minimal for now — the guard/shell/routes arrive in Tasks 5–7)

```tsx
import { Placeholder } from "./routes/Placeholder";

export function App() {
  return <Placeholder title="Race Pace Admin" />;
}
```

- [ ] **Step 10: `apps/web/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 11: `docker-compose.yml`** (repo root)

```yaml
services:
  web:
    image: node:20-bookworm-slim
    working_dir: /repo
    command: sh -c "corepack enable && corepack prepare pnpm@9.7.0 --activate && pnpm install --frozen-lockfile=false && pnpm --filter web dev --host 0.0.0.0"
    networks: [dev-net]
    labels:
      - "traefik.enable=true"
      # http :80 -> https redirect
      - "traefik.http.routers.racepace-admin-http.entrypoints=web"
      - "traefik.http.routers.racepace-admin-http.rule=Host(`admin.racepace.lan`)"
      - "traefik.http.routers.racepace-admin-http.middlewares=racepace-admin-redirect"
      - "traefik.http.middlewares.racepace-admin-redirect.redirectscheme.scheme=https"
      - "traefik.http.middlewares.racepace-admin-redirect.redirectscheme.permanent=true"
      # https :443 (Traefik's default mkcert *.lan cert)
      - "traefik.http.routers.racepace-admin.entrypoints=websecure"
      - "traefik.http.routers.racepace-admin.rule=Host(`admin.racepace.lan`)"
      - "traefik.http.routers.racepace-admin.tls=true"
      - "traefik.http.services.racepace-admin.loadbalancer.server.port=5173"
    volumes:
      - ./:/repo
      - repo_node_modules:/repo/node_modules
      - web_node_modules:/repo/apps/web/node_modules
networks:
  dev-net:
    external: true
volumes:
  repo_node_modules:
  web_node_modules:
```

The `web` container binds no host port — Traefik (already on `dev-net`, port 80/443) discovers it by label and proxies `admin.racepace.lan` to the container's `:5173`. `exposedByDefault` is false in this Traefik, so `traefik.enable=true` is required. This mirrors the existing `runwithpoint.lan` service.

- [ ] **Step 12: `apps/web/README.md`** — replace with run instructions:

```markdown
# Race Pace — Admin web console

Vite + React + TypeScript. Runs in Docker behind the shared Traefik proxy at
**https://admin.racepace.lan** (this Mac). dnsmasq resolves `*.lan`; Traefik
serves it with the mkcert `*.lan` cert — same convention as the other `.lan` sites.

## First-time setup
1. Bring up the shared infra (Traefik on `dev-net`): in `/Users/jsonse/Documents/development/infra` → `docker compose up -d`. And the Supabase stack: `pnpm exec supabase start`.
2. From this repo root: `docker compose up` (first run installs the workspace in-container — slow once).
3. Open **https://admin.racepace.lan** — no `/etc/hosts` needed (dnsmasq handles `.lan`), cert is locally trusted (mkcert).

## Local dev without Docker
`pnpm --filter web dev` → http://localhost:5173

## Tests / types
`cd apps/web && pnpm test` · `pnpm typecheck`
```

- [ ] **Step 13: Install on the host + write the smoke test**

Run (repo root): `pnpm install` (adds the `web` package + deps to the workspace; needed for host-side tests/typecheck).
Then `apps/web/src/__tests__/smoke.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { App } from "../App";

it("renders the admin app title", () => {
  render(<App />);
  expect(screen.getByText("Race Pace Admin")).toBeInTheDocument();
});
```

- [ ] **Step 14: Run the smoke test**

Run: `cd apps/web && pnpm test`.
Expected: PASS (1 test). Then `pnpm typecheck` → exit 0.

- [ ] **Step 15: Bring it up in Docker + verify the `.lan` URL**

Ensure the shared Traefik infra is up (`/Users/jsonse/Documents/development/infra` → `docker compose up -d`) and `supabase start` is running, then from this repo root:
```bash
docker compose up -d
# first run installs the whole workspace in-container — watch until Vite is ready:
docker compose logs -f web   # wait for "VITE vX ready" / "Local: http://localhost:5173/", then Ctrl-C
curl -s https://admin.racepace.lan | grep -q 'id="root"' && echo "SERVING"
```
Expected: `SERVING` (Vite's index HTML with `#root`, via Traefik TLS). Open **https://admin.racepace.lan** in a browser → "Race Pace Admin / Coming soon"; the mkcert `*.lan` cert is locally trusted (no warning). If `curl` doesn't trust the cert in your shell, `curl -sk https://admin.racepace.lan` confirms serving (the browser still trusts it). If the route doesn't resolve in Traefik, check `docker compose logs web`, that the container joined `dev-net`, and that `traefik.enable=true` is set.

- [ ] **Step 16: Commit**

```bash
git add apps/web docker-compose.yml pnpm-lock.yaml
git commit -m "feat(admin): scaffold Vite web app + Docker at admin.racepace.lan"
```

---

## Task 5: Supabase client + auth (Login + session + guard)

**Files:**
- Create: `apps/web/src/lib/supabase.ts`, `apps/web/src/lib/auth.tsx`, `apps/web/src/routes/Login.tsx`, `apps/web/src/routes/NoAccess.tsx`
- Modify: `apps/web/src/main.tsx` (providers + router), `apps/web/src/App.tsx` (routes + guard)
- Test: `apps/web/src/__tests__/auth.test.tsx`

**Interfaces:**
- Produces: `supabase` client; `AuthProvider`, `useAuth() → { session, loading, signIn, signOut }`; `<Login/>`, `<NoAccess/>`; a `<RequireAdmin>` guard in `App.tsx`.
- Consumes: `useMyRoles()` is added in Task 6 — for THIS task the guard treats "any signed-in session" as allowed; Task 6 tightens it to require an admin role. (Explicitly noted so the guard's shape is stable.)

- [ ] **Step 1: `apps/web/src/lib/supabase.ts`**

```ts
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true, storage: window.localStorage },
});
```

- [ ] **Step 2: `apps/web/src/lib/auth.tsx`**

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

type AuthValue = {
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn: AuthValue["signIn"] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { error: error.message } : {};
  };
  const signOut = async () => { await supabase.auth.signOut(); };

  return <AuthContext.Provider value={{ session, loading, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
```

- [ ] **Step 3: `apps/web/src/routes/Login.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";

export function Login() {
  const { signIn, session } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (session) nav("/", { replace: true }); }, [session, nav]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await signIn(email.trim(), password);
    setBusy(false);
    if (error) setError(error); else nav("/", { replace: true });
  }

  return (
    <div style={{ minHeight: "100%", display: "grid", placeItems: "center" }}>
      <form onSubmit={onSubmit} style={{ width: 340, background: "var(--canvas)", padding: 28, borderRadius: 14, border: "1px solid var(--hairline)", display: "grid", gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Sign in</h1>
        <input aria-label="Email" placeholder="Email" type="email" autoCapitalize="none" value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
        <input aria-label="Password" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} style={inputStyle} />
        {error ? <p style={{ color: "var(--danger)", margin: 0, fontSize: 14 }}>{error}</p> : null}
        <button type="submit" disabled={busy} style={btnStyle}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>
    </div>
  );
}
const inputStyle = { border: "1px solid var(--hairline)", borderRadius: "var(--radius)", padding: 12, fontSize: 15 } as const;
const btnStyle = { background: "var(--primary)", color: "#fff", border: 0, borderRadius: "var(--radius-pill)", padding: "12px 16px", fontSize: 15, fontWeight: 600, cursor: "pointer" } as const;
```

- [ ] **Step 4: `apps/web/src/routes/NoAccess.tsx`**

```tsx
import { useAuth } from "../lib/auth";

export function NoAccess() {
  const { signOut } = useAuth();
  return (
    <div style={{ minHeight: "100%", display: "grid", placeItems: "center", textAlign: "center" }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>No admin access</h1>
        <p style={{ color: "var(--ink-muted)" }}>This account isn't an organizer on Race Pace.</p>
        <button onClick={() => signOut()} style={{ marginTop: 8 }}>Sign out</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: `apps/web/src/App.tsx`** (router + guard; the guard requires only a session for now — Task 6 tightens it)

```tsx
import { BrowserRouter, Routes, Route, Navigate, type PropsWithChildren } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { Login } from "./routes/Login";
import { NoAccess } from "./routes/NoAccess";
import { Placeholder } from "./routes/Placeholder";

function RequireAdmin({ children }: PropsWithChildren) {
  const { session, loading } = useAuth();
  if (loading) return <div style={{ padding: 32 }}>Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/no-access" element={<NoAccess />} />
        <Route path="/" element={<RequireAdmin><Placeholder title="Race Pace Admin" /></RequireAdmin>} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 6: `apps/web/src/main.tsx`** — wrap in providers:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./lib/auth";
import { App } from "./App";
import "./theme.css";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>
);
```

- [ ] **Step 7: Update the smoke test** — the app now redirects `/` → `/login` (no session in jsdom). Replace `apps/web/src/__tests__/smoke.test.tsx` body so it still asserts a stable element:

```tsx
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "../lib/auth";
import { App } from "../App";

it("unauthenticated visitor lands on the sign-in form", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider><App /></AuthProvider>
    </QueryClientProvider>
  );
  expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
});
```

- [ ] **Step 8: Write the failing test** — `apps/web/src/__tests__/auth.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Login } from "../routes/Login";

const mockSignIn = vi.fn();
vi.mock("../lib/auth", () => ({ useAuth: () => ({ signIn: mockSignIn, session: null }) }));

it("shows the error returned by signIn", async () => {
  mockSignIn.mockResolvedValue({ error: "Invalid login credentials" });
  render(<MemoryRouter><Login /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "x@test.dev" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(screen.getByText("Invalid login credentials")).toBeInTheDocument());
});
```

- [ ] **Step 9: Run to verify both pass**

Run: `cd apps/web && pnpm test`.
Expected: PASS (smoke + auth). Then `pnpm typecheck` → 0.

- [ ] **Step 10: Manual check (optional but recommended)**

With `docker compose up` running, open https://admin.racepace.lan → redirected to the sign-in form; signing in with `admin@runwithpoint.test` / `password123` lands on the "Race Pace Admin" placeholder.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src
git commit -m "feat(admin): supabase client + auth (login, session, route guard)"
```

---

## Task 6: Roles hook + role-adaptive shell

**Files:**
- Create: `apps/web/src/lib/roles.ts`, `apps/web/src/components/AppShell.tsx`, `apps/web/src/components/Sidebar.tsx`, `apps/web/src/components/TopBar.tsx`
- Modify: `apps/web/src/App.tsx` (tighten guard to require an admin role; mount the shell + nested routes)
- Test: `apps/web/src/__tests__/sidebar.test.tsx`

**Interfaces:**
- Produces: `useMyRoles() → { data?: { role, orgId, isSuperAdmin, isAdmin }, isLoading }`; `<AppShell/>` (renders `<Sidebar/>` + `<TopBar/>` + `<Outlet/>`); `NAV_ITEMS` split into org + super_admin groups.
- Consumes: `useAuth()` (Task 5); `supabase` (Task 5).

- [ ] **Step 1: `apps/web/src/lib/roles.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

export type MyRoles = { role: string | null; orgId: string | null; isSuperAdmin: boolean; isAdmin: boolean };

export function useMyRoles() {
  const { session } = useAuth();
  const uid = session?.user.id;
  return useQuery<MyRoles>({
    queryKey: ["my-roles", uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("role, org_id");
      if (error) throw error;
      const rows = data ?? [];
      const isSuperAdmin = rows.some((r) => r.role === "super_admin");
      const adminRow = rows.find((r) => r.role === "admin" || r.role === "editor");
      return {
        role: isSuperAdmin ? "super_admin" : adminRow?.role ?? rows[0]?.role ?? null,
        orgId: adminRow?.org_id ?? null,
        isSuperAdmin,
        isAdmin: isSuperAdmin || !!adminRow,
      };
    },
  });
}
```

- [ ] **Step 2: `apps/web/src/components/Sidebar.tsx`**

```tsx
import { NavLink } from "react-router-dom";
import { useMyRoles } from "../lib/roles";

const ORG_ITEMS = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/events", label: "Events" },
  { to: "/registrations", label: "Registrations" },
  { to: "/payments", label: "Payments" },
  { to: "/check-in", label: "Check-in" },
  { to: "/settings", label: "Settings" },
];
const SUPER_ITEMS = [
  { to: "/organizations", label: "Organizations" },
  { to: "/commission", label: "Commission" },
  { to: "/payouts", label: "Payouts" },
];

export function Sidebar() {
  const roles = useMyRoles();
  const items = [...ORG_ITEMS, ...(roles.data?.isSuperAdmin ? SUPER_ITEMS : [])];
  return (
    <nav style={{ width: 220, borderRight: "1px solid var(--hairline)", background: "var(--canvas)", padding: 16, display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontWeight: 700, fontSize: 17, padding: "6px 10px 14px" }}>Race Pace</div>
      {items.map((it) => (
        <NavLink key={it.to} to={it.to} style={({ isActive }) => ({
          padding: "9px 10px", borderRadius: 8, textDecoration: "none", fontSize: 14,
          color: isActive ? "var(--primary)" : "var(--ink)",
          background: isActive ? "var(--parchment)" : "transparent", fontWeight: isActive ? 600 : 400,
        })}>{it.label}</NavLink>
      ))}
    </nav>
  );
}
```

- [ ] **Step 3: `apps/web/src/components/TopBar.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useMyRoles } from "../lib/roles";

export function TopBar() {
  const { signOut } = useAuth();
  const roles = useMyRoles();
  const orgId = roles.data?.orgId;
  const org = useQuery({
    queryKey: ["org-name", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data } = await supabase.from("organizations").select("name").eq("id", orgId).single();
      return data?.name ?? "";
    },
  });
  return (
    <header style={{ height: 56, borderBottom: "1px solid var(--hairline)", background: "var(--canvas)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 20px" }}>
      <span style={{ fontWeight: 600 }}>{roles.data?.isSuperAdmin ? "Platform" : org.data ?? ""}</span>
      <button onClick={() => signOut()} style={{ border: "1px solid var(--hairline)", background: "var(--canvas)", borderRadius: "var(--radius-pill)", padding: "6px 14px", cursor: "pointer" }}>Sign out</button>
    </header>
  );
}
```

- [ ] **Step 4: `apps/web/src/components/AppShell.tsx`**

```tsx
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function AppShell() {
  return (
    <div style={{ display: "flex", height: "100%" }}>
      <Sidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <TopBar />
        <main style={{ flex: 1, overflow: "auto", background: "var(--parchment)" }}><Outlet /></main>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Tighten `apps/web/src/App.tsx`** — require an admin role and mount the shell with nested routes:

```tsx
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { useMyRoles } from "./lib/roles";
import { AppShell } from "./components/AppShell";
import { Login } from "./routes/Login";
import { NoAccess } from "./routes/NoAccess";
import { Placeholder } from "./routes/Placeholder";

function RequireAdmin() {
  const { session, loading } = useAuth();
  const roles = useMyRoles();
  if (loading) return <div style={{ padding: 32 }}>Loading…</div>;
  if (!session) return <Navigate to="/login" replace />;
  if (roles.isLoading) return <div style={{ padding: 32 }}>Loading…</div>;
  if (!roles.data?.isAdmin) return <Navigate to="/no-access" replace />;
  return <Outlet />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/no-access" element={<NoAccess />} />
        <Route element={<RequireAdmin />}>
          <Route element={<AppShell />}>
            <Route index element={<Navigate to="/events" replace />} />
            <Route path="events" element={<Placeholder title="Events" />} />
            <Route path="dashboard" element={<Placeholder title="Dashboard" />} />
            <Route path="registrations" element={<Placeholder title="Registrations" />} />
            <Route path="payments" element={<Placeholder title="Payments" />} />
            <Route path="check-in" element={<Placeholder title="Check-in" />} />
            <Route path="settings" element={<Placeholder title="Settings" />} />
            <Route path="organizations" element={<Placeholder title="Organizations" />} />
            <Route path="commission" element={<Placeholder title="Commission" />} />
            <Route path="payouts" element={<Placeholder title="Payouts" />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

(The `Events` route is a placeholder until Task 7 replaces it.)

- [ ] **Step 6: Write the failing test** — `apps/web/src/__tests__/sidebar.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "../components/Sidebar";

let mockRoles: { data?: { isSuperAdmin: boolean } } = {};
vi.mock("../lib/roles", () => ({ useMyRoles: () => mockRoles }));

function renderSidebar() {
  return render(<MemoryRouter><Sidebar /></MemoryRouter>);
}

it("org admin sees 6 nav items, not the platform ones", () => {
  mockRoles = { data: { isSuperAdmin: false } };
  renderSidebar();
  expect(screen.getByText("Events")).toBeInTheDocument();
  expect(screen.queryByText("Payouts")).not.toBeInTheDocument();
});

it("super_admin also sees the platform items", () => {
  mockRoles = { data: { isSuperAdmin: true } };
  renderSidebar();
  expect(screen.getByText("Organizations")).toBeInTheDocument();
  expect(screen.getByText("Payouts")).toBeInTheDocument();
});
```

- [ ] **Step 7: Run to verify it passes**

Run: `cd apps/web && pnpm test`.
Expected: PASS (smoke + auth + sidebar). Then `pnpm typecheck` → 0.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "feat(admin): roles hook + role-adaptive shell (sidebar, topbar, guard)"
```

---

## Task 7: Events list — the first real screen

**Files:**
- Create: `apps/web/src/lib/events.ts`, `apps/web/src/routes/Events.tsx`
- Modify: `apps/web/src/App.tsx` (route `events` → `<Events/>`)
- Test: `apps/web/src/__tests__/events.test.tsx`

**Interfaces:**
- Produces: `type AdminEventRow`; `useOrgEvents(orgId?: string)`; `<Events/>`.
- Consumes: `useMyRoles()` (for `orgId`); `supabase` (Task 5).

- [ ] **Step 1: `apps/web/src/lib/events.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type AdminEventRow = {
  id: string;
  name: string;
  event_date: string | null;
  status: string;
  original_date: string | null;
  categories: { slots_taken: number; slots_total: number }[];
};

export function useOrgEvents(orgId?: string) {
  return useQuery<AdminEventRow[]>({
    queryKey: ["org-events", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("events")
        .select("id,name,event_date,status,original_date,categories(slots_taken,slots_total)")
        .eq("org_id", orgId!)
        .order("event_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AdminEventRow[];
    },
  });
}
```

- [ ] **Step 2: `apps/web/src/routes/Events.tsx`**

```tsx
import { useMyRoles } from "../lib/roles";
import { useOrgEvents, type AdminEventRow } from "../lib/events";

const STATUS_COLOR: Record<string, string> = {
  open: "var(--ink)", almost_full: "var(--amber)", cancelled: "var(--danger)",
  closed: "var(--ink-muted)", completed: "var(--ink-muted)", draft: "var(--ink-subtle)",
};

function fill(cats: AdminEventRow["categories"]) {
  const taken = cats.reduce((s, c) => s + c.slots_taken, 0);
  const total = cats.reduce((s, c) => s + c.slots_total, 0);
  return `${taken}/${total}`;
}
function fmtDate(d: string | null) {
  return d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";
}

export function Events() {
  const roles = useMyRoles();
  const { data, isLoading, isError, refetch } = useOrgEvents(roles.data?.orgId ?? undefined);

  if (isLoading) return <Wrap><p style={{ color: "var(--ink-muted)" }}>Loading events…</p></Wrap>;
  if (isError) return <Wrap><button onClick={() => refetch()}>Couldn't load events. Retry.</button></Wrap>;
  const rows = data ?? [];

  return (
    <Wrap>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginTop: 0 }}>Events</h1>
      {rows.length === 0 ? (
        <p style={{ color: "var(--ink-muted)" }}>No events yet.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", background: "var(--canvas)", borderRadius: 12, overflow: "hidden" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--ink-muted)", fontSize: 12 }}>
              <th style={th}>Name</th><th style={th}>Date</th><th style={th}>Status</th><th style={th}>Categories</th><th style={th}>Fill</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} style={{ borderTop: "1px solid var(--divider)" }}>
                <td style={td}>{e.name}</td>
                <td style={td}>{fmtDate(e.event_date)}{e.original_date ? <span style={{ color: "var(--info)", fontSize: 12 }}> · was {fmtDate(e.original_date)}</span> : null}</td>
                <td style={{ ...td, color: STATUS_COLOR[e.status] ?? "var(--ink)", textTransform: "capitalize" }}>{e.status.replace("_", " ")}</td>
                <td style={td}>{e.categories.length}</td>
                <td style={td}>{fill(e.categories)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 28 }}>{children}</div>;
}
const th = { padding: "12px 14px", fontWeight: 600 } as const;
const td = { padding: "12px 14px", fontSize: 14 } as const;
```

- [ ] **Step 3: Wire the route** — in `apps/web/src/App.tsx`, add the import and replace the events placeholder:

```tsx
import { Events } from "./routes/Events";
// …
<Route path="events" element={<Events />} />
```

- [ ] **Step 4: Write the failing test** — `apps/web/src/__tests__/events.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { Events } from "../routes/Events";

vi.mock("../lib/roles", () => ({ useMyRoles: () => ({ data: { orgId: "a1" } }) }));
let mockQuery: { data?: unknown[]; isLoading: boolean; isError: boolean; refetch: () => void };
vi.mock("../lib/events", async (orig) => ({ ...(await orig()), useOrgEvents: () => mockQuery }));

it("renders a row per event with category count + fill", () => {
  mockQuery = { isLoading: false, isError: false, refetch: () => {}, data: [
    { id: "e1", name: "Apo Sky Ultra", event_date: "2026-11-14", status: "open", original_date: null,
      categories: [{ slots_taken: 3, slots_total: 10 }, { slots_taken: 1, slots_total: 5 }] },
  ] };
  render(<Events />);
  expect(screen.getByText("Apo Sky Ultra")).toBeInTheDocument();
  expect(screen.getByText("4/15")).toBeInTheDocument();  // fill summed across categories
});

it("shows the empty state when there are no events", () => {
  mockQuery = { isLoading: false, isError: false, refetch: () => {}, data: [] };
  render(<Events />);
  expect(screen.getByText("No events yet.")).toBeInTheDocument();
});

it("shows the loading state", () => {
  mockQuery = { isLoading: true, isError: false, refetch: () => {}, data: undefined };
  render(<Events />);
  expect(screen.getByText("Loading events…")).toBeInTheDocument();
});
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd apps/web && pnpm test`.
Expected: PASS (all suites). Then `pnpm typecheck` → 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat(admin): read-only org-scoped Events list"
```

---

## Final verification (after all tasks)

- [ ] **Backend suite** (root, `supabase start` up): `pnpm test` → all green, incl. `admin-roles` (user_roles RLS, admin draft-read, seed sanity) and the pre-existing suites unaffected.
- [ ] **Web suite + types:** `cd apps/web && pnpm test` → all green; `pnpm typecheck` → 0. Root `pnpm -r typecheck` → clean (web adds a `typecheck` script; mobile unaffected).
- [ ] **End-to-end on `admin.racepace.lan`** (Docker up, stack up):
  1. `docker compose up -d` (shared Traefik infra also up) → `curl -s https://admin.racepace.lan | grep -q 'id="root"'`.
  2. Open https://admin.racepace.lan → redirected to Sign in.
  3. Sign in with **`admin@runwithpoint.test` / `password123`** → lands on **Events** (Run With Point's events, including any `draft`), with the role-adaptive sidebar (6 items; no platform section for this org admin).
  4. A runner account (e.g. `runner@test.dev`) → **No access** screen.
- [ ] **Docs:** add Plan 09's status to `docs/README.md` and refresh the roadmap there (it still says "Plan 4 · to write" — update it to reflect Plans 4–8 merged and the admin console plans 09–14). Commit.
- [ ] Then use **superpowers:finishing-a-development-branch**.

## Notes / decisions baked in

- **Table is `organizations`** (the spec's `orgs` was corrected here). RWP = `…a1`; the seeded admin user id is `…b1`.
- **Joins the existing Traefik/dnsmasq infra** (not a standalone port bind): dnsmasq resolves `*.lan`→127.0.0.1, Traefik terminates TLS with the mkcert `*.lan` cert and routes `Host(admin.racepace.lan)` to the container's `:5173`. This was corrected from the spec's original "no proxy / HTTP / /etc/hosts" after discovering the machine's Traefik setup at execution time. **HTTPS is available now** — which Plan 12's check-in camera (`getUserMedia` needs a secure context) will require.
- **`node_modules` named volumes** are load-bearing: they keep the container's Linux `esbuild`/native binaries from being shadowed by the macOS host `node_modules` via the repo bind-mount. First `docker compose up` is slow (in-container install of the whole workspace); later runs reuse the volumes.
- **Host-side `pnpm install`** is still needed so Vitest/tsc run on the Mac; the container installs separately for serving.
- **CORS:** the app (origin `admin.racepace.lan`) calls Supabase at `127.0.0.1:54521`. Supabase local's Kong sends permissive CORS; if a preflight is ever blocked, that's the place to look — no code change expected.
- **`crypt`/`gen_salt`** in the seed rely on pgcrypto (present in Supabase local); if unqualified calls error, use `extensions.crypt` / `extensions.gen_salt`.
- **Deferred:** gross ₱ on the events list (Plan 11), events create/edit (Plan 10), super_admin org switcher + cross-org views (Plan 14), LAN-wide access (dnsmasq), a production build image, and CI for the web app.
```
