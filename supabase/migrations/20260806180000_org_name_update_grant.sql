-- Settings page (Task 10, admin-nextjs migration) lets an org admin rename
-- their organization, not just update its branding. 20260724130000_org_images.sql
-- granted UPDATE on organizations to authenticated scoped to (logo_url,
-- banner_url) only — a `name` update is rejected by that column-scoped grant
-- even though the RLS policy (organizations_update_branding_org_admin, same
-- migration) already permits it column-agnostically via auth_can_admin_org(id).
-- Without this, updateOrgNameAction fails in every environment built from
-- migrations (local AND hosted), not just hosted-vs-local drift.
grant update (name) on organizations to authenticated;
