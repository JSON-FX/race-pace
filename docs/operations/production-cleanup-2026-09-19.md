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

## Final identity and tenant reset — 2026-09-20

The owner explicitly confirmed a final production reset that removed every organization, event and non-target user. The confirmed scope included deleting the Race Pace ledger record for live settled QR Ph payment `pay_oXDqw1NdFmQF3sTxELf8H51R` for ₱10.00 without issuing a refund. PayMongo retains its provider-side transaction record.

Before the reset, a new restricted snapshot was written outside the repository under `/Users/jsonse/Documents/development/race-pace-backups/production-final-reset-20260919T225408Z/`. Its public, Auth and Storage data dump has SHA-256 `18bf2d826a65052da68b3474107f3115c9c00a3d78d5ac6ebcd7730e8d65bd41`. The Storage snapshot contains 19 objects and 9,698,756 bytes with aggregate checksum `f6f6afdfa811a983647f10f0e1b8472606fc3cb5850d9963ab42362b39bb503d`.

Pending checkout `cs_1bfbfc1ba1e26f07041739f4` was expired at PayMongo before its local record was deleted. The tenant reset then removed the pilot organizer, verification event, five registrations and payments, the settled capture, all tenant notifications and email jobs, three event images, and fifteen obsolete profile images. Six non-target Auth accounts were deleted through the Auth admin API. Philippine Standard Geographic Code data, processor rates, and the email-branding asset were preserved.

Final production readback:

| Record | Count |
|---|---:|
| Auth accounts | 3 |
| Platform `super_admin` roles | 3 |
| Runner Passports | 3 |
| Organizations | 0 |
| Events | 0 |
| Categories | 0 |
| Registrations | 0 |
| Payments and captures | 0 |
| Refund requests and payout statements | 0 |
| Notifications and transactional email jobs | 0 |
| Event and profile Storage objects | 0 |
| Email-branding Storage objects | 1 |

The retained platform accounts are `jayson@racepace.com.ph`, `mondel@racepace.com.ph`, and `support.racepace@gmail.com`. Each has exactly one platform-wide `super_admin` role with no organization scope. Jayson accepted the invitation during verification. Mondel's invitation is registered and awaiting acceptance. The support account remains confirmed.
