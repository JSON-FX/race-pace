export type RegistrationDraft = {
  /** Generated ONCE per draft and persisted with it. See the note below. */
  idempotencyKey: string;
  step: number;
  /** Step 1 — profile-key fields: bib_name, date_of_birth, gender, emergency_contact, full_name. */
  details: Record<string, string>;
  /** Step 2 — kit pills: shirt_size, blood_type. */
  kit: Record<string, string>;
  firstUltra: boolean;
  /** Step 2 — the organizer's own form_fields, keyed by field.key. */
  values: Record<string, unknown>;
  addonIds: string[];
  waiver: boolean;
  saveBack: boolean;
};

const key = (categoryId: string) => `rp:draft:${categoryId}`;

/** The idempotency key is minted here and then persisted, NEVER regenerated on
 *  load. apps/mobile can get away with `useState(() => Date.now())` because a
 *  native screen is not reloaded mid-flow; a browser tab is. Regenerating on
 *  refresh defeats the server's onConflict:"user_id,idempotency_key" upsert and
 *  produces a second pending registration. */
export function newDraft(categoryId: string): RegistrationDraft {
  return {
    idempotencyKey: `${categoryId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`,
    step: 1,
    details: {},
    kit: {},
    firstUltra: false,
    values: {},
    addonIds: [],
    waiver: false,
    saveBack: false,
  };
}

export function loadDraft(categoryId: string): RegistrationDraft | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(key(categoryId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RegistrationDraft;
  } catch {
    // Corrupted storage must never block a runner from registering.
    return null;
  }
}

export function saveDraft(categoryId: string, draft: RegistrationDraft): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key(categoryId), JSON.stringify(draft));
  } catch {
    // Private-mode quota errors are not worth failing the flow over.
  }
}

export function clearDraft(categoryId: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(key(categoryId));
}
