# Platform users design

## Goal

Give super administrators a safe, platform-wide account directory without changing registration or payment records.

## Selected interface

The approved direction is a searchable table with a right-side inspector.

The table shows the account identity, site registration date, sign-up provider, current events, managed Race Passports, and latest payment. The inspector keeps dense history out of the table and provides three views: Overview, All events, and Race Passports.

Race Passport rows open an embedded detail view. It shows the participant avatar when a claimed account has one, current registrations, all registered events, and the latest payment.

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
