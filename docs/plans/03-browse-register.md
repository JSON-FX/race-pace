# Browse & Register — Implementation Plan (Plan 3 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the placeholder Events tab into a working discovery + registration flow — browse an organization's events, open an event and pick a category, fill the org's **dynamic custom-field** registration form + add-ons + waiver, and submit to create a **pending registration** via the `registrations-checkout` Edge Function. Stops at "registration created (pending payment)"; the WebView payment, webhook confirmation, and ticket are Plan 4.

**Architecture:** Server data comes through **TanStack Query** over `supabase-js`, scoped to the selected org. Screens are Expo Router routes pushed on top of the tab shell: Events (list) → `event/[id]` (detail + categories) → `register/[categoryId]` (form) → `registration-created`. The registration form renders each `form_fields` row by type and validates `custom_data` with **`customDataSchema` from `@trail-ultra/shared`** — the identical schema the Edge Function enforces server-side. Submit calls the Edge Function; on success it routes to a pending-payment confirmation.

**Tech Stack:** Expo Router, `@tanstack/react-query`, `@supabase/supabase-js`, `@trail-ultra/shared` (validators), jest-expo + `@testing-library/react-native`.

## Global Constraints

- **Builds on Plans 1–2 running locally:** `supabase start` + `supabase functions serve` must be up (the seeded org is *Run With Point*, event *Apo Sky Ultra 2026*, categories 100k/50k/21k/10k, add-ons, and 3 form fields).
- **Server data via TanStack Query + `supabase-js`**, scoped to `useOrg().selectedOrgId`. Every list/detail screen handles **loading / empty / error** states.
- **Dynamic fields validated with `customDataSchema(fields)` from `@trail-ultra/shared`** — the SAME builder the `registrations-checkout` Edge Function uses. Do not re-implement validation in the app.
- **Money is integer centavos**; render with `formatPeso` from `@trail-ultra/shared`. Total = category `base_price` + Σ selected add-on prices.
- **Registration submits via `supabase.functions.invoke("registrations-checkout", ...)`** → `{ registration_id, checkout_url }`. Plan 3 **STOPS** at a "registration created (pending payment)" screen — **no WebView, no payment, no ticket** (Plan 4).
- **Expo Go compatible — no new native modules.** `date` fields use a plain `TextInput` (`YYYY-MM-DD`); the `file` field type is **out of scope for MVP** (rendered as an unsupported note, not submitted).
- **Sign-in-first / org-first** already enforced (these routes sit inside the gated tab shell).
- App tests use **jest-expo** (mock the data hooks / the checkout call, like Plan 2).

## File Structure

```
apps/mobile/
├── lib/
│   ├── events.ts            NEW — TanStack Query fetchers + hooks (events, event, categories, category, addons, form_fields)
│   └── registration.ts      NEW — startCheckout() → registrations-checkout Edge Function
├── components/
│   └── DynamicField.tsx      NEW — renders one form_fields row by type
├── app/
│   ├── _layout.tsx           MODIFY — wrap in QueryClientProvider
│   ├── (tabs)/events.tsx     REPLACE placeholder — real events list
│   ├── event/[id].tsx        NEW — event detail + category select
│   ├── register/[categoryId].tsx  NEW — registration form (fields + add-ons + waiver + total + submit)
│   └── registration-created.tsx   NEW — pending-payment confirmation (Plan 4 stub)
└── __tests__/                NEW tests per screen/module
```

---

### Task 1: TanStack Query provider + data hooks

**Files:**
- Create: `apps/mobile/lib/events.ts`
- Modify: `apps/mobile/app/_layout.tsx`
- Create: `apps/mobile/__tests__/events-hooks.test.tsx`

**Interfaces:**
- Produces `EventRow`, `CategoryRow`, `AddonRow`, `FormFieldRow` types and hooks `useEvents(orgId)`, `useEvent(id)`, `useCategories(eventId)`, `useCategory(id)`, `useAddons(eventId)`, `useFormFields(eventId)` (+ their `fetch*` functions).

- [ ] **Step 1: Install TanStack Query**

```bash
cd apps/mobile && pnpm add @tanstack/react-query && cd ../..
```

- [ ] **Step 2: Data module**

