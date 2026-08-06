// LOCAL/OFFLINE DOCKER WORKFLOW ONLY — not needed when targeting hosted Supabase.
//
// Refreshes this Mac's LAN IP everywhere a physical device has to reach the local Docker
// stack: `supabase functions serve` (supabase/functions/.env) and the mobile app
// (apps/mobile/.env). We build to a real iPhone via `expo run:ios --device`, where
// 127.0.0.1 would mean the phone itself — hence the LAN IP.
//
// SAFE ON HOSTED URLS: every pattern below requires an explicit ":port", and the hosted
// Supabase URL (https://<ref>.supabase.co) has none — so a checkout that is pointed at
// cloud can never be silently rewritten to a LAN IP. Commented-out lines are skipped too,
// since the key must sit at the start of the line.
//
// apps/web/.env is deliberately NOT a target: those vars are inlined into client-side JS
// and the request is made by the browser on this host, where http://127.0.0.1 is exempt
// from mixed-content blocking but http://<lan-ip> from https://admin.racepace.lan is not.
//
// NOTE: this only rewrites files. The values are read at process start — restart Metro
// (EXPO_PUBLIC_* is inlined at bundle time) and `supabase functions serve` afterwards.
//
// Run: `node scripts/sync-lan-ip.mjs`  (alias: `sync-ip`)
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
  { path: `${ROOT}supabase/functions/.env`, keys: ["PUBLIC_APP_URL", "PUBLIC_FUNCTIONS_URL"] },
  { path: `${ROOT}apps/mobile/.env`, keys: ["EXPO_PUBLIC_SUPABASE_URL"] },
];

const ip = currentLanIp();
console.log(`Detected LAN IP: ${ip}`);

for (const { path, keys } of files) {
  const before = readFileSync(path, "utf8");
  let content = before;
  const skipped = [];
  for (const key of keys) {
    const next = replaceHost(content, key, ip);
    if (next === content && !new RegExp(`^${key}=https?://[^:/\\s]+:\\d+`, "m").test(content)) skipped.push(key);
    content = next;
  }
  const name = path.replace(ROOT, "");
  if (content === before) {
    if (skipped.length < keys.length) console.log(`  ${name} — already current`);
  } else {
    writeFileSync(path, content);
    console.log(`  ${name} — rewrote ${keys.filter((k) => !skipped.includes(k)).join(", ")}`);
  }
  // A key with no ":port" is a hosted URL we must not touch — say so rather than stay silent.
  if (skipped.length) console.log(`  ${name} — left alone (no :port, so not a local URL): ${skipped.join(", ")}`);
}

console.log("Done. Restart Metro (EXPO_PUBLIC_* is inlined at bundle time) and `supabase functions serve`.");
