-- Event UPDATE grants predate this field and can include editors. Enforce the
-- same publishing authority even when the client bypasses the settings action.
create function public.event_guard_waiver_selection()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' and new.waiver_version_id is not distinct from old.waiver_version_id then return new; end if;
 if TG_OP='INSERT' and new.waiver_version_id is null then return new; end if;
 if auth.role() = 'service_role' then return new; end if;
 if auth.uid() is null or not (public.auth_is_super_admin() or exists(
  select 1 from public.user_roles where user_id=auth.uid() and org_id=new.org_id and role='admin'
 )) then raise exception 'not_authorized' using errcode='42501'; end if;
 if new.waiver_version_id is null then raise exception 'waiver_version_required' using errcode='22023'; end if;
 return new;
end $$;
revoke all on function public.event_guard_waiver_selection() from public,anon,authenticated;
grant execute on function public.event_guard_waiver_selection() to service_role;
create trigger event_guard_waiver_selection before insert or update of waiver_version_id on public.events
 for each row execute function public.event_guard_waiver_selection();
