# Coming Soon events

## Product contract

Organizers may publish an event before its date, venue, categories, and registration details are ready. Turning on **Display as coming soon** requires only an event name, public link, discipline, hero image, and description. The public page follows the approved `docs/previews/coming-soon-event/runner-options.html#dossier-reserve` design and uses the existing event route.

The organizer may enable either or both calls to action:

- **Notify me** records a runner email and sends one message when registration first opens.
- **Reserve now** charges a nonrefundable reservation fee. The runner also pays the method-dependent PayMongo processing fee and a separate Platform Fees charge. This reservation fee is never credited toward later registration.

The organizer supplies the event's total capacity, the reservation fee, and the registration-payment deadline when reservations are enabled. The platform operator sets a distinct reservation commission on `/commission`. The runner receives one event place; they select an available category during registration. No public coming-soon surface displays the number of remaining places.

A booker may select one to ten accessible own or managed Race Passports in one reservation checkout. Each selected Passport receives one event place. The own Passport is optional. The reservation fee and Platform Fees apply for each selected place, while PayMongo calculates one fee for the shared checkout. The later registration still requires a separate entry payment for each participant.

After registration opens, the runner must complete registration and secure payment by the deadline. A paid reservation that has not converted expires then and releases its event place. An unresolved provider checkout must be reconciled or explicitly expired before its place is released. If registration has not opened by the original deadline, the deadline must be extended so the organizer does not sell an impossible promise.

## Data and security

- Add `coming_soon` to `event_status`. Persist notification and reservation toggles, event capacity, reservation amount, and reservation deadline on `events`.
- Add an organizer-specific reservation commission term. Snapshot it on each reservation payment so later edits cannot rewrite historical money.
- Persist reservations, provider attempts/captures, and notification subscriptions with `org_id`. Reads are scoped by Row Level Security. Money mutations use service-role Edge Functions and atomic Postgres functions.
- Event-level capacity counts paid reservations, unresolved reservation checkout holds, and active registrations together. A conversion transfers one held place atomically. Existing category limits still apply to the chosen category.
- PayMongo creates one bound checkout per reservation attempt. Its `pass_on_fees` calculation is authoritative for the processing charge; the runner page cannot claim that an illustrative quote is live. Signed webhooks and authenticated verify calls both use provider readback and replay-safe capture.
- Record gross, Platform Fees, actual processor fee when available, and organizer net in integer centavos. Include reservation receipts in admin payments, commission, settlement, and payout reports. Nonrefundability does not erase exceptional provider reversal or dispute records.
- Notification and receipt delivery use durable, retryable jobs. Deduplicate subscriptions and opening announcements.

## Runner and organizer behavior

- The editor shows the coming-soon toggle and conditionally reveals Reserve now and Notify me controls. It validates the five publication fields; reservation settings become required only when Reserve now is on.
- Existing gallery uploads supply the hero and carousel images. The runner gallery supports previous/next controls, thumbnails, and a keyboard-accessible full-screen viewer.
- The public page shows the organizer avatar, event facts known so far, the reservation deadline, fee breakdown, and nonrefund/expiry disclosure. Payment methods use their actual logos. The reservation button text is **Reserve now**.
- Signed-out runners can view the page. Actions require sign-in and return to the event. A runner can review their reservation, checkout status, and deadline in their account.
- Opening registration keeps the same public URL. Existing reservations remain visible and guide the runner into category selection and registration payment.
- Other event statuses, ordinary registrations, group checkout, and existing payment calculations retain their current behavior.

## Acceptance checks

1. A minimal coming-soon event publishes without a date, venue, or categories; an ordinary open event still requires its existing publication checks.
2. Two concurrent reservation requests cannot exceed event capacity. An active reservation and active registration each consume one event place, without exposing the count publicly.
3. A provider payment is confirmed once. Unknown checkout creation, late capture, mismatched amount, and webhook replay cannot create a second place or a false receipt.
4. A paid reservation converts to one normal registration and remains a separate, nonrefundable charge. Category capacity and event capacity both hold.
5. Expiry releases a place only after the deadline and provider/payment reconciliation. Registration opening after the original deadline does not invalidate reservations before runners have a real chance to register.
6. Notification opt-in sends once on opening, with no cross-organization leaks. Organizer and operator views show correct reservation and fee records.
7. Desktop, tablet, and mobile views match the approved prototype and keep all controls keyboard-accessible.
