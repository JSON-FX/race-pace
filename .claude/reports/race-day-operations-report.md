# Implementation report — race-day operations

Plan: docs/plans/2026-09-16-race-day-operations.md
Branch: feature/admin-ui-changes
Status: COMPLETE LOCALLY; broader production readiness remains open.

## Delivered

Atomic check-in/undo audit and scoped history were completed earlier. User subsequently approved one complete kit per paid registration, runner-only collection, pending-refund blocking, and admin reversals with a reason.

Kit implementation includes database authorization and atomic release/reversal transactions, reviewed frozen contents, duplicate prevention, an Edge Function, scoped Race Kit staff role, admin station/search/ticket lookup/CSV, runner collected status and shirt edit locking. Role labels and denied-page wording were corrected based on browser findings. Existing refund and check-in changes were preserved.

## Evidence

- Computer walkthrough: admin release M + towel; runner Collected/locked; admin reasoned reversal; runner shirt change to L; event-scoped kit staff sign-in; signed-ticket lookup/release L; repeat scan rejected as already released; no staff reversal; Payments denied; workspace return works.
- Database retains original M release, reversal reason and corrected L release with actual staff identities. Audit includes both releases, reversal and shirt change.
- Authenticated real export route: 200 CSV, two lines (header plus matching row), correct L/towel/status/actor. Brave blocked the download at the client; the browser-download result remains unverified.
- Admin full suite 769/96 files, then final Sidebar 8/8; site full suite 349/35 files; kit/check-in/grants/team 26/26. Both typechecks and diff check passed. No fresh full backend/payment suite or production build claim.
- Local migration applied/recorded; new Edge endpoint served. No hosted mutations, live payments, commits, pushes or deployments.

## Corrections during verification

Resolved local function registration (runtime refresh), test fixture argument/cleanup mistakes, CSV duplicate blank lines, an unauthorized reverse dialog reachable by staff ticket lookup, and misleading staff/access labels. Dedicated negative tests cover other-organization access, direct mutations, forged scans, stale contents, refund states and concurrent release requests.

## Remaining release checks

Production-domain CSV download, actual staff invitation delivery/acceptance, physical scanner testing, financial report/payout reconciliation, notification reliability, and hosted/Vercel parity. Camera decoding is not implemented in the kit station; manual lookup and keyboard-scanner/paste are supported. Local test accounts and fake payments are fixtures, not evidence for those broader workflows.
