import type { AddonRow } from "@/lib/events";
import type { Profile } from "@/lib/profile";

/** Kit fields the wizard can write back to the Race Passport. */
const SAVE_BACK_KEYS = ["gender", "shirt_size", "blood_type"] as const;

export const WAIVER_TEXT =
  "I understand that trail and ultra running is an inherently dangerous activity, held over remote and technical terrain, in variable weather, and often far from immediate medical care. I confirm that I am medically fit to take part and have trained appropriately for this distance.\n\n" +
  "I accept full responsibility for my own safety and assume all risks associated with the event — including injury, illness, and in extreme cases death. I agree to follow all race rules, marshal instructions, and mandatory-gear requirements, and to retire from the course if instructed or if I cannot continue safely.\n\n" +
  "To the fullest extent permitted by law, I release the organizer, its staff, volunteers, sponsors, and landowners from liability for any loss, injury, or damage arising from my participation, and I consent to receive first aid or emergency medical treatment if needed.";

/** Integer centavos throughout — never introduce a float here. */
export function totalAmount(basePrice: number, addons: AddonRow[], selectedIds: string[]): number {
  const selected = new Set(selectedIds);
  return addons.reduce((sum, a) => (selected.has(a.id) ? sum + a.price : sum), basePrice);
}

export function stepOneErrors(
  details: Record<string, string>,
  requiredKeys: string[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const k of requiredKeys) {
    if (!(details[k] ?? "").trim()) errors[k] = "This is required.";
  }
  return errors;
}

/** Mirrors apps/mobile's filledFromEmpty || editedExisting logic: offer to save
 *  when the runner supplied something the passport lacked, or changed something
 *  it had. Clearing a field is not an edit worth persisting. */
export function showSaveBack(profile: Profile | null, kit: Record<string, string>): boolean {
  return SAVE_BACK_KEYS.some((k) => {
    const existing = ((profile?.[k] as string | null) ?? "").trim();
    const next = (kit[k] ?? "").trim();
    if (!next) return false;
    return existing === "" || existing !== next;
  });
}
