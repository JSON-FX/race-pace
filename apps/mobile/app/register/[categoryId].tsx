import { useEffect, useMemo, useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { customDataSchema, formatPeso, type FormField } from "@race-pace/shared";
import { useCategory, useFormFields, useAddons } from "../../lib/events";
import { startCheckout } from "../../lib/registration";
import { getProfile } from "../../lib/profile";
import { useAuth } from "../../lib/auth";
import { DynamicField } from "../../components/DynamicField";
import { theme } from "../../lib/theme";

export default function Register() {
  const { categoryId } = useLocalSearchParams<{ categoryId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const cat = useCategory(categoryId);
  const eventId = cat.data?.event_id ?? "";
  const fields = useFormFields(eventId);
  const addons = useAddons(eventId);

  const [bibName, setBibName] = useState("");
  const [dob, setDob] = useState("");
  const [emergency, setEmergency] = useState("");
  const [firstUltra, setFirstUltra] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [selectedAddons, setSelectedAddons] = useState<Record<string, boolean>>({});
  const [waiver, setWaiver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [idempotencyKey] = useState(() => `${categoryId}:${Date.now()}`);

  // Prefill the core fields from the runner's global profile.
  useEffect(() => {
    if (session?.user.id) getProfile(session.user.id).then((p) => {
      if (p) { setBibName(p.bib_name ?? ""); setEmergency(p.emergency_contact ?? ""); }
    });
  }, [session?.user.id]);

  const total = useMemo(() => {
    const base = cat.data?.base_price ?? 0;
    const addonTotal = (addons.data ?? []).filter((a) => selectedAddons[a.id]).reduce((s, a) => s + a.price, 0);
    return base + addonTotal;
  }, [cat.data, addons.data, selectedAddons]);

  if (cat.isLoading || (eventId && fields.isLoading)) return <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>;

  const fieldRows = fields.data ?? [];
  const asFormFields: FormField[] = fieldRows.map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.required, options: f.options ?? undefined }));

  async function submit() {
    const parsed = customDataSchema(asFormFields).safeParse(values);
    if (!parsed.success) { setError("Please complete the required fields correctly."); return; }
    if (!emergency.trim()) { setError("Emergency contact is required."); return; }
    if (!waiver) { setError("You must accept the waiver."); return; }
    setError(null); setBusy(true);
    try {
      const res = await startCheckout({
        event_id: eventId, category_id: categoryId,
        addon_ids: Object.keys(selectedAddons).filter((id) => selectedAddons[id]),
        custom_data: { bib_name: bibName, date_of_birth: dob, emergency_contact: emergency, first_ultra: firstUltra, ...values },
        waiver_accepted: true, idempotency_key: idempotencyKey,
      });
      router.replace({ pathname: "/pay/[registrationId]", params: { registrationId: res.registration_id, checkoutUrl: res.checkout_url } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Registration failed");
    } finally { setBusy(false); }
  }

  return (
    <View style={styles.c}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 4, paddingHorizontal: 22, paddingBottom: 120 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} accessibilityRole="button"><Text style={styles.back}>‹ {cat.data?.label ?? "Back"}</Text></Pressable>
        <Text style={styles.h}>Register — {cat.data?.label}</Text>

        <View style={styles.field}><Text style={styles.label}>BIB NAME</Text><TextInput style={styles.input} value={bibName} onChangeText={setBibName} placeholder="Name on your bib" placeholderTextColor={theme.inkFaint} autoCapitalize="characters" accessibilityLabel="Bib name" /></View>
        <View style={styles.field}><Text style={styles.label}>DATE OF BIRTH</Text><TextInput style={styles.input} value={dob} onChangeText={setDob} placeholder="YYYY-MM-DD" placeholderTextColor={theme.inkFaint} autoCapitalize="none" accessibilityLabel="Date of birth" /></View>
        <View style={styles.field}>
          <Text style={[styles.label, { color: theme.danger }]}>EMERGENCY CONTACT · required</Text>
          <TextInput style={[styles.input, error && !emergency.trim() ? styles.inputErr : null]} value={emergency} onChangeText={setEmergency} placeholder="Name & mobile number" placeholderTextColor={theme.inkFaint} accessibilityLabel="Emergency contact" />
        </View>
        <Pressable style={styles.toggleRow} onPress={() => setFirstUltra((v) => !v)} accessibilityRole="button" accessibilityLabel="First ultra at this distance">
          <Text style={styles.toggleText}>First ultra at this distance?</Text>
          <View style={[styles.track, firstUltra && styles.trackOn]}><View style={[styles.knob, firstUltra && styles.knobOn]} /></View>
        </Pressable>

        {fieldRows.map((f) => (
          <DynamicField key={f.id} field={f} value={values[f.key]} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
        ))}

        {(addons.data ?? []).length > 0 && <Text style={styles.section}>Add-ons</Text>}
        {(addons.data ?? []).map((a) => {
          const on = !!selectedAddons[a.id];
          return (
            <Pressable key={a.id} style={styles.addon} onPress={() => setSelectedAddons((s) => ({ ...s, [a.id]: !s[a.id] }))} accessibilityRole="button" accessibilityLabel={a.name}>
              <View style={{ flex: 1 }}><Text style={styles.addonName}>{a.name}</Text><Text style={styles.addonPrice}>+{formatPeso(a.price)}</Text></View>
              <View style={[styles.track, on && styles.trackOn]}><View style={[styles.knob, on && styles.knobOn]} /></View>
            </Pressable>
          );
        })}

        <Pressable style={styles.waiver} onPress={() => setWaiver((v) => !v)} accessibilityRole="button" accessibilityLabel="Accept waiver">
          <Text style={styles.waiverText}>I accept the event <Text style={{ color: theme.primary, fontWeight: "600" }}>waiver</Text> and confirm I'm medically fit.</Text>
          <View style={[styles.track, waiver && styles.trackOn]}><View style={[styles.knob, waiver && styles.knobOn]} /></View>
        </Pressable>

        <View style={styles.totalRow}><Text style={styles.totalLabel}>Total</Text><Text style={styles.totalValue}>{formatPeso(total)}</Text></View>
        {error ? <Text style={styles.err}>{error}</Text> : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable style={[styles.cta, busy && { opacity: 0.6 }]} disabled={busy} onPress={submit} accessibilityRole="button"><Text style={styles.ctaT}>{busy ? "Submitting…" : "Register"}</Text></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.canvas },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.canvas },
  back: { color: theme.primary, fontSize: 15, fontWeight: "500" },
  h: { fontSize: 24, fontWeight: "700", letterSpacing: -0.4, color: theme.ink, marginTop: 10, marginBottom: 6 },
  field: { marginTop: 14 },
  label: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4, color: theme.inkMuted, marginBottom: 6 },
  input: { backgroundColor: theme.canvas, borderWidth: 1, borderColor: theme.hairline, borderRadius: theme.radius.md, paddingVertical: 13, paddingHorizontal: 14, fontSize: 15, color: theme.ink },
  inputErr: { borderColor: theme.danger },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: theme.parchment, borderRadius: theme.radius.card, padding: 14, marginTop: 16 },
  toggleText: { flex: 1, fontSize: 14, color: theme.ink },
  track: { width: 46, height: 28, borderRadius: 14, backgroundColor: theme.hairline, justifyContent: "center" },
  trackOn: { backgroundColor: theme.primary },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#fff", marginLeft: 3 },
  knobOn: { marginLeft: 21 },
  section: { fontSize: 15, fontWeight: "600", color: theme.ink, marginTop: 22, marginBottom: 10 },
  addon: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderColor: theme.hairline, borderRadius: theme.radius.card, padding: 13, paddingHorizontal: 14, marginBottom: 10 },
  addonName: { fontSize: 14, fontWeight: "500", color: theme.ink },
  addonPrice: { fontSize: 13, color: theme.primary, fontWeight: "600", marginTop: 2 },
  waiver: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: theme.parchment, borderRadius: theme.radius.card, padding: 14, marginTop: 20 },
  waiverText: { flex: 1, fontSize: 13, color: theme.ink, lineHeight: 19 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 18 },
  totalLabel: { fontSize: 15, fontWeight: "600", color: theme.ink },
  totalValue: { fontSize: 22, fontWeight: "700", color: theme.primary },
  err: { color: theme.danger, marginTop: 12, fontSize: 13 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 22, paddingTop: 14, backgroundColor: theme.canvas, borderTopWidth: 1, borderTopColor: theme.divider },
  cta: { backgroundColor: theme.primary, borderRadius: theme.radius.pill, padding: 15, alignItems: "center" },
  ctaT: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
