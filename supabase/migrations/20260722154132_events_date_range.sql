-- Optional multi-day event support. null = single-day event, identical to
-- today's behavior — no backfill needed.
alter table events add column if not exists end_date date;
