const PRODUCTION_HOSTS = new Set([
  "racepace.com.ph",
  "www.racepace.com.ph",
  "admin.racepace.com.ph",
  "race-pace-site-jayson-alananos-projects.vercel.app",
  "race-pace-web-jayson-alananos-projects.vercel.app",
]);

export function isPublicLaunchClosed(targetEnvironment: string | undefined, hostname: string): boolean {
  return targetEnvironment === "production" || PRODUCTION_HOSTS.has(hostname.toLowerCase());
}

export function isStagingEnvironment(targetEnvironment: string | undefined, hostname: string): boolean {
  return targetEnvironment === "staging" ||
    hostname === "staging.racepace.com.ph" || hostname === "staging-admin.racepace.com.ph";
}
