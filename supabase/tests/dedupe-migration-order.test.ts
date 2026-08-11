import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Reviewer finding (CRITICAL, pre-merge): 20260809100100_one_registration_per_event.sql
 * runs `select public.dedupe_live_registrations();` against whatever duplicate
 * pending/paid rows already exist at the moment that migration applies — this is a
 * one-shot cleanup, its only chance to run against real pre-existing data (see that
 * file's own header). The corrected "paid always wins, then earliest" body used to live
 * in 20260809100150_dedupe_paid_wins_tiebreak.sql, a migration that SORTS AFTER 100100
 * by filename. Migrations apply strictly in filename order, so on a fresh apply (and on
 * the pending hosted push) the function 100100 actually calls is still the pre-fix
 * `order by created_at, id` body from 20260809100050 — the fix doesn't exist yet at that
 * point in the sequence. That earlier body expires a genuinely PAID registration
 * whenever an abandoned pending stub happens to have been created first, and wrongly
 * releases its slot.
 *
 * The fix was to rename the tiebreak migration so its timestamp sorts BEFORE 100100
 * (git mv to 20260809100060_dedupe_paid_wins_tiebreak.sql) — not to add a second
 * `dedupe_live_registrations()` call. A second call would not repair anything: once the
 * first (buggy) pass has already expired the paid row, only one live row remains for
 * that (event_id, user_id), so a re-run's `row_number() ... > 1` matches nothing and
 * returns 0. The only fix that actually works is ensuring the CORRECT function body is
 * the one in place the moment 100100's single call runs.
 *
 * `supabase/tests/registration-gate.test.ts`'s "dedupe winner-selection order" describe
 * block exercises the function's ROW-SELECTION LOGIC directly (paid beats an earlier
 * pending, earliest breaks a paid/paid tie) — and passed even while this bug was live,
 * because it calls whatever `dedupe_live_registrations()` happens to be installed AFTER
 * every migration has finished applying, by which point 20260809100150 (or 100060) has
 * already run its `create or replace function` and overwritten the buggy body. That
 * suite could never have caught this: the bug was never in the function's final,
 * settled behaviour — it was in what 100100 saw at the ONE MOMENT it invoked the
 * function, mid-sequence. Only a test that inspects the migration SEQUENCE ITSELF, not
 * the function's eventual body, can catch a regression back to the broken order (e.g.
 * someone renaming 20260809100060 back to a timestamp after 100100, or adding a new
 * migration between them that reintroduces the old body). This file is that test.
 */

const MIGRATIONS_DIR = join(__dirname, "..", "migrations");

// The literal statement 20260809100100 uses to invoke the one-time cleanup. Deliberately
// exact (not "any call to dedupe_live_registrations") — a second, additional invocation
// was reviewed and rejected (see header): it doesn't repair anything once the first,
// buggy pass has already expired the paid row and left only one live sibling behind.
const INVOKE_PATTERN = /select\s+public\.dedupe_live_registrations\(\s*\)\s*;/;

// The paid-always-wins-then-earliest ordering, unique to the fixed function body
// (20260809100060_dedupe_paid_wins_tiebreak.sql). The pre-fix body in
// 20260809100050_dedupe_live_registrations_fn.sql orders by `created_at, id` alone and
// does not contain this fragment.
const FIXED_ORDER_PATTERN = /order by\s*\n?\s*\(status = 'paid'\) desc, created_at, id/;

// Strip `-- ...` line comments before matching. Without this, a migration's own PROSE
// about the invocation or the fix (both of these migrations' headers quote the exact
// snippets being matched here, by design, to explain themselves) is indistinguishable
// from the real, executable statement — e.g. 20260809100060's header literally quotes
// `select public.dedupe_live_registrations();` while explaining that 100100 is the only
// place that runs it, which would otherwise make this file look like a second invoker.
function stripLineComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

function migrationFiles(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort() // filenames are timestamp-prefixed: lexical order === applied order
    .map((name) => ({ name, sql: stripLineComments(readFileSync(join(MIGRATIONS_DIR, name), "utf8")) }));
}

describe("dedupe_live_registrations migration ORDER (not just the function body)", () => {
  it("has at least one migration that fixes the winner-selection ordering, and at least one that invokes the cleanup", () => {
    const files = migrationFiles();
    const fixers = files.filter((f) => FIXED_ORDER_PATTERN.test(f.sql));
    const invokers = files.filter((f) => INVOKE_PATTERN.test(f.sql));
    // Guards the two patterns above against silently matching nothing (e.g. after an
    // unrelated reformat) and this test passing for the wrong reason.
    expect(fixers.length, "expected a migration containing the paid-wins-then-earliest order by").toBeGreaterThan(0);
    expect(invokers.length, "expected a migration that invokes the one-time cleanup").toBeGreaterThan(0);
  });

  it("applies the paid-wins-then-earliest fix BEFORE the one-time cleanup ever calls the function", () => {
    const files = migrationFiles();
    const fixers = files.filter((f) => FIXED_ORDER_PATTERN.test(f.sql));
    const invokers = files.filter((f) => INVOKE_PATTERN.test(f.sql));

    for (const invoker of invokers) {
      for (const fixer of fixers) {
        expect(
          fixer.name < invoker.name,
          `${fixer.name} (the paid-wins fix) must sort BEFORE ${invoker.name} (the one-time ` +
            "cleanup's invocation) by filename, so the corrected function body is what's " +
            "actually installed the moment the cleanup runs. If this fails, someone has " +
            "renamed/reordered a migration so the invocation runs against the pre-fix body " +
            "again — see this file's header for exactly why that silently expires a paid " +
            "registration and releases its slot.",
        ).toBe(true);
      }
    }
  });

  it("does not resort to a second invocation of the cleanup as a workaround", () => {
    // Reviewed and rejected (see header): once the buggy pass has already expired the
    // paid row, a re-run finds only one live sibling left and returns 0 — it repairs
    // nothing. The only real fix is migration ORDER. This pins the invocation to exactly
    // one call so a "just call it twice" regression is caught here too.
    const files = migrationFiles();
    const totalInvocations = files.reduce(
      (n, f) => n + (f.sql.match(new RegExp(INVOKE_PATTERN.source, "g"))?.length ?? 0),
      0,
    );
    expect(totalInvocations).toBe(1);
  });
});
