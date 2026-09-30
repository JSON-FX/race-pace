# Event Reservations workspace

The owner approved the Fieldnotes Reservations prototype on September 30. Implement its four event-wide summary cards and eight-column checkout roster inside the existing org-admin shell. One row represents one checkout. Managed participants appear beneath the booking account. Organization switching invalidates the selected event before any roster read.

Summary cards show total checkouts, paid checkout count, collected amount including fees, and checkouts awaiting payment. The paid ledger remains authoritative after a reservation converts to a registration. Never duplicate money for group participants. Read actual payment timestamps and the latest applicable participant/category entry deadline. Unknown legacy categories and missing payments remain explicit.

Reuse existing authenticated Supabase reads and organization/event filters. No database migration, provider setting, payment action, or production fixture is required. Read complete event metadata in bounded database pages, then search/filter/paginate locally so summaries remain event-wide. This retains the approved interactive prototype without a new privileged aggregate endpoint. Profile lookups use deduplicated batches of 100.

Reservations follows Registrations in sidebar, command palette, and mobile More. Remove the embedded roster from Registrations, keep pre-screening approvals, and redirect existing event reservation URLs. Existing event and payment links lead to the new route.

Visual source: Storybook Hub `projects/race-pace/src/proposals/reservations/`, approved `event-selected` story. Its final reviewer resolved desktop column clipping and mobile currency wrapping. Record the source hashes on integration. Reuse official shadcn primitives and adapt Fieldnotes colors to this app's RGB token contract.
