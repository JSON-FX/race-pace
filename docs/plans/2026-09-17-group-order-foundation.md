# Group order foundation

Status: internal schema/capacity slice complete locally. Public group checkout remains pending.
Architecture: ../specs/group-checkout-architecture.md

This slice adds an internal order header, links individual registrations, and establishes a database capacity guard shared by legacy and future group inserts. The public group checkout remains disabled. No provider or refund contracts change yet.

1. Add booking_orders with organization/event/category consistency checks, booker ownership, service-only writes and scoped reads. Add nullable registration order_id with consistency enforcement. Validate with transaction tests and function grants.
2. Serialize registration capacity admission on the category row and count paid plus unexpired pending registrations, excluding the current row. Legacy and group rows use this same guard. Unchanged active entries do not consume additional capacity. Validate concurrent final-slot requests and expiry handling.
3. Expose a stable capacity error from existing checkout. Validate checkout regression suite.
4. Record constraints for the next atomic multi-registration RPC: lock category first, validate every participant, insert all lines in one transaction; block provider entry points for ordered registrations until order-aware payment handling is ready.

Tests use local fixtures and rollback/cleanup. Run root tests excluding the separate fake-provider backend test, plus affected site/admin typechecks if TypeScript changes. Do not build into the active Docker mounts. Add no hosted changes.

Validation and limitations: [.claude implementation report](../../.claude/reports/2026-09-17-group-order-foundation-report.md). Atomic public group reservation, payment attempts, allocations and refunds remain separate implementation slices.
