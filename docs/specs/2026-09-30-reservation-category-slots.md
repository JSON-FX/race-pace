# Reservations category slots

Add a flat Card per category between the event checkout summaries and reservation roster. Show total slots left, configured capacity, general slots left, and reservation slots left. Use the existing Fieldnotes typography, semantic colors, 16px cards and responsive grid.

Availability comes from `category_availability(p_event)`. The existing capacity ledger includes active registrations, held reservation places and unreleased screening applications while counting conversions once. It also respects event capacity and reservation sales-window allocation. Checkout/payment counts cannot calculate slot availability.

The page validates event membership in the active organization before reads. Category reads filter both org and event. Event and organization changes replace the summary; roster filters leave it unchanged. Failed queries use the existing recoverable error boundary. Missing RPC rows show a dash and an unpublished message rather than zero. Disabled reservations show “Not enabled”. No categories has a compact empty state.

No migration, provider, payment, reservation mutation or new dependency. The local Storybook Reservations reference includes illustrative full, disabled, unavailable, empty and long-label states.
