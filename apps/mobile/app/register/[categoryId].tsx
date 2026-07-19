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
  const [idempotencyKey] = useState(() => `${categoryId}:${Date.now()}`);

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
        idempotency_key: idempotencyKey,
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
