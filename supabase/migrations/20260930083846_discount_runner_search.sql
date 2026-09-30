-- Follow-up to the deployed discount system. Runner accounts are global identities;
-- code ownership and all event/financial data remain isolated by organization.
begin;

create or replace function public.discount_create(p_org uuid,p_input jsonb) returns setof public.discount_codes
language plpgsql security definer set search_path='' as $$
declare d public.discount_codes%rowtype; n integer; i integer; batch uuid:=gen_random_uuid(); assigned uuid; ids uuid[];
begin
 if not public.auth_manage_discounts(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
 n:=case when p_input->>'kind'='special' then coalesce((p_input->>'quantity')::integer,1) else 1 end;
 if n<1 or n>500 then raise exception 'invalid_quantity'; end if;
 if exists(select 1 from jsonb_array_elements_text(coalesce(p_input->'event_ids','[]')) x where not exists(select 1 from public.events where id=x::uuid and org_id=p_org))
 or exists(select 1 from jsonb_array_elements_text(coalesce(p_input->'category_ids','[]')) x where not exists(select 1 from public.categories where id=x::uuid and org_id=p_org)) then raise exception 'invalid_scope'; end if;
 select coalesce(array_agg(x::uuid),'{}') into ids from jsonb_array_elements_text(coalesce(p_input->'passport_ids','[]')) x;
 if cardinality(ids)>0 and (cardinality(ids)<>n or cardinality(ids)<>(select count(distinct x) from unnest(ids) x)) then raise exception 'invalid_assignment'; end if;
 -- A registered runner can receive an invitation before joining an event.
 -- Managed Passports retain the existing organization-participant boundary.
 if exists(select 1 from unnest(ids) x where not exists(
   select 1 from public.runner_passports p where p.id=x and (
     exists(select 1 from auth.users u where u.id=p.claimed_user_id and not u.is_anonymous and u.deleted_at is null)
     or exists(select 1 from public.registrations r where r.org_id=p_org and r.participant_passport_id=p.id)
     or exists(select 1 from public.prescreening_applications a where a.org_id=p_org and a.participant_passport_id=p.id)
   )
 )) then raise exception 'invalid_assignment'; end if;
 for i in 1..n loop
  assigned:=ids[i];
  insert into public.discount_codes(org_id,code,kind,discount_type,value,coverage,scope,event_ids,category_ids,max_uses,absorb_fees,assigned_passport_id,starts_at,ends_at,batch_id,created_by)
  values(p_org,case when p_input->>'kind'='special' then upper(substr(replace(gen_random_uuid()::text,'-',''),1,20)) else upper(btrim(p_input->>'code')) end,
   p_input->>'kind',p_input->>'discount_type',(p_input->>'value')::integer,
   case when p_input->>'discount_type'='percent' and (p_input->>'value')::integer=10000 then 'subtotal' else p_input->>'coverage' end,
   coalesce(p_input->>'scope','organization'),array(select x::uuid from jsonb_array_elements_text(coalesce(p_input->'event_ids','[]')) x),
   array(select x::uuid from jsonb_array_elements_text(coalesce(p_input->'category_ids','[]')) x),
   case when p_input->>'kind'='special' then 1 else (p_input->>'max_uses')::integer end,coalesce((p_input->>'absorb_fees')::boolean,false),assigned,
   (p_input->>'starts_at')::timestamptz,(p_input->>'ends_at')::timestamptz,case when n>1 then batch end,auth.uid()) returning * into d;
  return next d;
 end loop;
end $$;
revoke all on function public.discount_create(uuid,jsonb) from public,anon;
grant execute on function public.discount_create(uuid,jsonb) to authenticated,service_role;

-- Append email while retaining the RPC name, arguments and existing id/label fields.
-- Old deployed clients ignore the added field. No SQL objects depend on this RPC.
drop function public.discount_passport_options(uuid,text);
create function public.discount_passport_options(p_org uuid,p_search text default '')
returns table(id uuid,label text,email text)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.auth_manage_discounts(p_org) then raise exception 'forbidden' using errcode='42501'; end if;
 return query
 with candidates as (
   select p.id,
     coalesce(nullif(btrim(concat_ws(' ',p.first_name,p.last_name)),''),
       nullif(btrim(p.legacy_full_name),''),nullif(btrim(pr.full_name),''),
       nullif(btrim(u.raw_user_meta_data->>'full_name'),''),
       nullif(btrim(u.raw_user_meta_data->>'name'),''),'Runner') as label,
     -- Use the participant's address, never a managed Passport's booker/manager.
     case when p.claimed_user_id is not null then nullif(btrim(u.email),'')
       else nullif(btrim(p.participant_email),'') end as email
   from public.runner_passports p
   left join auth.users u on u.id=p.claimed_user_id
   left join public.profiles pr on pr.id=p.claimed_user_id
   where (u.id is not null and not u.is_anonymous and u.deleted_at is null)
     or exists(select 1 from public.registrations r where r.org_id=p_org and r.participant_passport_id=p.id)
     or exists(select 1 from public.prescreening_applications a where a.org_id=p_org and a.participant_passport_id=p.id)
 )
 select c.id,c.label,c.email from candidates c
 where position(lower(left(btrim(coalesce(p_search,'')),100))
   in lower(concat_ws(' ',c.label,c.email,c.id::text)))>0
 order by c.label,c.id limit 50;
end $$;
revoke all on function public.discount_passport_options(uuid,text) from public,anon;
grant execute on function public.discount_passport_options(uuid,text) to authenticated,service_role;

commit;
