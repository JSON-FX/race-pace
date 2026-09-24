# Local Fieldnotes design workspace

Use `https://racepace.lan` for the runner site and `https://admin.racepace.lan` for the admin console. Both currently run from `/Users/jsonse/Documents/development/race-pace-fieldnotes-event-pilot` through Docker Compose. The canonical component library remains at `https://storybook.lan/race-pace/`.

## Active stack

- Docker Compose runs the `site` and `web` services from this worktree. The main-checkout site and web containers are stopped to avoid competing for the same Traefik hostnames.
- The worktree's ignored `.env` sets `STACK_ID=fieldnotes` and `SUPABASE_INTERNAL_URL=http://host.docker.internal:54521`. Server requests inside Docker use the local Supabase API.
- Each app has its own ignored, private `.env.local` file. Their browser-facing Supabase URL and anon key match the local CLI stack at `http://127.0.0.1:54521`. Keep these as files because absolute symlinks to another checkout break inside `/repo`.
- Do not use `pnpm build` on the host while these containers are running. The repository's `AGENTS.md` explains the shared build-directory hazard.

From this worktree, check or restart the app containers with `docker compose ps site web` and `docker compose up -d site web`. Run `supabase status` to check the local database. Before starting another checkout's stack, stop this worktree's `site` and `web` services and verify the `/repo` bind mounts on the new containers. Traefik can otherwise route to code from the wrong worktree.

## Local sample race

[Fieldnotes Ridge Run (Local Demo)](https://racepace.lan/events/fieldnotes-ridge-run-local-demo) is a clearly labeled fictional race in **local Supabase only**. It has a complete description, dates and venue, route points, schedule, three distances with prices and capacity, inclusions, a published local waiver, add-ons, form questions, and three original generated images. Its images live in the local `event-images` Storage bucket.

The fixture source is ignored at `.local/fieldnotes-ridge-event.sql`. The generated source images are ignored at `.local/event-images/fieldnotes-ridge/`. A local database reset removes this race and its Storage objects; restore the generated images to local Storage before reapplying the SQL fixture. Do not copy this fixture or sample imagery to staging or production.

For future local sample events, use the `imagegen` skill to create their images and fill every applicable event field and related section. Keep the data and assets local. This supports realistic visual review without putting fictional races into production.
