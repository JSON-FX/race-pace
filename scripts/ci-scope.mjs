import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const all = () => ({ site: true, web: true, shared: true, backend: true });

/** Unknown inputs run every check; skips require an explicitly understood path. */
export function classifyValidation(paths) {
  const scope = { site: false, web: false, shared: false, backend: false };
  for (const path of paths) {
    if (typeof path !== "string" || !path || path.startsWith("/") || path.split("/").includes("..")) return all();
    if (path.startsWith("apps/site/")) {
      scope.site = scope.shared = true;
      // Backend contracts import payment.ts and call the native proof verifier.
      // Configuration and library changes can alter either dependency indirectly.
      if (!/^(apps\/site\/(app|components|public)\/)/.test(path) || path.startsWith("apps/site/app/api/")) scope.backend = true;
    } else if (path.startsWith("apps/web/")) {
      scope.web = scope.shared = true;
    } else if (path.startsWith("packages/ui/")) {
      scope.site = scope.web = scope.shared = true;
    } else if (path.startsWith("packages/shared/") || path.startsWith("supabase/") || path.startsWith("test/")) {
      return all();
    } else if (/^docs\/specs\/fieldnotes-component(?:s-audit|-exceptions)\.json$/.test(path)) {
      scope.shared = true;
    } else if (/^(docs\/.*\.(md|txt)|(?:README|AGENTS|CHANGELOG)\.md|\.github\/PULL_REQUEST_TEMPLATE\.md)$/.test(path)) {
      // Only prose is excluded. Other documentation may be consumed by checks.
    } else {
      return all();
    }
  }
  return scope;
}

function main() {
  const args = process.argv.slice(2);
  let scope;
  if (args.length === 1 && args[0] === "--all") {
    scope = all();
  } else {
    if (args.length !== 4 || args[0] !== "--base" || args[2] !== "--head" || !args[1].match(/^[a-f0-9]{40}$/) || !args[3].match(/^[a-f0-9]{40}$/)) {
      throw new Error("Usage: node scripts/ci-scope.mjs --all | --base <40-character SHA> --head <40-character SHA>");
    }
    // Missing history is an error, never an empty diff that skips validation.
    const paths = execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", args[1], args[3]], { encoding: "utf8" }).split("\0").filter(Boolean);
    scope = classifyValidation(paths);
  }
  const output = Object.entries(scope).map(([name, value]) => `${name}=${value}`).join("\n") + "\n";
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  process.stdout.write(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
