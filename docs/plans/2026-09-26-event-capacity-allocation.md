# Event total and category allocation

Status: implemented locally; staging verification pending.

The event's `total_event_slots` is the capacity source for reservations and registrations. Organizers set it in the Categories section for every event. Coming Soon can leave category slots unassigned. Before registration opens, category slots must sum exactly to the event total. The public Coming Soon page continues to hide capacity counts.

## Changes

1. Move the total event slots input outside the Coming Soon controls. Show allocated and unallocated category places beside it.
2. Validate the proposed category split in the editor and Server Action. Save category reductions before increases, then lower the event total when necessary.
3. Backfill existing events with a category sum only where their event total is null. Preserve existing non-null totals and all category rows.
4. Enforce `sum(category.slots_total) <= event.total_event_slots` in database triggers. Require equality when a reserved Coming Soon event opens. Prevent clearing a published total.
5. Use the event total in the admin event directory. Keep legacy null totals readable through the category sum.

## Acceptance

- A category-free Coming Soon event can reserve up to its event total.
- Draft and Coming Soon categories may be partially allocated, but cannot exceed the event total.
- Registration cannot open from a reserved Coming Soon event until allocation is complete.
- Direct database writes cannot exceed or clear the published capacity.
- Existing events retain their current category limits, registrations, and payment records.

Validate with web tests and typecheck, migration replay, backend capacity and grant tests, and staging admin review. Production promotion remains behind the hosted staging release gate.
