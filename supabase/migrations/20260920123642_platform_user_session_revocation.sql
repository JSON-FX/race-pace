-- Native Auth bans prevent new sign-ins and refreshes, but the platform user
-- action also revokes every refresh session immediately. Existing stateless
-- access tokens remain valid until their configured expiry (currently one
-- hour), which the operator-facing confirmation states explicitly.
create function public.platform_revoke_user_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_user_id is null then
    raise exception 'user_required' using errcode = '22023';
  end if;

  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.platform_revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.platform_revoke_user_sessions(uuid) to service_role;
