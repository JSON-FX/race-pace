-- The original push worker schedule targets a retired, unrelated Supabase project.
-- Keep environment-specific HTTP workers out of migration replay; configure them
-- only after validating the destination and its dedicated credentials.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'drain-push-1min';
  end if;
end;
$$;
