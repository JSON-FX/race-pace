-- Local-only until reviewed staging deployment. The event field remains for
-- old readers; category writes now own its value.
alter table public.events drop constraint events_total_event_slots_check;
alter table public.events add constraint events_total_event_slots_check check (total_event_slots>=0);
drop trigger event_capacity_allocation_guard on public.events;
drop trigger category_capacity_allocation_guard on public.categories;
drop trigger published_event_capacity_guard on public.events;

create function public.event_category_total_projection() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_total bigint;
begin
  select sum(slots_total) into v_total from public.categories where event_id=new.id;
  -- Compatibility for an old coming-soon client with categoryless reservations.
  -- New editors never send or enable these event-level reservation fields.
  if v_total is null and new.coming_soon_reserve_enabled then
    if tg_op='UPDATE' then new.total_event_slots:=old.total_event_slots; end if;
  else new.total_event_slots:=coalesce(v_total,0)::integer; end if;
  return new;
end $$;
revoke all on function public.event_category_total_projection() from public,anon,authenticated;
create trigger a_event_category_total_projection before insert or update on public.events
  for each row execute function public.event_category_total_projection();

create or replace function public.coming_soon_event_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status='coming_soon' and (nullif(btrim(new.name),'') is null or nullif(btrim(new.slug),'') is null or
    nullif(btrim(new.hero_image_url),'') is null or nullif(btrim(new.description),'') is null or new.discipline is null) then
    raise exception 'coming_soon_fields_required' using errcode='23514'; end if;
  if tg_op='UPDATE' then
    if old.status='coming_soon' and new.status in ('open','almost_full') and old.coming_soon_reserve_enabled then
      if (select coalesce(sum(slots_total),0) from public.categories where event_id=new.id)<new.total_event_slots then
        raise exception 'event_categories_below_total_capacity' using errcode='23514'; end if;
      if new.reservation_deadline_at<=statement_timestamp() then new.reservation_deadline_at:=statement_timestamp()+interval '14 days'; end if;
    end if;
    if new.status='coming_soon' and old.status not in ('draft','coming_soon') and exists(
      select 1 from public.registrations where event_id=new.id and status in ('pending','paid')) then
      raise exception 'event_has_registrations' using errcode='23514'; end if;
    if new.total_event_slots is not null and (select count(*) from public.event_capacity_claims(new.id))>new.total_event_slots then
      raise exception 'event_capacity_below_existing_places' using errcode='23514'; end if;
    if exists(select 1 from public.event_reservations where event_id=new.id and status in ('pending','paid','review_required')) and
      (old.reservation_fee_cents is distinct from new.reservation_fee_cents or
       (old.coming_soon_reserve_enabled and not new.coming_soon_reserve_enabled) or new.reservation_deadline_at<old.reservation_deadline_at) then
      raise exception 'active_reservations_lock_settings' using errcode='23514'; end if;
  end if;
  return new;
end $$;
revoke all on function public.coming_soon_event_guard() from public,anon,authenticated;

create function public.category_capacity_update_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_event uuid; v_used bigint; v_general bigint; v_reserved bigint;
begin
  v_event:=case when tg_op='DELETE' then old.event_id else new.event_id end;
  perform 1 from public.events where id=v_event for update;
  -- Parent deletion has already passed its own authorization/money guards.
  -- Its cascade may reach categories before the remaining registrations.
  if not found and tg_op='DELETE' then return old; end if;
  if tg_op='UPDATE' and (new.org_id,new.event_id) is distinct from (old.org_id,old.event_id) then
    raise exception 'category_scope_immutable' using errcode='23514'; end if;
  if tg_op='DELETE' then
    if exists(select 1 from public.event_capacity_claims(v_event) q where q.category_id=old.id) then
      raise exception 'category_has_existing_places' using errcode='23514'; end if;
    return old;
  end if;
  if not exists(select 1 from public.events where id=new.event_id and org_id=new.org_id) then
    raise exception 'category_scope_mismatch' using errcode='23514'; end if;
  select count(*),count(*) filter(where pool='general'),count(*) filter(where pool='reservation') into v_used,v_general,v_reserved
    from public.event_capacity_claims(v_event) q where q.category_id=new.id;
  if new.slots_total<v_used or (new.reservation_enabled and new.reservation_sales_close_at>statement_timestamp() and
    (new.slots_total-new.reservation_slots<v_general or new.reservation_slots<v_reserved)) then
    raise exception 'category_capacity_below_existing_places' using errcode='23514'; end if;
  if tg_op='UPDATE' and new.entry_payment_deadline_at<old.entry_payment_deadline_at and exists(
    select 1 from public.prescreening_applications a join public.prescreening_batches b on b.id=a.batch_id
      where a.category_id=new.id and a.released_at is null and b.payment_deadline_at>new.entry_payment_deadline_at) then
    raise exception 'category_deadline_below_promised_window' using errcode='23514'; end if;
  return new;
