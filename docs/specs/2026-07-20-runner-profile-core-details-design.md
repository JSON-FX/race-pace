# Runner Profile — Core Details (fill once, prefill everywhere) — Design Spec (runner app)

- **Status:** Approved (brainstorm 2026-07-20)
- **Owner:** Product (jayson@voltcontent.com)
- **Feeds:** superpowers:writing-plans → implementation plan
- **Relates to:** registration `form_fields` / `custom_data` (PRD §5.1 / §6); the hybrid Register flow from [04-pay-ticket-offline.md](../plans/04-pay-ticket-offline.md) and the marketplace Profile screen from [2026-07-20-marketplace-redesign.md](2026-07-20-marketplace-redesign.md) §3

## 1. Goal

Stop runners from re-typing the same stable details for every race. A runner fills their **core details once** — as a "runner passport" on their Profile — and every registration **prefills** from it. Today a runner re-enters date of birth, emergency contact, and (via per-event fields) blood type and shirt size on every single registration; a runner doing several races a year types their birthday several times.

The `profiles` table was already **designed** for this — it has `full_name, bib_name, gender, shirt_size, emergency_contact, city` — but only name/bib/city are surfaced in the UI, and the marketplace Register flow re-collects some stable attributes as per-event `form_fields`. This effort **finishes the wiring**: it makes the profile the canonical home for stable runner attributes and bridges it into the existing per-event `form_fields` system so orgs keep asking event-specific questions while stable attributes are never re-typed.

No security-model change: a signed-in user already reads and writes **their own** `profiles` row under existing RLS.

## 2. Decisions (from brainstorm)

1. **Full passport.** The runner-core set is `bib_name`, `date_of_birth`, `gender`, `shirt_size`, `blood_type`, `emergency_contact`. Two new columns (`date_of_birth`, `blood_type`); the other three columns already exist and just get surfaced. This retires the per-event **shirt-size double-ask**.
2. **Model B — known-key prefill bridge.** The profile is canonical. A shared `PROFILE_KEYS` vocabulary lets any event `form_field` whose `key` is a profile key prefill from the profile and be **suppressed** from the per-event question loop; unknown keys stay per-race. Chosen over (A) convention-only prefill and (C) a `form_fields.source` flag — C is the natural M3 graduation once the Admin web can configure fields.
3. **Snapshot + ask to save.** Each registration stores its own point-in-time snapshot in `custom_data` (past registrations never change). If a passport field was filled or edited during registration, a single **"Save to my profile?"** toggle appears — default **ON** when the profile was empty (pure gain), default **OFF** when it only edits an already-saved value (likely a one-trip override).
4. **Prefill, don't lock.** Prefilled fields stay editable at registration. Save-back **never blocks** registration — a failed profile write is logged; the registration proceeds.
5. **Waiver stays per-race.** Never moves to the profile — each event's waiver is freshly accepted (legal requirement). `first_ultra` also stays per-race.
6. **Scope:** iOS (Expo) + `@race-pace/shared` + an additive Supabase migration. Backend-compatible with the existing seed (`form_field` IDs `f1`–`f3` unchanged).

## 3. Data model changes (additive migration)

**New migration** `supabase/migrations/<ts>_runner_profile_core.sql` — two columns; `gender`, `shirt_size`, `emergency_contact` already exist:

```sql
alter table profiles
  add column if not exists date_of_birth date,
  add column if not exists blood_type text;
```

