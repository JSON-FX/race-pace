# Hosted permission parity

Active CLI access restored. Read-only catalog comparison: 1,347 effective permission differences (1,158 column checks, 170 table checks, 19 function checks). All were hosted=true/local=false. Many column differences are inherited table permissions, not separate grants.

Root cause: hosted provisioning grants named client roles; legacy migrations often revoke only PUBLIC. Preserve service-role differences: backend access is expected, and copying broad client grants locally would weaken the tested contract. Explicitly revoke only hosted-only anon/authenticated table privileges. Restore the policy helper auth_can_check_in_event for all calling roles locally. Slot-release remains service-only via the preceding migration.

Plan: back up hosted public schema; simulate hosted extra grants locally inside a rollback transaction; apply corrective SQL and compare client permissions; apply migrations locally; run backend suite; apply only the two reviewed pending migrations to hosted; compare catalogs and run read-only checks. No row data or RLS expressions change.

## Result

All three permission migrations applied locally and to hosted after schema backup. Local backend suite: 403 passed. PostgreSQL table REVOKE cleared scoped column privileges during local validation; follow-up migration restores notification read_at and the existing organization field allowlist. The final client permission comparison has ZERO differences across tables, columns and application functions. Remaining 159 effective checks differ only for service_role; these existing backend privileges are deliberately preserved. Hosted has the extra platform rls_auto_enable helper as recorded earlier.

CLI db push reported a post-apply pg-delta catalog-cache certificate-path warning. Direct queries confirm the grants, and migration listing confirms all 89 versions match. No row data or RLS policy definitions changed.