Create `apps/mobile/lib/events.ts`:
```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";

export type EventRow = {
  id: string; name: string; place: string | null; region: string | null;
  event_date: string | null; elevation_gain_m: number | null; cutoff_hours: number | null; status: string;
};
export type CategoryRow = {
  id: string; event_id: string; org_id: string; code: string; label: string;
  distance_km: number | null; base_price: number; slots_total: number; slots_taken: number;
};
export type AddonRow = { id: string; name: string; price: number };
export type FormFieldRow = {
  id: string; key: string; label: string;
  type: "text" | "number" | "select" | "checkbox" | "date" | "file";
  required: boolean; options: string[] | null; sort_order: number;
};

const EVENT_COLS = "id,name,place,region,event_date,elevation_gain_m,cutoff_hours,status";
const CAT_COLS = "id,event_id,org_id,code,label,distance_km,base_price,slots_total,slots_taken";

export async function fetchEvents(orgId: string): Promise<EventRow[]> {
  const { data, error } = await supabase.from("events").select(EVENT_COLS).eq("org_id", orgId).order("event_date");
  if (error) throw error;
  return (data ?? []) as EventRow[];
}
export function useEvents(orgId: string | null) {
  return useQuery({ queryKey: ["events", orgId], queryFn: () => fetchEvents(orgId!), enabled: !!orgId });
}

export async function fetchEvent(eventId: string): Promise<EventRow | null> {
  const { data, error } = await supabase.from("events").select(EVENT_COLS).eq("id", eventId).maybeSingle();
  if (error) throw error;
  return data as EventRow | null;
}
export function useEvent(eventId: string) {
  return useQuery({ queryKey: ["event", eventId], queryFn: () => fetchEvent(eventId) });
}

export async function fetchCategories(eventId: string): Promise<CategoryRow[]> {
  const { data, error } = await supabase.from("categories").select(CAT_COLS).eq("event_id", eventId).order("base_price", { ascending: false });
  if (error) throw error;
  return (data ?? []) as CategoryRow[];
}
export function useCategories(eventId: string) {
  return useQuery({ queryKey: ["categories", eventId], queryFn: () => fetchCategories(eventId) });
}

export async function fetchCategory(categoryId: string): Promise<CategoryRow | null> {
  const { data, error } = await supabase.from("categories").select(CAT_COLS).eq("id", categoryId).maybeSingle();
  if (error) throw error;
  return data as CategoryRow | null;
}
export function useCategory(categoryId: string) {
  return useQuery({ queryKey: ["category", categoryId], queryFn: () => fetchCategory(categoryId) });
}

export async function fetchAddons(eventId: string): Promise<AddonRow[]> {
  const { data, error } = await supabase.from("addons").select("id,name,price").eq("event_id", eventId).order("price");
  if (error) throw error;
  return (data ?? []) as AddonRow[];
}
export function useAddons(eventId: string) {
  return useQuery({ queryKey: ["addons", eventId], queryFn: () => fetchAddons(eventId) });
}

export async function fetchFormFields(eventId: string): Promise<FormFieldRow[]> {
  const { data, error } = await supabase.from("form_fields")
    .select("id,key,label,type,required,options,sort_order").eq("event_id", eventId).eq("is_active", true).order("sort_order");
  if (error) throw error;
  return (data ?? []) as FormFieldRow[];
}
export function useFormFields(eventId: string) {
  return useQuery({ queryKey: ["form_fields", eventId], queryFn: () => fetchFormFields(eventId) });
}
```

- [ ] **Step 3: Wrap the app in QueryClientProvider**

Modify `apps/mobile/app/_layout.tsx` — add the provider around the existing tree:
```tsx
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "../lib/auth";
import { OrgProvider } from "../lib/org";

const queryClient = new QueryClient();

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <AuthProvider>
          <OrgProvider>
            <Stack screenOptions={{ headerShown: false }} />
          </OrgProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 4: Failing test — a hook fetches via a QueryClient wrapper**

Create `apps/mobile/__tests__/events-hooks.test.tsx`:
```tsx
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEvents } from "../lib/events";

