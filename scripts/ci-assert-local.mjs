import { readFileSync, readdirSync } from "node:fs";
import { Client } from "pg";
import { parse } from "dotenv";

const env = parse(readFileSync(".env.local"));
const dbUrl = new URL(env.DB_URL ?? "");
if (!["127.0.0.1", "localhost"].includes(dbUrl.hostname) || dbUrl.port !== "54522") {
  throw new Error("CI database must be the isolated local Supabase instance");
}

const expected = readdirSync("supabase/migrations").filter((file) => /^\d+_.*\.sql$/.test(file)).length;
const db = new Client({ connectionString: env.DB_URL });
await db.connect();
try {
  const result = await db.query(`
    select
      (select count(*)::int from supabase_migrations.schema_migrations) as applied,
      (select count(*)::int from cron.job where jobname = 'drain-push-1min') as retired_push_jobs,
      (select count(*)::int from vault.decrypted_secrets where name = 'service_role_key') as legacy_vault_keys
  `);
  const row = result.rows[0];
  if (row.applied !== expected || row.retired_push_jobs !== 0 || row.legacy_vault_keys !== 0) {
    throw new Error(`Unsafe local replay: applied=${row.applied}/${expected}, legacy jobs=${row.retired_push_jobs}, legacy keys=${row.legacy_vault_keys}`);
  }
  process.stdout.write(`Local migration replay verified: ${expected} versions, no legacy push job or key.\n`);
} finally {
  await db.end();
}
