-- PostgreSQL cannot use a newly added enum label elsewhere in the same
-- transaction. Keep this migration separate from the event schema change.
alter type public.event_status add value if not exists 'coming_soon';
