# Organization discounts

Approved September 30, 2026. Implementation is local until the staging release gates pass.

Organization admins manage regular percentage/flat codes with optional participant caps and batches of unique single-use special codes. Special codes optionally bind to a Passport and can make the organizer absorb both platform and processor fees. Scope is organization-wide, selected events, or selected categories. Coverage is entry only or the full subtotal. A 100% code always makes the entire participant entry free, including add-ons, delivery, and fees.

One code per Passport entry, one successful use of that code per Passport. Successful redemptions remain consumed after cancellation/refund. Unpaid reservations release only when there is no chargeable or uncertain provider attempt. Expiry/deactivation prevents new reservations, without invalidating existing frozen reservations. Discount application never extends the entry deadline. Percentage commission uses the discounted base; existing fixed commission caps remain. Unsupported positive balances are rejected, never rounded up or silently made free.

Group codes apply per participant. Paid participants must have one effective fee mode; mixed paid fee modes require separate bookings. Free lines can accompany either mode and receive no fees. A whole free booking confirms atomically without PayMongo. All existing capacity, waiver, pre-screening, ownership, and deadline checks apply.

Use immutable financial snapshots and organization-scoped redemption ledgers. Payments and registrations show discount code and savings, including exports and group allocations. Complimentary settlements have zero money and no fabricated provider identities. Refunds use actual discounted captured allocations.

UI extends the approved Fieldnotes system: labeled code/Apply input beside each participant summary, inline feedback and Remove, itemized savings, and Confirm free registration. Admin Discounts includes creation, batches, optional dates and Passport assignment, deactivation, usage history, and CSV. No stacking, retroactive discounts, automatic distribution, native-app code entry, or reservation-deposit discounts.
