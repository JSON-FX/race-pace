# Deploying Race Pace to Vercel

Two Next.js apps in one pnpm monorepo, both on the same hosted Supabase project
(`whaqarofxdlzxrelbcrq`):

| App | Path | Audience |
| --- | --- | --- |
| **Admin console** | `apps/web` | race directors, marshals, platform staff |
| **Runner site** | `apps/site` | public — browse, register, pay |

They are **two separate Vercel projects from the same repo**, distinguished by
Root Directory. Do not try to serve both from one project.

---

## Before you start

- The repo is `git@github.com:JSON-FX/race-pace.git`, and `main` is current.
- Node **20+**, pnpm **9.7.0** (declared in the root `package.json`).
- Have `apps/web/.env.local` open — you'll copy two values from it.

---

## Step 1 — Create the admin project

In Vercel: **Add New → Project → Import** `JSON-FX/race-pace`.

| Setting | Value |
| --- | --- |
| Project Name | `race-pace-admin` |
| Framework Preset | Next.js |
| **Root Directory** | `apps/web` |
| Build / Install / Output | leave as detected |

When you set Root Directory, Vercel shows **"Include files outside of the root
directory"** — leave it **ON**. Both apps import `@race-pace/shared`, which is a
source-only TypeScript workspace package; with that off, the build cannot see it
and fails at install.

### Environment variables — set these BEFORE the first deploy

Add to **Production, Preview and Development**:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://whaqarofxdlzxrelbcrq.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | copy from `apps/web/.env.local` |

> **This is the one that bites.** `next.config.ts` reads
> `NEXT_PUBLIC_SUPABASE_URL` **at build time** to build the allowed image hosts.
> If it is missing on the first build, no Supabase pattern is emitted and *every
> org logo, event hero and runner avatar 400s in production* — while local dev
> keeps working, so nothing looks wrong until you load the deployed site.
> Adding the variable afterwards is not enough; it needs a **redeploy**.

**Do NOT set `SUPABASE_INTERNAL_URL`.** It exists only for the Docker dev stack,
where server components fetch from inside the container. On Vercel it would
override the public URL with an unreachable host and every server-side query
would fail.

Deploy. Note the URL, e.g. `race-pace-admin.vercel.app`.

---

## Step 2 — Create the runner-site project

Same repo, **Add New → Project → Import** again.

| Setting | Value |
| --- | --- |
| Project Name | `race-pace-site` |
| **Root Directory** | `apps/site` |

### Environment variables

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://whaqarofxdlzxrelbcrq.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same key as the admin |
| `NEXT_PUBLIC_SITE_URL` | the site's own URL, e.g. `https://race-pace-site.vercel.app` |

Same two warnings apply: set them before the first build, and never set
`SUPABASE_INTERNAL_URL`.

`NEXT_PUBLIC_SITE_URL` is a chicken-and-egg: you don't know the URL until the
project exists. Deploy once, copy the assigned domain, set the variable, then
**redeploy**.

---

## Step 3 — Supabase configuration (required, or sign-in breaks)

Nothing below is optional. Each item fails in a way that looks like an app bug.

### 3a. Auth → URL Configuration

**Site URL:** the runner site's URL — that is where a password-reset or
confirmation email should land a runner.

**Redirect URLs** — add every one of these:

```
https://race-pace-admin.vercel.app/auth/callback
https://race-pace-site.vercel.app/auth/callback
https://*.vercel.app/auth/callback
https://admin.racepace.lan/auth/callback
https://racepace.lan/auth/callback
```

Supabase matches `redirectTo` against this list **as a whole string**. A missing
entry does not error — it silently falls back to the Site URL, so an admin
signing in with Google lands on the public runner homepage with nothing in any
log. The `*.vercel.app` wildcard covers preview deployments, which otherwise get
a new hostname per branch and would each need adding by hand.

Keep the `.lan` entries so local development keeps working.

### 3b. Google provider

Already enabled. In **Google Cloud Console → Credentials → your OAuth client**,
confirm the Authorized redirect URI is:

```
https://whaqarofxdlzxrelbcrq.supabase.co/auth/v1/callback
```

That is Supabase's callback, not your app's, and it does not change when you add
Vercel domains.

### 3c. Edge Function secrets

The functions enforce a CORS allow-list. Without your Vercel origins in it, the
browser blocks registration and payment calls with a CORS error that reads like
the API is down.

```bash
npx supabase@2.109.1 secrets set \
  SITE_ORIGINS="https://race-pace-site.vercel.app,https://race-pace-admin.vercel.app,*.vercel.app,https://racepace.lan,https://admin.racepace.lan" \
  PUBLIC_SITE_URL="https://race-pace-site.vercel.app"
```

`SITE_ORIGINS` supports `*.vercel.app` for previews (subdomains only — never the
apex, and never a lookalike like `evil-vercel.app`). `PUBLIC_SITE_URL` is the
base for ticket-email links; if it is wrong, tickets email people a dead link.

---

## Step 4 — Verify, in this order

Each check isolates one layer, so a failure tells you where to look.

**Runner site**

1. Home loads and event hero images render → if images 404/400, `NEXT_PUBLIC_SUPABASE_URL` was missing at build time (Step 1). Redeploy.
2. `/events` lists the 20 seeded events → Supabase reachable.
3. Open an event, start a registration → Edge Functions + CORS (Step 3c).

**Admin console**

4. `/login` shows the branded card with the logo and the Google button.
5. Sign in with `admin@racepace.test` → lands on `/events`.
6. Google sign-in with an account that has no org role → **"This account isn't registered"**. That is the correct outcome, and it proves the whole OAuth round-trip works: the code was exchanged, a session was created, and the authorization gate ran.
7. Check `/dashboard`, `/check-in`, `/organizations`, `/commission`, `/payouts` all render.

**Camera note:** check-in's camera fallback needs a secure context.
`*.vercel.app` is HTTPS, so it works.

---

## Traps, collected

| Symptom | Cause |
| --- | --- |
| Images 400 in production, fine locally | `NEXT_PUBLIC_SUPABASE_URL` missing on the **first** build. Redeploy after adding. |
| Every server query fails | `SUPABASE_INTERNAL_URL` set on Vercel. Remove it. |
| Build fails on `@race-pace/shared` | "Include files outside root directory" is off. |
| Google sign-in lands on the runner homepage | Redirect URL not in Supabase's allow-list. |
| Registration/payment fails with CORS | Vercel origin missing from `SITE_ORIGINS`. |
| Ticket emails link somewhere dead | `PUBLIC_SITE_URL` still pointing at localhost. |

---

## Custom domains (later)

When you move off `*.vercel.app`, each new domain must be added to **both** the
Supabase Redirect URLs and `SITE_ORIGINS`. Adding it in Vercel alone is not
enough — that is the same silent failure as Step 3a.

## Database

Already migrated and current: 8 migrations applied to `whaqarofxdlzxrelbcrq`,
6 Edge Functions deployed. Nothing to do here for a first deploy.
