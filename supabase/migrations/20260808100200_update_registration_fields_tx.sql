-- The single write path for post-checkout registration field edits.
--
-- Takes NO actor parameter on purpose. This function is granted to `authenticated` and
-- called straight from the browser, so an actor argument would be a privilege-escalation
-- hole: any signed-in user could pass another runner's uid and edit that runner's row.
-- Identity comes from the JWT via auth.uid(), never from an argument.
--
-- Authorization lives inside the function rather than in RLS because RLS is row-level and
-- cannot express "you may write this JSONB key but not total_amount" — the same reasoning
-- as 20260806150000_checkin_rpcs.sql.
--
-- The field classification below mirrors KIT_KEYS/SAFETY_KEYS in packages/shared and
-- supabase/functions/_shared/validation.ts. This SQL copy is the load-bearing one.
create or replace function public.update_registration_fields_tx(
  p_registration_id uuid,
  p_changes         jsonb
) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := auth.uid();
  v_reg        public.registrations%rowtype;
  v_is_admin   boolean;
  v_kit_closes timestamptz;
  v_key        text;
  v_val        jsonb;
  v_new        text;
  v_policy     text;
  v_changed    jsonb := '{}'::jsonb;
  v_role       text;
begin
  if v_actor is null then return 'forbidden'; end if;

  select * into v_reg from public.registrations where id = p_registration_id for update;
  if not found then return 'not_found'; end if;

  v_is_admin := public.auth_can_admin_org(v_reg.org_id);
  if v_reg.user_id <> v_actor and not v_is_admin then return 'forbidden'; end if;

  -- refunded / cancelled registrations are settled; nothing about them may change.
  if v_reg.status not in ('pending', 'paid') then return 'not_editable'; end if;

  select kit_edit_closes_at into v_kit_closes from public.events where id = v_reg.event_id;

  -- p_changes must be a JSON object for jsonb_each below; an array or scalar makes it raise
  -- "cannot call jsonb_each on a non-object", surfacing as a raw 500 instead of one of this
  -- function's seven documented return codes. p_changes = NULL is already safe: jsonb_each is
  -- strict, so the loop body never runs and we fall through to 'no_change'.
  if p_changes is not null and jsonb_typeof(p_changes) <> 'object' then return 'invalid_value'; end if;

  -- Validation pass. Any rejection returns before a single write, so a batch containing
  -- one bad key changes nothing.
  for v_key, v_val in select key, value from jsonb_each(p_changes) loop
    -- `#>>'{}'` silently stringifies non-string JSON: an object/array becomes its serialized
    -- text (so {"emergency_contact":{"a":1}} would store the literal string '{"a": 1}'), and a
    -- JSON null becomes SQL NULL, which defeats every `not in (...)` guard below (NULL NOT IN
    -- (...) evaluates to NULL, not TRUE, so neither the shirt_size nor blood_type canonical-list
    -- check fires and the null sails through to the change-detection step). Reject anything
    -- that isn't a JSON string before extracting text, so neither bypass is reachable.
    if jsonb_typeof(v_val) <> 'string' then return 'invalid_value'; end if;
    v_new := v_val #>> '{}';

    v_policy := case
      when v_key = 'shirt_size' then 'kit'
      when v_key in ('blood_type', 'emergency_contact') then 'safety'
      else 'immutable'
    end;

    if v_policy = 'immutable' then return 'invalid_value'; end if;

    -- Org admins are never deadline-bound; every admin edit is recorded below, which is
    -- what makes the override safe to grant.
    if v_policy = 'kit' and not v_is_admin
       and v_kit_closes is not null and v_kit_closes < now() then
      return 'locked';
    end if;

    if v_key = 'shirt_size'
       and v_new not in ('XS', 'S', 'M', 'L', 'XL', 'XXL') then
      return 'invalid_value';
    end if;
    if v_key = 'blood_type'
       and v_new not in ('A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-', 'Unknown') then
      return 'invalid_value';
    end if;
    -- emergency_contact is free text with no canonical list; bound its length instead, so a
    -- signed-in runner can't push a multi-megabyte string into custom_data (and into an audit
    -- row) on every call.
    if v_key = 'emergency_contact' and length(v_new) > 200 then
      return 'invalid_value';
    end if;

    if (v_reg.custom_data #>> array[v_key]) is distinct from v_new then
      v_changed := v_changed || jsonb_build_object(v_key, v_new);
    end if;
  end loop;

  if v_changed = '{}'::jsonb then return 'no_change'; end if;

  update public.registrations
     set custom_data = coalesce(custom_data, '{}'::jsonb) || v_changed
   where id = p_registration_id;

  v_role := case when v_is_admin then 'admin' else 'runner' end;

  -- One row per changed field. v_reg holds the pre-update snapshot, so `from` is the old
  -- value even though registrations has already been updated.
  for v_key, v_new in select key, value #>> '{}' from jsonb_each(v_changed) loop
    insert into public.registration_audit
      (registration_id, org_id, event_id, action, detail, actor_id, actor_role)
    values (
      p_registration_id, v_reg.org_id, v_reg.event_id, 'field_changed',
      jsonb_build_object('field', v_key, 'from', v_reg.custom_data #>> array[v_key], 'to', v_new),
      v_actor, v_role
    );
  end loop;

  return 'ok';
end;
$$;

revoke all on function public.update_registration_fields_tx(uuid, jsonb) from public;
grant execute on function public.update_registration_fields_tx(uuid, jsonb) to authenticated;
