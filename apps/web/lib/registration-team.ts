/** Team name is captured with each registration, so later passport edits do not rewrite reports. */
export function registrationTeamName(customData: Record<string, unknown> | null | undefined): string | null {
  const value = customData?.team_name;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