const order = jest.fn().mockResolvedValue({ data: [{ id: "e1", name: "Apo Sky Ultra 2026" }], error: null });
const eq = jest.fn(() => ({ order }));
const select = jest.fn(() => ({ eq }));
jest.mock("../lib/supabase", () => ({ supabase: { from: jest.fn(() => ({ select })) } }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useEvents", () => {
  it("fetches events for the org and returns them", async () => {
    const { result } = renderHook(() => useEvents("org-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: "e1", name: "Apo Sky Ultra 2026" }]);
    expect(eq).toHaveBeenCalledWith("org_id", "org-1");
  });
});
```

- [ ] **Step 5: Run — expect PASS**

```bash
cd apps/mobile && pnpm test events-hooks 2>&1 | tail -8 ; cd ../..
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): TanStack Query provider + events/categories/addons/form_fields hooks"
```

---

### Task 2: Events list screen

**Files:**
- Replace: `apps/mobile/app/(tabs)/events.tsx`
- Create: `apps/mobile/__tests__/events-screen.test.tsx`

- [ ] **Step 1: Real events list**

Replace `apps/mobile/app/(tabs)/events.tsx`:
```tsx
import { View, Text, FlatList, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useOrg } from "../../lib/org";
import { useEvents } from "../../lib/events";
import { theme } from "../../lib/theme";

export default function Events() {
  const { selectedOrgId } = useOrg();
  const { data, isLoading, isError, refetch } = useEvents(selectedOrgId);
  const router = useRouter();

  if (isLoading) return <View style={styles.center}><ActivityIndicator /></View>;
  if (isError) {
    return (
      <View style={styles.center}>
        <Pressable onPress={() => refetch()} accessibilityRole="button">
          <Text style={styles.err}>Couldn't load events. Tap to retry.</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <FlatList
      style={styles.list}
      data={data ?? []}
      keyExtractor={(e) => e.id}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      ListEmptyComponent={<Text style={styles.empty}>No events yet.</Text>}
      renderItem={({ item }) => (
        <Pressable style={styles.card} onPress={() => router.push(`/event/${item.id}`)} accessibilityRole="button">
          <Text style={styles.name}>{item.name}</Text>
          <Text style={styles.meta}>{[item.place, item.region].filter(Boolean).join(" · ")}</Text>
          <Text style={styles.meta}>
            {item.event_date ?? ""}{item.elevation_gain_m ? ` · ${item.elevation_gain_m} m gain` : ""}
          </Text>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  card: { borderWidth: 1, borderColor: theme.line, borderRadius: 14, padding: 16, marginBottom: 12 },
  name: { fontSize: 18, fontWeight: "600", color: theme.ink },
  meta: { color: theme.inkSoft, marginTop: 3, fontSize: 13 },
  empty: { color: theme.inkSoft }, err: { color: theme.stop },
});
```

- [ ] **Step 2: Failing test**

Create `apps/mobile/__tests__/events-screen.test.tsx`:
```tsx
import { render, screen, fireEvent } from "@testing-library/react-native";
import Events from "../app/(tabs)/events";

const push = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push }) }));
jest.mock("../lib/org", () => ({ useOrg: () => ({ selectedOrgId: "org-1" }) }));
jest.mock("../lib/events", () => ({
  useEvents: () => ({
    data: [{ id: "e1", name: "Apo Sky Ultra 2026", place: "Mt Apo", region: "Davao", event_date: "2026-11-14", elevation_gain_m: 4200 }],
    isLoading: false, isError: false, refetch: jest.fn(),
  }),
}));

describe("Events list", () => {
  it("renders events and navigates to detail on tap", () => {
    render(<Events />);
    expect(screen.getByText("Apo Sky Ultra 2026")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("Apo Sky Ultra 2026"));
    expect(push).toHaveBeenCalledWith("/event/e1");
  });
});
```

- [ ] **Step 3: Run — expect PASS**

```bash
cd apps/mobile && pnpm test events-screen 2>&1 | tail -8 ; cd ../..
```

- [ ] **Step 4: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): events list screen (Events tab)"
```

---

### Task 3: Event detail + category select

**Files:**
- Create: `apps/mobile/app/event/[id].tsx`
- Create: `apps/mobile/__tests__/event-detail.test.tsx`

- [ ] **Step 1: Screen**

