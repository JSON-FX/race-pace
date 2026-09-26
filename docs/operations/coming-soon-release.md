# Coming Soon staging and production checklist

Coming Soon is on staging. The event-capacity correction has its own staging gate before production promotion. Production data and payments remain untouched by this feature.

## Deploy together

1. Merge the reviewed feature into `staging` after the local and pull-request checks pass. Apply migrations `20260925082111`, `20260925082112`, `20260925141000`, `20260925150000`, and `20260925160000` to the **staging** Supabase project only. The capacity correction adds `20260926090000` and `20260926091000`. The captured-payment review queue adds `20260926092000`. Check their recorded versions, grants, row-level security, and event status enum.
2. Deploy the changed functions `registrations-checkout`, `payment-session`, `payments-webhook`, and `payment-verify`. Deploy the new functions `reservation-checkout`, `reservation-verify`, `coming-soon-subscribe`, `coming-soon-delivery`, and `expire-coming-soon-reservations`. Verify the JWT settings in `supabase/config.toml` against each deployed bundle.
3. Set the correct staging `PUBLIC_SITE_URL`, PayMongo test secret, webhook secret, Resend sender, `TICKET_EMAIL_SECRET`, and `PAYMENT_EXPIRY_WORKER_SECRET` on the function project. Reuse the staging webhook endpoint; the handler routes reservation metadata to provider readback. Keep every secret inside its environment.
4. Schedule `coming-soon-delivery` with the existing ticket email worker bearer secret, and `expire-coming-soon-reservations` with the existing payment expiry worker bearer secret. A one-minute email drain and five-minute expiry sweep are suitable. Use the hosted scheduler's stored secret references; never paste bearer values into migration source. Read back both jobs and make one unauthorized request to each function to confirm rejection.
5. Deploy both Next applications at the exact staging commit. Confirm their Supabase URLs and image hosts point to staging. Check the runner and admin Vercel deployment IDs, not just branch names.

## Hosted staging exercise

- Publish a synthetic Coming Soon event with only the five required public fields. Confirm its URL, catalog placement, organizer avatar, payment logos, carousel, full-screen viewer, and no public capacity count at desktop and phone widths.
- Enable Notify me and Reserve now with one total event place. Check `/commission` terms and the method-specific fee at PayMongo's hosted test checkout. Complete one sandbox payment, then verify one paid reservation, one actual fee, one receipt job, and no ordinary registration or ticket yet.
- In a separate synthetic event with at least two places, select an own and managed Race Passport for one checkout. Verify both names, the single PayMongo test payment, per-Passport fee multiplication, separate held places, the organizer roster on Registrations, and the filtered reservation ledger and CSV on Payments. Confirm leaving managed Passports unchecked charges only for the own Passport.
- Try a second hold against the one-place event and confirm refusal without a visible slots-left count. Open registration with a category. Confirm one opening email, category choice, separate entry payment, one conversion, and an ordinary ticket. Check admin reservation roster, Payments CSV, Settlement, Platform Fees, and reservation payout figures.
- Set Total event slots outside Coming Soon. Leave categories empty while reservations are offered. Then allocate categories below the total, verify over-allocation is rejected, and complete the allocation before opening registration.
- Exercise an unpaid hosted checkout through provider-confirmed expiry. Confirm the place returns only after the provider session is expired or verified unpaid. Exercise a deadline-past registration payment in sandbox; verify the capture remains under review with no ticket or silent refund. Confirm the runner callback explains manual review and the admin Checkout reviews page lists the captured payment reference.
- Before production promotion, record the exact commit, both Vercel IDs, all eight migration versions, every function version, provider mode, worker schedules, and the observed financial readback in `launch-progress.md`. Production keeps real data only; do not create synthetic events or charges there.

## Operational review

An unresolved provider checkout, extra capture, or entry payment made after the reservation deadline keeps its place or payment in a review state. Resolve those cases against PayMongo evidence before closing a payout. Reservation fees are nonrefundable in the product flow, but provider reversals and disputes still require manual ledger review.