end $$;
revoke all on function public.category_capacity_update_guard() from public,anon,authenticated;
create trigger category_capacity_update_guard before insert or delete or update of slots_total,reservation_slots,reservation_enabled,
  reservation_sales_close_at,entry_payment_deadline_at,org_id,event_id on public.categories
  for each row execute function public.category_capacity_update_guard();

create function public.category_refresh_event_total() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  update public.events set total_event_slots=(select coalesce(sum(slots_total),0) from public.categories
    where event_id=case when tg_op='DELETE' then old.event_id else new.event_id end)
  where id=case when tg_op='DELETE' then old.event_id else new.event_id end;
  return null;
end $$;
revoke all on function public.category_refresh_event_total() from public,anon,authenticated;
create trigger category_refresh_event_total after insert or delete or update of slots_total on public.categories
  for each row execute function public.category_refresh_event_total();
update public.events set total_event_slots=total_event_slots;

grant insert(reservation_enabled,reservation_slots,reservation_fee_cents,reservation_sales_close_at,
  entry_payment_deadline_at,inclusions,prescreening_enabled,prescreening_requirement) on public.categories to authenticated;
grant update(reservation_enabled,reservation_slots,reservation_fee_cents,reservation_sales_close_at,
  entry_payment_deadline_at,inclusions,prescreening_enabled,prescreening_requirement) on public.categories to authenticated;

create function public.save_event_categories(p_event uuid,p_original uuid[],p_categories jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.events%rowtype; v jsonb; c public.categories%rowtype; v_id uuid; v_ids uuid[]:='{}'; v_result jsonb:='[]';
begin
  select * into e from public.events where id=p_event for update;
  if not found or not public.auth_can_admin_org(e.org_id) then raise exception 'forbidden' using errcode='42501'; end if;
  if p_original is null or jsonb_typeof(p_categories) is distinct from 'array' or jsonb_array_length(p_categories)>100 then
    raise exception 'invalid_categories' using errcode='22023'; end if;
  perform 1 from public.categories where event_id=p_event order by id for update;
  for v in select x from jsonb_array_elements(p_categories) x loop
    v_id:=coalesce((v->>'id')::uuid,gen_random_uuid());
    if v_id=any(v_ids) or exists(select 1 from public.categories where id=v_id and event_id<>p_event) then
      raise exception 'invalid_categories' using errcode='22023'; end if;
    v_ids:=array_append(v_ids,v_id);
    select * into c from jsonb_populate_record(null::public.categories,v);
    if nullif(btrim(c.code),'') is null or nullif(btrim(c.label),'') is null or c.base_price<0 or c.slots_total<0 or
      exists(select 1 from unnest(c.inclusions) i where nullif(btrim(i),'') is null or length(i)>140) then
      raise exception 'invalid_categories' using errcode='22023'; end if;
    insert into public.categories(id,org_id,event_id,code,label,distance_km,base_price,slots_total,elevation_gain_m,cutoff_hours,blurb,
      reservation_enabled,reservation_slots,reservation_fee_cents,reservation_sales_close_at,entry_payment_deadline_at,
      inclusions,prescreening_enabled,prescreening_requirement)
    values(v_id,e.org_id,e.id,btrim(c.code),btrim(c.label),c.distance_km,c.base_price,c.slots_total,c.elevation_gain_m,c.cutoff_hours,c.blurb,
      coalesce(c.reservation_enabled,false),coalesce(c.reservation_slots,0),c.reservation_fee_cents,c.reservation_sales_close_at,c.entry_payment_deadline_at,
      coalesce(c.inclusions,'{}'),coalesce(c.prescreening_enabled,false),c.prescreening_requirement)
    on conflict(id) do update set code=excluded.code,label=excluded.label,distance_km=excluded.distance_km,base_price=excluded.base_price,
      slots_total=excluded.slots_total,elevation_gain_m=excluded.elevation_gain_m,cutoff_hours=excluded.cutoff_hours,blurb=excluded.blurb,
      reservation_enabled=excluded.reservation_enabled,reservation_slots=excluded.reservation_slots,reservation_fee_cents=excluded.reservation_fee_cents,
      reservation_sales_close_at=excluded.reservation_sales_close_at,entry_payment_deadline_at=excluded.entry_payment_deadline_at,
      inclusions=excluded.inclusions,prescreening_enabled=excluded.prescreening_enabled,prescreening_requirement=excluded.prescreening_requirement;
    v_result:=v_result||jsonb_build_array(jsonb_build_object('id',v_id,'tempId',v->>'tempId'));
  end loop;
  -- Only delete IDs that this editor actually loaded. A second editor's newly
  -- created category is not an omission from this request.
  delete from public.categories where event_id=p_event and id=any(p_original) and not(id=any(v_ids));
  return v_result;
end $$;
revoke all on function public.save_event_categories(uuid,uuid[],jsonb) from public,anon;
grant execute on function public.save_event_categories(uuid,uuid[],jsonb) to authenticated;