Create `apps/mobile/app/event/[id].tsx`:
```tsx
import { View, Text, FlatList, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { formatPeso } from "@trail-ultra/shared";
import { useEvent, useCategories } from "../../lib/events";
import { theme } from "../../lib/theme";

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const ev = useEvent(id);
  const cats = useCategories(id);

  if (ev.isLoading || cats.isLoading) return <View style={styles.center}><ActivityIndicator /></View>;

  return (
    <View style={styles.c}>
      <Pressable onPress={() => router.back()} accessibilityRole="button"><Text style={styles.back}>‹ Events</Text></Pressable>
      <Text style={styles.h}>{ev.data?.name ?? "Event"}</Text>
      <Text style={styles.meta}>{[ev.data?.place, ev.data?.region].filter(Boolean).join(" · ")}</Text>
      <Text style={styles.section}>Pick a distance</Text>
      <FlatList
        data={cats.data ?? []}
        keyExtractor={(c) => c.id}
        ListEmptyComponent={<Text style={styles.meta}>No categories open.</Text>}
        renderItem={({ item }) => {
          const left = item.slots_total - item.slots_taken;
          const soldOut = left <= 0;
          return (
            <Pressable
              style={[styles.cat, soldOut && styles.catDisabled]}
              disabled={soldOut}
              onPress={() => router.push(`/register/${item.id}`)}
              accessibilityRole="button"
            >
              <View>
                <Text style={styles.catLabel}>{item.label}</Text>
                <Text style={styles.meta}>{soldOut ? "Sold out" : `${left} slots left`}</Text>
              </View>
              <Text style={styles.price}>{formatPeso(item.base_price)}</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: "#fff", padding: 20, paddingTop: 12 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  back: { color: theme.pine, marginBottom: 8, fontSize: 15 },
  h: { fontSize: 24, fontWeight: "700", color: theme.ink },
  meta: { color: theme.inkSoft, marginTop: 3, fontSize: 13 },
  section: { fontSize: 16, fontWeight: "600", marginTop: 18, marginBottom: 10, color: theme.ink },
  cat: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderWidth: 1, borderColor: theme.line, borderRadius: 12, padding: 16, marginBottom: 10 },
  catDisabled: { opacity: 0.45 },
  catLabel: { fontSize: 17, fontWeight: "600", color: theme.ink },
  price: { fontSize: 16, fontWeight: "700", color: theme.pine },
});
```

- [ ] **Step 2: Failing test**

Create `apps/mobile/__tests__/event-detail.test.tsx`:
```tsx
import { render, screen, fireEvent } from "@testing-library/react-native";
import EventDetail from "../app/event/[id]";

const push = jest.fn();
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ id: "e1" }), useRouter: () => ({ push, back: jest.fn() }) }));
jest.mock("../lib/events", () => ({
  useEvent: () => ({ data: { name: "Apo Sky Ultra 2026", place: "Mt Apo", region: "Davao" }, isLoading: false }),
  useCategories: () => ({ data: [
    { id: "c3", label: "21K", base_price: 150000, slots_total: 200, slots_taken: 0 },
    { id: "c4", label: "10K", base_price: 100000, slots_total: 200, slots_taken: 200 },
  ], isLoading: false }),
}));

describe("EventDetail", () => {
  it("shows categories with peso prices and sold-out state, and routes to register", () => {
    render(<EventDetail />);
    expect(screen.getByText("21K")).toBeOnTheScreen();
    expect(screen.getByText("₱1,500.00")).toBeOnTheScreen();
    expect(screen.getByText("Sold out")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("21K"));
    expect(push).toHaveBeenCalledWith("/register/c3");
  });
});
```

- [ ] **Step 3: Run — expect PASS**

```bash
cd apps/mobile && pnpm test event-detail 2>&1 | tail -8 ; cd ../..
```

- [ ] **Step 4: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): event detail + category select"
```

---

### Task 4: DynamicField component + registration form scaffold

**Files:**
- Create: `apps/mobile/components/DynamicField.tsx`
- Create: `apps/mobile/app/register/[categoryId].tsx` (first version — fields + validation; add-ons/submit added in Task 5)
- Create: `apps/mobile/__tests__/dynamic-field.test.tsx`

**Interfaces:**
- Produces `DynamicField` ({ field, value, onChange }) rendering by type; the register screen collects `custom_data`.

- [ ] **Step 1: DynamicField**

Create `apps/mobile/components/DynamicField.tsx`:
```tsx
import { View, Text, TextInput, Switch, Pressable, StyleSheet } from "react-native";
import type { FormFieldRow } from "../lib/events";
import { theme } from "../lib/theme";

