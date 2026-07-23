-- Every minute, ping send-push to drain pending device pushes. Design §7.2.
-- The service-role key is read from Supabase Vault (secret created out-of-band, see plan).
create extension if not exists pg_net;

select cron.schedule('drain-push-1min', '* * * * *', $$
  select net.http_post(
    url := 'https://ytwdrsmclwghwktpupqd.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
$$);
