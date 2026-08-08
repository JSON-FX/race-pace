-- Date-based registration control. Both nullable: NULL means "no deadline", so every
-- existing event keeps its current status-only behaviour with no backfill.
--
-- Deliberately NOT enforced by a scheduled job. `status` stays the organizer's manual
-- override (close early / cancel) and always wins; these dates are derived at read time
-- and re-checked server-side on write. A cron that flipped status would fail OPEN when
-- the job failed, selling slots the organizer believes are closed.
alter table events
  add column registration_closes_at timestamptz,
  add column kit_edit_closes_at     timestamptz;

comment on column events.registration_closes_at is
  'Absolute instant after which new registrations are refused. NULL = no deadline.';
comment on column events.kit_edit_closes_at is
  'Absolute instant after which runners can no longer change kit fields (shirt size). Org admins are never bound by it. NULL = no deadline.';

-- A kit cutoff earlier than the registration close would create a runner who can never
-- edit: they register on the final day into an already-frozen kit list. Make it
-- unrepresentable rather than merely validating it in the admin form.
alter table events add constraint events_kit_edit_after_reg_close check (
  kit_edit_closes_at is null or registration_closes_at is null
  or kit_edit_closes_at >= registration_closes_at
);
