# Trail Roster registration layout

## Status

Approved for implementation. The source proposal is
`docs/previews/group-checkout-five-options.html`, option **Trail Roster**.

## Goal

Let an account holder choose any subset of the Race Passports they manage, assign a different
event category to each selected runner, complete each runner's required details, and reserve one
combined order. Each paid registration still receives its own QR ticket.

## Production flow

1. **Build the roster.** Select one to ten complete Race Passports and assign a category to each.
2. **Complete runner details.** Collect shirt size, event fields, add-ons, and each participant's
   personal waiver acceptance.
3. **Review and pay.** Reserve one order, review the payment, and complete one PayMongo payment.

The existing reservation, capacity, idempotency, waiver, add-on, and category validation remains
authoritative. The layout must never bypass those checks.

## Visual contract

- Maximum content width: 1160px. Desktop page padding is 36px; mobile page padding is 10px.
- The roster shell uses a white surface, 24px desktop corner radius, and a restrained soft shadow.
- The forest hero uses `#103226`, white type, a two-column layout, and 36px by 40px padding.
- The hero headline is **Build your race roster.** The event card explains that the booking uses
  one payment with separate registrations and QR tickets.
- The body is a two-column layout: roster content and a 330px sticky booking summary.
- Each runner row has a checkbox, 44px initials avatar, name and Passport relationship, status,
  and a 46px ShadCN category Select. Selected rows remain neutral with a clear selected state.
- The summary lists each selected runner, category, and entry price. Its primary action reads
  **Continue with N runner(s)**.
- Use the application's Archivo, Archivo Narrow, and JetBrains Mono font tokens. All controls use
  the existing ShadCN components and semantic focus styles.

## Responsive contract

- Below 980px, the hero and roster body become single-column. The summary is no longer sticky.
- Below 720px, the event card is hidden, padding tightens, and each category selector moves below
  the runner identity while preserving a minimum 44px touch target.
- No horizontal scrolling is allowed at 320px viewport width.
- Keyboard focus remains visible. Status changes are announced to assistive technology.
- Reduced-motion preferences disable non-essential transitions.

## Functional acceptance

- The current user's Passport is optional.
- Unselected Passports remain outside the booking.
- Each selected Passport can use a different available category.
- Category capacity updates immediately as selections change.
- Incomplete Passports cannot be selected.
- Draft selections and runner inputs survive refresh in the current session.
- Every selected participant must personally accept the event waiver.
- The final reservation payload includes the correct Passport, category, add-ons, fields, and
  waiver method for every runner.
