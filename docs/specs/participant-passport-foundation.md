# Participant identity foundation

Implemented locally on 2026-09-16. This is the first checkpoint of the assisted-registration plan, not activation of assisted checkout.

## Identity and access

`runner_passports` separates a runner from their login. `claimed_user_id` is nullable and unique. Non-members have no Auth account. `passport_managers` grants a helper access to an explicitly created Passport. Creation uses an authenticated RPC with a stable request UUID; concurrent retries return one record. A collision cannot grant access to someone else's Passport. Revoked management cannot be restored through replay.

Authenticated clients can read their own or managed Passports and update only the listed personal fields. They cannot insert management grants, change ownership or delete Passports. Organizer and marshal roles have no global Passport access. Organization-scoped registration snapshots remain their existing read boundary.

Account creation provisions an empty self Passport. Existing accounts were backfilled without guessing split names. Legacy full names, bib names, gender and emergency-contact values are preserved separately. New team names are not populated from old bib names. Personal email is optional and never proof of ownership.

The shared completeness contract requires split names, birth date, Male/Female, reachable phone and separate emergency name/phone/relationship. Shared household phone numbers are allowed. Draft Passports may be incomplete. Checkout enforcement and the editor are still pending; the new contract does not falsely mark legacy records complete.

## Compatibility boundary

Registrations gain additive `participant_passport_id` and `booked_by_user_id` references. Existing rows and new self registrations populate both. A database bridge rejects participant/booker overrides until the checkout cutover is complete. Existing `user_id`, event/user uniqueness, payment records, ticket tokens and registration IDs retain their original meaning.

This prevents a partially migrated client from creating an assisted entry whose payment authorization, email delivery or race history would still identify the helper as the runner.

## Consumer cutover checklist

- Checkout duplicate lookup, idempotency constraint and payment confirmation: replace account-based participant checks atomically.
- Registration page/wizard and drafts: select Passport, require completeness, scope drafts to actor and participant.
- Payment session/verification: authorize booker and preserve payer identity separately.
- Ticket retrieval and email: authorize managed booking access and deliver to the verified booking contact.
- Runner history/career: count participant entries, not all entries booked by the account.
- Admin registrations, exports, kit release and check-in: use participant snapshots without exposing unrelated Passports.
- Waiver/privacy documents: publish immutable organizer versions and record the actual acceptance capacity.
- Claiming: controlled ownership verification and explicit management policy. No email/name matching.

## Remaining release decisions

The organizer's assisted acceptance policy, claim verification procedure, privacy notice and retention ownership remain unresolved. No legal text or retention period is invented by this foundation. Shipping/PSGC data, waiver records and optional check-in settings will follow in their respective slices. Nothing in this checkpoint is deployed to hosted Supabase or Vercel.

## Editor and address implementation

The profile now hosts a self/managed Passport editor. A compatibility trigger updates only the claimed runner's legacy profile fields after Passport edits. It preserves bib names and leaves helper profiles untouched for unclaimed participants.

Shipping stores a barangay reference, four-digit ZIP string and house/building/street line. Region, province and municipality derive from the authoritative local foreign-key chain rather than user-submitted labels. Registration snapshots still need to copy these labels at checkout. All address values may be absent; a supplied address must be complete. No delivery selection, courier or fee is introduced.

The local barangay snapshot extends the existing PSGC API dataset. Validate/refresh the reference against the current approved PSA release before launch. Server checkout completeness and the new registration UI are the next integration step.

## Adult acceptance direction

Proceed with personal participant acceptance on the helper device. Preserve the helper as booking actor, not as the accepting participant. Organizer waiver publishing is implemented locally; event binding and acceptance evidence are not yet active.

## Assisted local cutover

The earlier self-only bridge has been replaced by checked participant/booker binding. Unclaimed managed Passports can register for configured events after personal acceptance on the helper device. user_id stays the participant account and is null for guests. Participant-based uniqueness, booking-based retries and separate helper history are active locally. This is not a hosted launch or completed end-to-end release verification.
