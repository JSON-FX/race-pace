# Gross Registration card

Status: implemented; release acceptance pending.

The owner chose total runners paid before fee deductions and refunds. Add a fifth card to Registrations named **Gross Registration**, between Paid and Retained gross. Reuse Fieldnotes card typography, border, icon and peso formatting. Its caption is **Whole event · before fees/refunds**.

The card follows only the selected event. Search, payment status, category, pagination and sorting do not affect it. Existing cards retain their current filters. The event picker resolves the event exactly as before.

The total sums original captured participant payment amounts for paid, partially refunded and refunded registrations. A group capture contributes each allocation once. Discounts are already reflected in the captured amount. Pending/failed payments, unrelated events and unauthorized tenants contribute nothing. Provider captures quarantined outside registration allocations remain outside this reporting total.

A new read-only SQL aggregate runs with caller privileges through the existing reporting view and checks organization-admin access. It returns one bigint total, avoiding page-size truncation. Amounts stay in integer centavos until display. Failed or invalid reads show **Unavailable**; a successful event without collected payments shows **₱0**.

Layout: two columns below 760px, three from 760px, five from 1200px. The suspended skeleton uses the same five-card grid. Validate desktop, tablet and mobile on hosted staging before production approval.

Release through Option B from main. This feature includes an additive database aggregate, so its benchmark covers a backend change and both conservatively selected apps. Record CI, staging, owner wait, production and total wall time separately. No production fixtures or automated payments.

Plan: [gross-registration](../../.claude/plans/gross-registration.md).
