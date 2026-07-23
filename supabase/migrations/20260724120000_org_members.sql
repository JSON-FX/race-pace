-- Org team management: add the race-kit "claiming" role. Role assignment happens
-- exclusively through the service-role `org-members` edge function (there are no
-- client write policies on user_roles), so this migration only introduces the enum
-- value. Added on its own — nothing here uses it in the same transaction, avoiding
-- Postgres's "unsafe use of new enum value" error.
alter type app_role add value if not exists 'claiming';
