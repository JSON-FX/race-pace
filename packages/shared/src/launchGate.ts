export function isStagingEnvironment(targetEnvironment: string | undefined, hostname: string): boolean {
  return targetEnvironment === "staging" ||
    hostname === "staging.racepace.com.ph" || hostname === "staging-admin.racepace.com.ph";
}
