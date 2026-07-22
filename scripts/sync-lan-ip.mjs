// Rewrites the LAN IP baked into local .env files so a physical device on the same
// network (which can't resolve 127.0.0.1 to this machine) can reach Supabase/Metro.
// Run whenever you switch networks, before starting Metro / `supabase functions serve`.
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

const files = [
  { path: `${ROOT}apps/mobile/.env`, keys: ["EXPO_PUBLIC_SUPABASE_URL"] },
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
