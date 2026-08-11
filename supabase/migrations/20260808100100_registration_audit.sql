-- Append-only timeline of everything notable that happens to a registration. Structure,
-- RLS shape, and trigger/definer-only write discipline follow `notifications`
-- (20260723090000_notifications_table.sql): clients read, nothing but security-definer
-- code writes.
--
-- `action` is text, not an enum, so the kit-release spec can add 'kit_released' without a
-- type migration. Values used today: 'field_changed', 'paid', 'refunded'.
create table registration_audit (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references registrations(id) on delete cascade,
  org_id          uuid not null references organizations(id) on delete cascade,
  event_id        uuid not null references events(id) on delete cascade,
  action          text not null,
  detail          jsonb not null default '{}'::jsonb,  -- field_changed: { field, from, to }
  actor_id        uuid references auth.users(id) on delete set null,
  actor_role      text,                                -- 'runner' | 'admin' | 'system'
  created_at      timestamptz not null default now()
);

create index registration_audit_reg_idx on registration_audit (registration_id, created_at desc);

alter table registration_audit enable row level security;

-- Read-own mirrors registrations_read_own (20260718183018_registrations_payments.sql:19).
create policy "registration_audit_read_own" on registration_audit
  for select using (
    exists (
      select 1 from registrations r
      where r.id = registration_audit.registration_id and r.user_id = auth.uid()
    )
  );

create policy "registration_audit_read_org_admin" on registration_audit
  for select using (auth_can_admin_org(org_id));

-- No insert/update/delete grant to any client role. Rows arrive only through
-- security-definer functions, so the log cannot be forged or rewritten from a browser.
grant select on registration_audit to authenticated;
grant all    on registration_audit to service_role;