Validation lives in the shared Zod layer (matching the codebase's existing loose columns — no DB CHECKs on `gender`/`shirt_size` today), so option lists can evolve without a migration.

**Shared vocabulary** — `packages/shared/src/index.ts`, the single source of truth all surfaces import:

```ts
/** Profile-owned attributes: prefill into registration + save back (Model B bridge). */
export const PROFILE_KEYS = ["bib_name","date_of_birth","gender","shirt_size","blood_type","emergency_contact"] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];
export const isProfileKey = (k: string): k is ProfileKey => (PROFILE_KEYS as readonly string[]).includes(k);

// Canonical option lists reused by Profile + Register selects. Store plain ASCII.
export const BLOOD_TYPES = ["A+","A-","B+","B-","O+","O-","AB+","AB-","Unknown"] as const;
export const SHIRT_SIZES = ["XS","S","M","L","XL","XXL"] as const;
export const GENDERS     = ["Male","Female","Non-binary","Prefer not to say"] as const;
```

**Profile type** — `apps/mobile/lib/profile.ts` widens `Profile` to add `date_of_birth`, `gender`, `shirt_size`, `blood_type` (all `string | null`, optional); `getProfile` select and `upsertProfile` payload updated to match. `emergency_contact` already present.

## 4. Profile screen — "Race details" section

The Profile screen keeps its current shape (avatar + Save + menu + Sign out; see marketplace spec §3). Editable fields reorganize into two labelled groups:

- **Identity** (existing): `full_name`, `bib_name`
- **Race details** (new), introduced by microcopy that states the whole point:
  > *"Fill these once — we'll add them to every race you register for."*

| Field | Control | Source |
| --- | --- | --- |
| Date of birth | `YYYY-MM-DD` text input, format-validated | new column |
| Gender | pill select | `GENDERS` |
| Shirt size | pill select | `SHIRT_SIZES` |
| Blood type | pill select (wraps) | `BLOOD_TYPES` |
| Emergency contact | text input ("Name & mobile number") | existing column |

`city` stays where it is. One **Save** persists the whole profile via `upsertProfile` (unchanged call, wider payload). Pills reuse the select styling in `DynamicField`; inputs reuse the Register field styles — no new visual vocabulary, trail-green theme throughout.

**Decisions:** emergency contact stays a **single** text field (splitting into name + number changes the column shape for no MVP gain); DOB is a **text input** for now (native date picker deferred — avoids a new dependency).

## 5. Register — prefill, suppression & save-back (Model B)

Form order:

1. **① Your details (passport block)** — prefilled from the profile, all editable:
   - *Always shown:* `bib_name`, `date_of_birth`, `emergency_contact` (universal minimum for any race — as today)
   - *Shown only when the event's `form_fields` include that key:* `gender`, `shirt_size`, `blood_type` — prefilled from the profile when shown
2. **② Event questions** — the event's `form_fields` whose key is **not** a profile key (e.g. `running_club`), rendered fresh via the existing `DynamicField`
3. `first_ultra` toggle (per-race) → add-ons → waiver → **save-back toggle** → total → Register

**The bridge / suppression rule** — one filter over the event's `form_fields`:

```ts
const eventQuestions    = fields.filter(f => !isProfileKey(f.key)); // block ②
const requestedPassport = fields.filter(f =>  isProfileKey(f.key)); // → block ①, prefilled
```

A `blood_type` form_field therefore never renders as a blank question — it's answered from the profile. For profile-key fields the **canonical shared option lists win** (`BLOOD_TYPES`, `SHIRT_SIZES`), not the form_field's own `options`. Net effect: **the seed's `f1` (blood_type) / `f3` (shirt_size) stay as-is** — the client routes them to the passport block, so backend tests referencing those IDs are untouched.

**Prefill:** the existing `getProfile` effect populates all passport local state (`?? ""`), extended from today's `bib_name`/`emergency_contact` to the full set.

**Save-back** (Decision 3) — a single row above Register:

> ☐ **Save these details to my profile?**

- Visible only if some passport field was **filled-from-empty** or **edited** vs. the loaded profile.
- **Default ON** when anything was filled from empty; **default OFF** when the only changes edit already-saved values.
- On submit, if ON → `await upsertProfile(passportValues)` **then** `startCheckout`. A save-back failure is caught and logged; **registration still proceeds**.

## 6. Validation & `custom_data` snapshot

**Validation order** (extends today's rules):

1. `customDataSchema(allEventFormFields).safeParse(mergedValues)` — enforces every event-requested field; a **required profile-key field is satisfied by the prefilled value** (so an event that requires `blood_type` passes when the profile supplies it).
2. Always-core: `bib_name` and `emergency_contact` non-empty.
3. `date_of_birth`, if present, matches `YYYY-MM-DD` (empty allowed).
4. `waiver` accepted.

**Snapshot** written to `custom_data` (unchanged philosophy, wider core):

```
{ bib_name, date_of_birth, gender, shirt_size, blood_type,
  emergency_contact, first_ultra, ...eventQuestionValues }
```

`mergedValues` = the passport values (block ①) merged with the event-question values (block ②), so a single object validates and is snapshotted.

## 7. Edge cases & error handling

| Case | Behavior |
| --- | --- |
| Empty profile (new user) | Passport fields empty; runner fills them; save-back defaults **ON** → first registration is the capture moment |
| Partial profile | Prefilled where known, empty elsewhere; save-back **ON** |
| `getProfile` fails / offline | Prefill no-ops (fields start empty); runner still registers; save-back may fail → logged, never blocks |
| Profile-key field requested but profile empty | Renders empty in passport block to fill now; save-back offers to remember |
| One-trip override (edit a saved value) | Snapshot records the trip value; save-back **OFF**; profile untouched |
| `upsertProfile` write fails | Caught, logged, **registration proceeds** |
| DOB present but malformed | Inline error, blocks submit (empty DOB allowed) |
| Event-required field left blank | `customDataSchema` fails → existing "complete required fields" error |

## 8. Testing

- **Shared unit** (`packages/shared`): `isProfileKey` / `PROFILE_KEYS`; `customDataSchema` still validates a required profile-key field from merged values; option-list constants exported.
- **Profile screen** (jest-expo): renders Race details, edits fields, **Save calls `upsertProfile` with the widened payload**.
- **Register** (jest-expo): prefills the passport block from a mocked profile; **suppresses** a `blood_type` form_field from the event-questions loop (renders in passport, not as a blank question); save-back toggle **visibility + default logic** (filled-from-empty → ON; edit-existing → OFF); on submit with toggle ON → `upsertProfile` **then** `startCheckout`, and the snapshot `custom_data` carries the passport keys; save-back failure does **not** block checkout.
- **Backend** (root Vitest): existing `form_fields` / `custom_data` tests stay green (`f1`–`f3` unchanged); add a case that `custom_data` accepts profile-sourced values for a required profile-key field.

**Known test rework (for the plan):** the current `apps/mobile/__tests__/register-submit.test.tsx` drives the *old* blood-type-as-question flow (`fireEvent.press(screen.getByText("O"))`). It must be reworked for passport-block rendering — provide `blood_type` via the mocked profile (prefill) or drive the passport pills.

## 9. Out of scope (noted as future)

- **Admin web** (M3): org field editor, and the Model **C** `form_fields.source` flag as the explicit graduation of Model B.
- Native date picker (`@react-native-community/datetimepicker`) — polish.
- Splitting `emergency_contact` into name + number.
- Phone number on the profile (the "Passport + contact" scope was not chosen).
- Age-category logic derived from `date_of_birth`.

## 10. File touch-list (for writing-plans)

- **Create:** `supabase/migrations/<ts>_runner_profile_core.sql`
- **Modify:** `packages/shared/src/index.ts` (`PROFILE_KEYS`, `isProfileKey`, `BLOOD_TYPES`, `SHIRT_SIZES`, `GENDERS`) + `packages/shared/src/index.test.ts`
- **Modify:** `apps/mobile/lib/profile.ts` (widen `Profile`, `getProfile`, `upsertProfile`)
- **Modify:** `apps/mobile/app/(tabs)/profile.tsx` (Race details section)
- **Modify:** `apps/mobile/app/register/[categoryId].tsx` (passport block, suppression filter, save-back toggle, validation)
- **Possibly add:** a shared `PillSelect` component (or reuse `DynamicField` select styling) for Profile + Register
- **Modify tests:** `apps/mobile/__tests__/register-submit.test.tsx`, add `profile-screen` + `register-prefill` tests
- **Seed:** no structural change required; optionally add `blood_type`/`shirt_size` `form_fields` to more events to demo prefill
