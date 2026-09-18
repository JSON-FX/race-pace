import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "dotenv";

/** Match the file passed to local functions serve. Never sign fixture callbacks
 * for a hosted API or replace its provider key just to satisfy a test. */
export function localWebhookSigner(
  apiUrl: string,
  envFile = process.env.SUPABASE_FUNCTIONS_ENV_FILE ?? "supabase/functions/.env",
) {
  const target = new URL(apiUrl);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname)) {
    throw new Error("Webhook fixture signing requires a loopback Supabase API.");
  }
  let secret: string | undefined;
  try {
    secret = parse(readFileSync(envFile)).PAYMONGO_WEBHOOK_SECRET;
  } catch {
    throw new Error("Cannot read local functions environment. Set SUPABASE_FUNCTIONS_ENV_FILE to the file used by functions serve.");
  }
  if (!secret?.trim()) {
    throw new Error("Local functions environment is missing PAYMONGO_WEBHOOK_SECRET.");
  }
  return (rawBody: string): string => {
    const t = Math.floor(Date.now() / 1000).toString();
    const sig = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
    return `t=${t},te=${sig}`;
  };
}
