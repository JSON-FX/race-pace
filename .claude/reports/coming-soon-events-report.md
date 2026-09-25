# Coming Soon events implementation report

## Delivered locally

- Admin event editor can publish a five-field Coming Soon teaser. Reserve now and Notify me are optional. Paid reservations require an event-wide capacity, fee, and registration payment deadline.
- The runner event URL renders the approved Dossier design with optional Race Passport selection, payment logos, fee disclosure, full-screen image gallery, and no public remaining-slot count. The own Passport starts selected; managed Passports are optional. One checkout can reserve up to ten places.
- Reservation fees are separate and nonrefundable. The runner pays the event fee, organizer-specific Platform Fees, and PayMongo's method-specific pass-on processing fee at hosted checkout. The provider capture supplies the actual fee for the ledger.
- A locked event row serializes reservation and registration capacity. Each Passport holds one event place, then converts when its later entry payment confirms. An unpaid reservation expires after provider reconciliation. Opening registration after its deadline extends the held deadline by 14 days.
- One-time opening notices and reservation receipts use a retryable email outbox. Admin Payments, CSV, Registrations, event roster, Settlement, Commission, and Payouts show the separate reservation ledger.

## Validation

| Check | Result |
|---|---|
| Runner TypeScript | Passed |
| Runner tests | 479 passed |
| Runner production build | Passed |
| Admin TypeScript | Passed |
| Admin tests | 927 passed |
| Admin production build | Passed |
| Local migration replay | Five Coming Soon migrations and the newer staging featured-image migration applied |
| Backend, Edge, and shared suite | 766 passed with CI-style fake provider |
| Edge Runtime bundle check | All five new and three changed functions bundled in an isolated container |
| New function grant and organization column privilege readback | Expected anon/authenticated/service-role boundaries confirmed |
| `git diff --check` | Passed |

Local Docker payment acceptance covered one place and a separate two-Passport checkout. The latter charged ₱1,045.69: ₱1,000 reservation fees, ₱30 Platform Fees, and ₱15.69 PayMongo fee. The ledger records two held places and ₱1,000 net to the organizer. A one-place event refused a second capacity hold.

## Release boundary

The feature is committed on `codex/coming-soon-events` and rebased on current `origin/staging`. No hosted Supabase migration, Edge Function, schedule, application deployment, or payment has been changed by this work. The local Docker stack and database contain synthetic test records. Follow [the staging release checklist](../../docs/operations/coming-soon-release.md) before considering production.
