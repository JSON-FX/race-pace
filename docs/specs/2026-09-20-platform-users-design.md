# Platform users design

## Goal

Give super administrators a safe, platform-wide account directory without changing registration or payment records.

## Selected interface

The approved direction is a searchable table with a right-side inspector.

The table shows the account identity, site registration date, sign-up provider, current events, managed Race Passports, and latest payment. The inspector keeps dense history out of the table and provides three views: Overview, All events, and Race Passports.

Race Passport rows show the participant avatar when a claimed account has one. They expand in place to show current registrations, all registered events, and the latest payment.

## Passport details follow-up · 2026-09-25

The Overview and Race Passports views show the account's own Passport and every Passport it manages. Each Passport expands independently in place. The first Passport starts open so an operator sees details immediately, while the remaining rows remain compact.

Expanded details show saved identity, contact, safety, kit, and shipping fields. Empty fields say “Not provided.” Legacy values remain visible when the newer field is empty. The participant email on a managed Passport is labeled unverified; it is not an account sign-in identity. Location names come from the stored Philippine Standard Geographic Code tables, with the saved barangay code as a fallback.

The existing registration, event, and latest-payment sections stay with their Passport. The list remains read-only and available only through the super-admin-checked platform-users Edge Function.

## Account state

Only a super administrator can suspend or restore an account. The operator must confirm the change.

Suspension uses Supabase Auth's native ban. Refresh sessions are revoked immediately. Existing access tokens can remain valid until their one-hour expiry.

The action never changes registrations, payments, profiles, or Race Passports. The current operator and every super-administrator account are protected from this action.

## Data and security

The browser never receives a service-role key. A JWT-verified Edge Function rechecks the caller's `super_admin` role before listing users or changing account state.

The function reads Auth identities and joins application activity server-side. Production validation must use existing real records only. Synthetic accounts and events belong in local or staging environments.

## Rollout

Apply the migration and Edge Function to staging first. Verify authorization, listing, avatar/provider rendering, managed Passport drill-down, suspension, restoration, and data preservation there.

Promote the identical reviewed commit and migration to production only after staging passes.
