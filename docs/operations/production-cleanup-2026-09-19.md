# Production prelaunch cleanup — 2026-09-19

Production project: `whaqarofxdlzxrelbcrq`

This cleanup removed only records that carried explicit test evidence. It did not classify records from counts or naming alone.

## Backup evidence

- Supabase physical database backup: latest completed at `2026-09-18T19:25:23.702Z`.
- Separate Storage snapshot: `production-20260919T152947Z.tar.gz`.
- Storage snapshot contains 48 objects and 14,684,658 bytes.
- Archive SHA-256: `c6305ef2ece202d0ab52cbd847f75576864c32ade9b34ff58f6c476c83ccd29e`.
- A clean extraction verified every object against its manifest SHA-256 and byte length.
- The restricted backup is stored outside the repository under `/Users/jsonse/Documents/development/race-pace-backups/`.

## Removed records

The dry run required exact IDs and asserted both PayMongo transactions were sandbox transactions with `livemode=false`.

- `[TEST] Production Sandbox Organizer` and its organization role.
- `[TEST] Production Sandbox Checkout QA Race`, category, waiver, refunded registration, sandbox payment, refund records, capture and audit history.
- `QA Readiness Road Run 2026`, whose description stated that it was a sample and not a real race, plus its category, sandbox registration, payment and audit history.
- Five notifications tied to those two events.
- The managed `Production QA Runner` Passport and its manager record.
- The banned seeded `admin@racepace.test` Auth account and its empty Passport.

No Storage object path belonged to the removed organizer, events, registration or Passport.

## Final clean-production request

After the initial scoped cleanup, the owner explicitly requested a production database with no organizations or events. The remaining `Run With Point` organization and `Pulangi Half Marathon` event were removed. Their three categories and organization-admin role were removed by the database's foreign-key cascades.

All 34 `event-images` objects and both `org-images` objects were then deleted. The verified pre-cleanup archive retains their bytes and checksums.

Four named Auth accounts, their Passports, the platform super-admin role and 12 `profile-images` objects were preserved. They are identity data outside the organization-and-event cleanup request.

## Post-cleanup readback

| Record | Count |
|---|---:|
| Auth accounts | 4 |
| Organizations | 0 |
| Events | 0 |
| Categories | 0 |
| Registrations | 0 |
| Payments | 0 |
| Refund requests | 0 |
| Payment captures | 0 |
| Notifications | 0 |
| Event and organization Storage objects | 0 |
| Profile Storage objects | 12 |

Only the named platform super-admin role remains. Production runner and admin routes still redirect to Coming Soon.
