# Coming Soon event prototype

This is a local design study. The event, organizer, prices, deadline, and generated trail photographs are illustrative. The HTML does not save events, email addresses, commercial terms, or payments.

## Views

- [Runner page, event editor, and commission](index.html)
- [Four runner layouts](runner-options.html): Field Journal, Start Line, Quiet Signal, and Current event style

The Current event style option follows the live `/events/{event-slug}` page's white navigation, full-height dark photographic hero, oversized Archivo headline, compact fact strip, green action, and dark dossier sections. It replaces distance and available-slot content with coming soon facts and reservation terms.

The Current event style hero shows an 88px sample organizer avatar beside the organizer name and uses **Reserve now** for its primary action. Its reservation form shows the actual GCash, Maya, Visa, Mastercard, and QR Ph assets copied from `apps/site/public/payments/`. The organizer mark is a fictional placeholder; the application should use the organization's uploaded logo.

Below the reservation section, the Current event style has a two-image carousel using the existing concept photos. Runners can choose thumbnails, use previous and next controls, and open a full-viewport viewer. The viewer supports image selection, arrow keys, Escape, a close button, and clicking the large image to close. A live version needs an organizer-managed event gallery in addition to the required cover image.

## Product decisions reflected here

- An information-only coming soon page needs event name, public event link, discipline, cover image, and description.
- The organizer can independently enable Reserve now and Notify me.
- Reserve now adds an organizer-set reservation fee, total event capacity, and a registration payment deadline. Reservations draw from total event capacity. The public page does not show available slots or slots left.
- A paid reservation holds one place until its deadline. The runner must complete registration and secure payment by then. Otherwise the reservation expires and the place becomes available for registration again.
- The reservation fee is a separate, non-refundable charge. It does not pay the later registration fee or issue a race ticket.
- The runner pays the reservation fee, Platform Fees, and the PayMongo fee for the chosen payment method. The prototype uses an illustrative rate card and the same integer-centavo gross-up shape as the existing event checkout. A live checkout must quote and enforce totals server-side.
- The prototype does not request a live PayMongo quote. In the current registration flow, the hosted PayMongo checkout shows the actual processing fee and final charge after the runner chooses a payment method.
- Notify me requests one email when registration opens.
- Platform administrators set reservation commission separately from registration commission on `/commission`. Runner-facing copy calls it **Platform Fees**.

The total-capacity model needs backend design before implementation. Existing registration inventory is category based, so reservation occupancy and later category allocation must agree under concurrent payments and deadline expiry.
