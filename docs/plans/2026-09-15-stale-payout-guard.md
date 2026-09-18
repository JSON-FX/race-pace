# Guard stale payout settlement

Forward migration: save financial payment snapshot and statement revision at opening. Settlement locks registration/payment writes for the short database transaction, compares saved snapshot and caller-reviewed revision, and rejects changes without marking/stamping anything. Legacy calls without revision fail closed. Explicit refresh recalculates amounts and increments revision; paid statements cannot refresh. Old open statements require refresh.

Use the live aggregate and stamp bodies unchanged. Add authenticated super-admin-only refresh; snapshot helper internal only. UI sends revision and offers explicit refresh. Validate full/partial refunds, new entries, processor corrections, old dialog after refresh, replay, grants and browser flow. Table locks are deliberately conservative across events and must be measured under load before production scale. No commit or deploy.