export function DynamicField({ field, value, onChange }: {
  field: FormFieldRow; value: unknown; onChange: (v: unknown) => void;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{field.label}{field.required ? " *" : ""}</Text>
      {(field.type === "text" || field.type === "date") && (
        <TextInput
          style={styles.input}
          value={(value as string) ?? ""}
          onChangeText={onChange}
          placeholder={field.type === "date" ? "YYYY-MM-DD" : ""}
          autoCapitalize="none"
          accessibilityLabel={field.label}
        />
      )}
      {field.type === "number" && (
        <TextInput
          style={styles.input}
          keyboardType="numeric"
          value={value != null ? String(value) : ""}
          onChangeText={(t) => onChange(t === "" ? undefined : Number(t))}
          accessibilityLabel={field.label}
        />
      )}
      {field.type === "checkbox" && (
        <Switch value={!!value} onValueChange={onChange} accessibilityLabel={field.label} />
      )}
      {field.type === "select" && (
        <View style={styles.options}>
          {(field.options ?? []).map((opt) => (
            <Pressable
              key={opt}
              onPress={() => onChange(opt)}
              style={[styles.opt, value === opt && styles.optActive]}
              accessibilityRole="button"
            >
              <Text style={[styles.optText, value === opt && styles.optTextActive]}>{opt}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {field.type === "file" && (
        <Text style={styles.note}>File uploads aren't supported yet.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: "600", color: theme.ink, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: theme.line, borderRadius: 10, padding: 12, fontSize: 16 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  opt: { borderWidth: 1, borderColor: theme.line, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  optActive: { backgroundColor: theme.pine, borderColor: theme.pine },
  optText: { color: theme.ink }, optTextActive: { color: "#fff", fontWeight: "600" },
  note: { color: theme.inkSoft, fontStyle: "italic" },
});
```

- [ ] **Step 2: Register screen (fields + validation only for now)**

Create `apps/mobile/app/register/[categoryId].tsx`:
```tsx
import { useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { customDataSchema, type FormField } from "@trail-ultra/shared";
import { useCategory, useFormFields } from "../../lib/events";
import { DynamicField } from "../../components/DynamicField";
import { theme } from "../../lib/theme";

export default function Register() {
  const { categoryId } = useLocalSearchParams<{ categoryId: string }>();
  const router = useRouter();
  const cat = useCategory(categoryId);
  const eventId = cat.data?.event_id ?? "";
  const fields = useFormFields(eventId);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);

  if (cat.isLoading || (eventId && fields.isLoading)) return <View style={styles.center}><ActivityIndicator /></View>;

  const fieldRows = fields.data ?? [];
  const asFormFields: FormField[] = fieldRows.map((f) => ({
    key: f.key, label: f.label, type: f.type, required: f.required, options: f.options ?? undefined,
  }));

  function validate() {
    const parsed = customDataSchema(asFormFields).safeParse(values);
    if (!parsed.success) { setError("Please complete the required fields correctly."); return false; }
    setError(null);
    return true;
  }

  return (
    <ScrollView style={styles.c} contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
      <Pressable onPress={() => router.back()} accessibilityRole="button"><Text style={styles.back}>‹ Back</Text></Pressable>
      <Text style={styles.h}>Register — {cat.data?.label}</Text>
      {fieldRows.map((f) => (
        <DynamicField key={f.id} field={f} value={values[f.key]} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
      ))}
      {error ? <Text style={styles.err}>{error}</Text> : null}
      {/* Add-ons, waiver, total, and Submit are wired in Task 5. */}
      <Pressable style={styles.btn} onPress={validate} accessibilityRole="button" accessibilityLabel="Validate">
        <Text style={styles.btnT}>Continue</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  back: { color: theme.pine, marginBottom: 8, fontSize: 15 },
  h: { fontSize: 22, fontWeight: "700", color: theme.ink, marginBottom: 16 },
  err: { color: theme.stop, marginBottom: 8 },
  btn: { backgroundColor: theme.pine, borderRadius: 12, padding: 15, alignItems: "center", marginTop: 8 },
  btnT: { color: "#fff", fontWeight: "600", fontSize: 16 },
});
```

- [ ] **Step 3: Failing test — DynamicField select + validation**

Create `apps/mobile/__tests__/dynamic-field.test.tsx`:
```tsx
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { DynamicField } from "../components/DynamicField";
import type { FormFieldRow } from "../lib/events";

const bloodType: FormFieldRow = { id: "f1", key: "blood_type", label: "Blood type", type: "select", required: true, options: ["A", "O"], sort_order: 1 };

function Harness() {
  const [v, setV] = useState<unknown>(undefined);
  return <DynamicField field={bloodType} value={v} onChange={setV} />;
}

describe("DynamicField select", () => {
  it("renders options and selects one", () => {
    render(<Harness />);
    expect(screen.getByText("Blood type *")).toBeOnTheScreen();
    fireEvent.press(screen.getByText("O"));
    // selecting marks it; a second render shows it still present (smoke of interaction)
    expect(screen.getByText("O")).toBeOnTheScreen();
  });
});
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd apps/mobile && pnpm test dynamic-field 2>&1 | tail -8 ; cd ../..
```

- [ ] **Step 5: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): dynamic form field component + registration form scaffold"
```

---

### Task 5: Add-ons, waiver, total, and submit → checkout

**Files:**
- Create: `apps/mobile/lib/registration.ts`
- Modify: `apps/mobile/app/register/[categoryId].tsx` (add add-ons + waiver + total + submit)
- Create: `apps/mobile/app/registration-created.tsx`
- Create: `apps/mobile/__tests__/register-submit.test.tsx`

**Interfaces:**
- Consumes `useCategory`, `useFormFields`, `useAddons`, `customDataSchema`, `registrationInputSchema`.
- Produces `startCheckout(input) → { registration_id, checkout_url }`.

- [ ] **Step 1: Checkout call**

Create `apps/mobile/lib/registration.ts`:
```ts
import { supabase } from "./supabase";
import type { RegistrationInput } from "@trail-ultra/shared";

export type CheckoutResult = { registration_id: string; checkout_url: string };

export async function startCheckout(input: RegistrationInput): Promise<CheckoutResult> {
  const { data, error } = await supabase.functions.invoke("registrations-checkout", { body: input });
  if (error) throw new Error(error.message ?? "Checkout failed");
  if (!data || (data as { error?: string }).error) {
    throw new Error((data as { error?: string })?.error ?? "Checkout failed");
  }
  return data as CheckoutResult;
}
```

- [ ] **Step 2: Finish the register screen**

Replace `apps/mobile/app/register/[categoryId].tsx` with the full version (adds add-ons, waiver, total, submit):
```tsx
import { useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, Switch, ActivityIndicator, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { customDataSchema, formatPeso, type FormField } from "@trail-ultra/shared";
import { useCategory, useFormFields, useAddons } from "../../lib/events";
import { startCheckout } from "../../lib/registration";
import { DynamicField } from "../../components/DynamicField";
import { theme } from "../../lib/theme";

export default function Register() {
  const { categoryId } = useLocalSearchParams<{ categoryId: string }>();
  const router = useRouter();
  const cat = useCategory(categoryId);
  const eventId = cat.data?.event_id ?? "";
  const fields = useFormFields(eventId);
  const addons = useAddons(eventId);

  const [values, setValues] = useState<Record<string, unknown>>({});
  const [selectedAddons, setSelectedAddons] = useState<Record<string, boolean>>({});
  const [waiver, setWaiver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const total = useMemo(() => {
    const base = cat.data?.base_price ?? 0;
    const addonTotal = (addons.data ?? []).filter((a) => selectedAddons[a.id]).reduce((s, a) => s + a.price, 0);
    return base + addonTotal;
  }, [cat.data, addons.data, selectedAddons]);

  if (cat.isLoading || (eventId && fields.isLoading)) return <View style={styles.center}><ActivityIndicator /></View>;

  const fieldRows = fields.data ?? [];
  const asFormFields: FormField[] = fieldRows.map((f) => ({
    key: f.key, label: f.label, type: f.type, required: f.required, options: f.options ?? undefined,
  }));

  async function submit() {
    const parsed = customDataSchema(asFormFields).safeParse(values);
    if (!parsed.success) { setError("Please complete the required fields correctly."); return; }
    if (!waiver) { setError("You must accept the waiver."); return; }
    setError(null); setBusy(true);
    try {
      const res = await startCheckout({
        event_id: eventId,
        category_id: categoryId,
        addon_ids: Object.keys(selectedAddons).filter((id) => selectedAddons[id]),
        custom_data: values,
        waiver_accepted: true,
        idempotency_key: `${categoryId}:${Date.now()}`,
      });
      router.replace({ pathname: "/registration-created", params: { rid: res.registration_id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.c} contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
      <Pressable onPress={() => router.back()} accessibilityRole="button"><Text style={styles.back}>‹ Back</Text></Pressable>
      <Text style={styles.h}>Register — {cat.data?.label}</Text>

      {fieldRows.map((f) => (
        <DynamicField key={f.id} field={f} value={values[f.key]} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
      ))}

      {(addons.data ?? []).length > 0 && <Text style={styles.section}>Add-ons</Text>}
      {(addons.data ?? []).map((a) => (
        <Pressable key={a.id} style={styles.row} onPress={() => setSelectedAddons((s) => ({ ...s, [a.id]: !s[a.id] }))} accessibilityRole="button">
          <Text style={styles.rowText}>{a.name}</Text>
          <Text style={styles.rowRight}>{formatPeso(a.price)}  {selectedAddons[a.id] ? "✓" : "＋"}</Text>
        </Pressable>
      ))}

      <View style={styles.waiver}>
        <Switch value={waiver} onValueChange={setWaiver} accessibilityLabel="Accept waiver" />
        <Text style={styles.waiverText}>I accept the event waiver.</Text>
      </View>

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalValue}>{formatPeso(total)}</Text>
      </View>

      {error ? <Text style={styles.err}>{error}</Text> : null}

      <Pressable style={[styles.btn, busy && { opacity: 0.6 }]} disabled={busy} onPress={submit} accessibilityRole="button">
        <Text style={styles.btnT}>{busy ? "Submitting…" : "Register"}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  back: { color: theme.pine, marginBottom: 8, fontSize: 15 },
  h: { fontSize: 22, fontWeight: "700", color: theme.ink, marginBottom: 16 },
  section: { fontSize: 16, fontWeight: "600", marginTop: 8, marginBottom: 10, color: theme.ink },
  row: { flexDirection: "row", justifyContent: "space-between", borderWidth: 1, borderColor: theme.line, borderRadius: 10, padding: 14, marginBottom: 8 },
  rowText: { color: theme.ink }, rowRight: { color: theme.inkSoft },
  waiver: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  waiverText: { color: theme.ink },
  totalRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 18, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.line },
  totalLabel: { fontSize: 16, fontWeight: "600", color: theme.ink },
  totalValue: { fontSize: 18, fontWeight: "700", color: theme.pine },
  err: { color: theme.stop, marginTop: 12 },
  btn: { backgroundColor: theme.pine, borderRadius: 12, padding: 15, alignItems: "center", marginTop: 18 },
  btnT: { color: "#fff", fontWeight: "600", fontSize: 16 },
});
```

- [ ] **Step 3: Confirmation screen**

Create `apps/mobile/app/registration-created.tsx`:
```tsx
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { theme } from "../lib/theme";

export default function RegistrationCreated() {
  const { rid } = useLocalSearchParams<{ rid: string }>();
  const router = useRouter();
  return (
    <View style={styles.c}>
      <Text style={styles.h}>You're registered</Text>
      <Text style={styles.sub}>Registration created and pending payment.</Text>
      <Text style={styles.rid}>Ref: {rid}</Text>
      <Text style={styles.note}>Payment and your race ticket arrive in Plan 4.</Text>
      <Pressable style={styles.btn} onPress={() => router.replace("/(tabs)/events")} accessibilityRole="button">
        <Text style={styles.btnT}>Back to events</Text>
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: "#fff", justifyContent: "center", alignItems: "center", padding: 28, gap: 8 },
  h: { fontSize: 26, fontWeight: "700", color: theme.pine },
  sub: { color: theme.ink, fontSize: 15 },
  rid: { color: theme.inkSoft, fontFamily: "Courier", marginTop: 4 },
  note: { color: theme.inkSoft, textAlign: "center", marginTop: 8 },
  btn: { backgroundColor: theme.pine, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 22, marginTop: 20 },
  btnT: { color: "#fff", fontWeight: "600", fontSize: 16 },
});
```

- [ ] **Step 4: Failing test — submit validates, calls checkout, navigates**

Create `apps/mobile/__tests__/register-submit.test.tsx`:
```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";
import Register from "../app/register/[categoryId]";

const replace = jest.fn();
const startCheckout = jest.fn().mockResolvedValue({ registration_id: "r1", checkout_url: "http://x/dev/pay/r1" });
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ categoryId: "c3" }), useRouter: () => ({ replace, back: jest.fn() }) }));
jest.mock("../lib/registration", () => ({ startCheckout: (...a: unknown[]) => startCheckout(...a) }));
jest.mock("../lib/events", () => ({
  useCategory: () => ({ data: { id: "c3", event_id: "e1", label: "21K", base_price: 150000 }, isLoading: false }),
  useFormFields: () => ({ data: [
    { id: "f1", key: "blood_type", label: "Blood type", type: "select", required: true, options: ["A", "O"], sort_order: 1 },
  ], isLoading: false }),
  useAddons: () => ({ data: [{ id: "d1", name: "Singlet", price: 60000 }], isLoading: false }),
}));

describe("Register submit", () => {
  it("blocks without waiver, then submits valid data to checkout", async () => {
    render(<Register />);
    fireEvent.press(screen.getByText("O"));                 // pick blood type
    fireEvent.press(screen.getByText("Register"));          // waiver not accepted yet
    await waitFor(() => expect(screen.getByText("You must accept the waiver.")).toBeOnTheScreen());
    fireEvent(screen.getByLabelText("Accept waiver"), "valueChange", true);
    fireEvent.press(screen.getByText("Register"));
    await waitFor(() => expect(startCheckout).toHaveBeenCalled());
    const arg = startCheckout.mock.calls[0][0];
    expect(arg).toMatchObject({ event_id: "e1", category_id: "c3", custom_data: { blood_type: "O" }, waiver_accepted: true });
    expect(replace).toHaveBeenCalledWith({ pathname: "/registration-created", params: { rid: "r1" } });
  });
});
```

- [ ] **Step 5: Run — expect PASS**

```bash
cd apps/mobile && pnpm test register-submit 2>&1 | tail -10 ; cd ../..
```

- [ ] **Step 6: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): registration form add-ons/waiver/total + submit to checkout Edge Function"
```

---

### Task 6: Wire-up, full suite, and manual acceptance

- [ ] **Step 1: Full mobile suite green**

```bash
cd apps/mobile && pnpm test 2>&1 | tail -8 ; cd ../..
```
Expected: all suites pass (Plan 2's + the new ones).

- [ ] **Step 2: Manual acceptance** (backend up: `supabase start` + `functions serve`; app: `cd apps/mobile && npx expo start`, press `i`)

Signed in with an org selected:
1. **Events** tab now lists *Apo Sky Ultra 2026*.
2. Tap it → **event detail** shows 100K/50K/21K/10K with peso prices; 10K/others show slots.
3. Tap **21K** → **register** form shows the org's fields (Blood type select, Running club text, Shirt size select), the **Singlet / Finisher** add-ons, a waiver switch, and a live **Total** that updates when you toggle add-ons.
4. Try **Register** without the waiver → blocked; with an invalid/empty required select → blocked (same rule the server enforces).
5. Complete it + accept waiver → **Register** → lands on **"You're registered (pending payment)"** with a Ref id.
6. Confirm the pending row exists: in Studio (`http://127.0.0.1:54523`) the `registrations` table has a new `status = pending` row with your `custom_data`; the `payments` table has a matching pending row.

- [ ] **Step 3: Commit any wire-up fixes**

```bash
git add apps/mobile
git commit -m "chore(mobile): Plan 3 browse & register verified end-to-end"
```

---

## Self-Review

**Spec coverage** (against `01-mobile-ios-mvp.md` §5 rows 3–7 + §8):
- Browse an org's events → Task 2. ✓
- Event detail + category select (live slots, peso prices) → Task 3. ✓
- Register: core... + **dynamic custom fields** + add-ons → Tasks 4–5. ✓
- Waiver + review (inline total) → Task 5. ✓
- Custom fields validated with `@trail-ultra/shared` (client == server) → Tasks 4–5. ✓
- Submit → pending registration via `registrations-checkout` → Task 5. ✓
- **Deferred to Plan 4 (documented):** Pay (WebView) → Pending → Confirmed → Ticket, and `file` field type + a dedicated review screen (merged inline for MVP).

**Placeholder scan:** No TBD/TODO; the register screen's Task-4 version is an explicit interim replaced in Task 5 (labeled).

**Type consistency:** `EventRow`/`CategoryRow`/`AddonRow`/`FormFieldRow`, the `use*` hooks, `startCheckout`, `DynamicField`, `customDataSchema`/`formatPeso`/`RegistrationInput` (from `@trail-ultra/shared`), and route hrefs (`/event/[id]`, `/register/[categoryId]`, `/registration-created`) are used consistently across tasks.

---

## Execution Handoff

Plan 3 of 4. Requires Plans 1–2 running locally. On completion, **Plan 4 — Pay · confirm · ticket · offline** replaces the "registration created (pending payment)" stub with the WebView checkout → webhook confirmation → offline QR ticket, and fills the My Races tab.
