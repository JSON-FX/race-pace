-- Admin write path for event content (Plan 10). Additive; reuses auth_can_admin_org (Plan 09).

-- The editor loads a DRAFT event's add-ons (Plan 09 gave events+categories admin-read, not addons).
create policy "addons_read_org_admin" on addons for select
  using (auth_can_admin_org((select e.org_id from events e where e.id = addons.event_id)));

-- events: create/update own-org; hard-delete drafts only (published => cancel).
create policy "events_insert_org_admin" on events for insert
  with check (auth_can_admin_org(org_id));
create policy "events_update_org_admin" on events for update
  using (auth_can_admin_org(org_id)) with check (auth_can_admin_org(org_id));
create policy "events_delete_org_admin_draft" on events for delete
  using (auth_can_admin_org(org_id) and status = 'draft');

-- categories: gated by the parent event's org.
create policy "categories_insert_org_admin" on categories for insert
  with check (auth_can_admin_org((select e.org_id from events e where e.id = event_id)));
create policy "categories_update_org_admin" on categories for update
  using (auth_can_admin_org((select e.org_id from events e where e.id = categories.event_id)))
  with check (auth_can_admin_org((select e.org_id from events e where e.id = event_id)));
create policy "categories_delete_org_admin" on categories for delete
  using (auth_can_admin_org((select e.org_id from events e where e.id = categories.event_id)));

-- addons: gated by the parent event's org.
create policy "addons_insert_org_admin" on addons for insert
  with check (auth_can_admin_org((select e.org_id from events e where e.id = event_id)));
create policy "addons_update_org_admin" on addons for update
  using (auth_can_admin_org((select e.org_id from events e where e.id = addons.event_id)))
  with check (auth_can_admin_org((select e.org_id from events e where e.id = event_id)));
create policy "addons_delete_org_admin" on addons for delete
  using (auth_can_admin_org((select e.org_id from events e where e.id = addons.event_id)));

grant insert, update, delete on events, categories, addons to authenticated;
