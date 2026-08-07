/**
 * `registrations.custom_data` is keyed by `form_fields.key` — a machine slug
 * the organizer never sees when they build the form, and never should see when
 * they read one back. The detail modal rendered those keys raw, so an entry
 * listed `blood_type` and `emergency_relation` next to human labels like
 * "Category" and "Registered".
 *
 * Deriving the label from the key (rather than joining `form_fields`) is a
 * deliberate trade: it costs no extra query and cannot go stale when a field is
 * deactivated, at the price of showing "Emergency relation" where the organizer
 * actually wrote "Relationship to emergency contact". If exact wording matters
 * more than the round trip later, fetch `form_fields.label` for the event and
 * fall back to this.
 */

/**
 * Keys where mechanical de-slugging produces something wrong rather than
 * merely blunt. Kept short on purpose — anything that reads fine as
 * "First word lowercase rest" belongs in the generic path, not here.
 */
const OVERRIDES: Record<string, string> = {
  // "Psgc code" is an acronym the generic path would sentence-case into noise.
  city_psgc_code: "City (PSGC)",
  // Reads as a question in the form; as a label it's the relationship itself.
  emergency_relation: "Emergency contact is their",
  // Both of these are dates, and "Dob" would be the generic output for the
  // short form some organizers use.
  dob: "Date of birth",
  // The runner's own words for their club, not a Race Pace concept.
  running_club: "Running club",
};

/** `blood_type` -> "Blood type". Sentence case, not Title Case: the console
 *  writes labels the way it writes prose everywhere else. */
export function fieldLabel(key: string): string {
  const override = OVERRIDES[key];
  if (override) return override;
  const words = key.replace(/[_-]+/g, " ").trim();
  if (!words) return key;
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

/**
 * A custom field's value as text.
 *
 * `custom_data` is jsonb with no schema beyond what the wizard happened to
 * write, so every JSON type can appear here. `String(value)` — what the modal
 * did before — renders `true` for a checkbox, `null` for a cleared field, and
 * `[object Object]` for anything nested. Each of those reads as a bug to an
 * organizer looking at a runner's entry.
 */
export function fieldValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  // Checkbox fields (`type: 'checkbox'`) store a real boolean.
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value.trim() === "" ? "—" : value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
  if (Array.isArray(value)) {
    const parts = value.map(fieldValue).filter((p) => p !== "—");
    return parts.length ? parts.join(", ") : "—";
  }
  // No known field type produces an object, but jsonb permits one and a
  // silent "[object Object]" would be worse than showing the shape.
  try {
    return JSON.stringify(value);
  } catch {
    return "—";
  }
}
