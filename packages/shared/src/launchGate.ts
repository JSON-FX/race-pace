const PRODUCTION_HOSTS = new Set([
  "racepace.com.ph",
  "www.racepace.com.ph",
  "admin.racepace.com.ph",
  "race-pace-site-jayson-alananos-projects.vercel.app",
  "race-pace-web-jayson-alananos-projects.vercel.app",
]);

export function isPublicLaunchClosed(
  targetEnvironment: string | undefined,
  hostname: string,
  deploymentHostname?: string,
): boolean {
  const host = hostname.toLowerCase();
  if (PRODUCTION_HOSTS.has(host)) return true;
  if (targetEnvironment !== "production") return false;

  // Vercel Authentication protects each unique deployment URL. Keep every
  // other production host on Coming Soon, even if it is a vercel.app alias.
  return !deploymentHostname || !host.endsWith(".vercel.app") || host !== deploymentHostname.toLowerCase();
}

export function isStagingEnvironment(targetEnvironment: string | undefined, hostname: string): boolean {
  return targetEnvironment === "staging" ||
    hostname === "staging.racepace.com.ph" || hostname === "staging-admin.racepace.com.ph";
}
