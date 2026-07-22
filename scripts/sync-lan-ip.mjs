// LOCAL/OFFLINE DOCKER WORKFLOW ONLY — not needed for normal cloud dev.
// The app now targets hosted Supabase (see apps/*/.env); that URL has no ":port", so it is
// intentionally NOT a target below and can never be auto-rewritten to a LAN IP — mobile
// always stays on cloud. This only refreshes the LAN IP for `supabase functions serve`
// (supabase/functions/.env) when you run the OPTIONAL local Docker stack and reach it from a
// physical device on the same network. To deliberately point mobile at local Supabase for
// offline work, edit apps/mobile/.env by hand.
// Run: `node scripts/sync-lan-ip.mjs`
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function currentLanIp() {
  const routeOut = execFileSync("route", ["-n", "get", "default"]).toString();
  const iface = routeOut.match(/^\s*interface: (\S+)/m)?.[1];
  if (!iface) throw new Error("Could not determine the active network interface (no default route).");
  const ip = execFileSync("ipconfig", ["getifaddr", iface]).toString().trim();
  if (!ip) throw new Error(`Interface ${iface} has no IPv4 address (are you connected to a network?).`);
  return ip;
}

function replaceHost(content, key, ip) {
  const re = new RegExp(`^(${key}=https?://)[^:/\\s]+(:\\d+.*)$`, "m");
  if (!re.test(content)) return content;
  return content.replace(re, `$1${ip}$2`);
}

// apps/mobile/.env (EXPO_PUBLIC_SUPABASE_URL) is deliberately NOT here — mobile targets
// hosted Supabase and must never be repointed at local Docker automatically.
const files = [
  { path: `${ROOT}supabase/functions/.env`, keys: ["PUBLIC_APP_URL", "PUBLIC_FUNCTIONS_URL"] },
];

const ip = currentLanIp();
console.log(`Detected LAN IP: ${ip}`);

for (const { path, keys } of files) {
  let content = readFileSync(path, "utf8");
  for (const key of keys) content = replaceHost(content, key, ip);
  writeFileSync(path, content);
  console.log(`Updated ${path.replace(ROOT, "")}`);
}

console.log("Done. Restart Metro and `supabase functions serve` to pick up the change.");
