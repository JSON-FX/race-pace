import { useEffect, useRef, useState } from "react";
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { formatPeso } from "@race-pace/shared";
import { useRegistration } from "../../lib/registration";
import { cacheTicket } from "../../lib/ticketCache";
import { theme } from "../../lib/theme";

const TIMEOUT_MS = 90_000;
const RETURN_PATH = "pay-callback"; // deliberately NOT pay/return (collides with pay/[registrationId])
const METHODS = [
  { key: "card", label: "Card", sub: "Visa · Mastercard" },
  { key: "gcash", label: "GCash", sub: "E-wallet" },
  { key: "maya", label: "Maya", sub: "E-wallet" },
];

export default function Pay() {
  const { registrationId, checkoutUrl } = useLocalSearchParams<{ registrationId: string; checkoutUrl?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [awaiting, setAwaiting] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [method, setMethod] = useState("gcash");
  const [err, setErr] = useState<string | null>(null);
  const reg = useRegistration(registrationId, { poll: awaiting });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const paid = reg.data?.status === "paid";
  const url = checkoutUrl ?? reg.data?.checkoutUrl ?? null;

  useEffect(() => {
    if (paid && reg.data) {
      cacheTicket({ rid: reg.data.id, token: reg.data.ticket_token, eventName: reg.data.eventName, categoryLabel: reg.data.categoryLabel, runnerName: "", status: "paid", orgId: reg.data.org_id });
      if (timer.current) clearTimeout(timer.current);
    }
  }, [paid, reg.data]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function pay() {
    if (!url) { setErr("No checkout link available. Go back and try again."); return; }
    setErr(null);
    const redirect = Linking.createURL(RETURN_PATH);
    const full = url + (url.includes("?") ? "&" : "?") + "return=" + encodeURIComponent(redirect);
    try { await WebBrowser.openAuthSessionAsync(full, redirect); } catch { /* poll drives the outcome */ }
    setTimedOut(false); setAwaiting(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
  }

  if (paid) {
    return (
      <View style={[styles.c, { paddingTop: insets.top, paddingHorizontal: 22 }]}>
        <View style={styles.hero}>
          <View style={styles.checkOuter}><View style={styles.checkInner}><Text style={styles.checkMark}>✓</Text></View></View>
          <Text style={styles.confirmH}>Payment confirmed</Text>
          <Text style={styles.confirmSub}>You're registered for <Text style={{ color: theme.ink, fontWeight: "600" }}>{reg.data?.eventName} {reg.data?.categoryLabel}</Text>. Ref <Text style={styles.mono}>{registrationId.slice(0, 8).toUpperCase()}</Text>.</Text>
        </View>
        <View style={{ paddingBottom: insets.bottom + 20 }}>
          <Pressable style={styles.pill} onPress={() => router.replace(`/ticket/${registrationId}`)} accessibilityRole="button"><Text style={styles.pillT}>View ticket</Text></Pressable>
          <Pressable onPress={() => router.replace("/(tabs)/races")} accessibilityRole="button"><Text style={styles.linkMuted}>Back to My Races</Text></Pressable>
        </View>
      </View>
    );
  }

  if (awaiting) {
    return (
      <View style={[styles.c, { paddingTop: insets.top, paddingHorizontal: 22 }]}>
        <View style={styles.hero}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={styles.pendingH}>Waiting for confirmation…</Text>
          <Text style={styles.pendingSub}>We're confirming your payment. This usually takes a few seconds.</Text>
          {timedOut ? <Text style={styles.pendingNote}>Still processing. If you completed payment, tap Check again.</Text> : null}
          <View style={styles.pendingChip}><Text style={styles.pendingChipT}>Pending</Text></View>
        </View>
        <View style={{ paddingBottom: insets.bottom + 20 }}>
          <Pressable style={styles.pill} onPress={() => reg.refetch()} accessibilityRole="button"><Text style={styles.pillT}>Check again</Text></Pressable>
          <Pressable onPress={pay} accessibilityRole="button"><Text style={styles.link}>Retry payment</Text></Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.c, { paddingTop: insets.top + 6 }]}>
      <View style={styles.pad}>
        <Pressable onPress={() => router.back()} accessibilityRole="button"><Text style={styles.back}>‹ Register</Text></Pressable>
        <Text style={styles.h}>Payment</Text>

        <View style={styles.summary}>
          <View style={styles.sumRow}><Text style={styles.sumMuted}>{reg.data?.eventName ?? ""}</Text><Text style={styles.sumVal}>{reg.data?.categoryLabel ?? ""}</Text></View>
          <View style={styles.sumDivider} />
          <View style={styles.sumRow}><Text style={styles.sumTotalLabel}>Total</Text><Text style={styles.sumTotal}>{reg.data ? formatPeso(reg.data.total_amount) : ""}</Text></View>
        </View>

        <Text style={styles.label}>PAY WITH</Text>
        <View style={styles.methods}>
          {METHODS.map((m) => {
            const on = method === m.key;
            return (
              <Pressable key={m.key} style={[styles.method, on && styles.methodOn]} onPress={() => setMethod(m.key)} accessibilityRole="button">
                <Text style={styles.methodL}>{m.label}</Text>
                <Text style={styles.methodS}>{m.sub}</Text>
              </Pressable>
            );
          })}
        </View>
        {err ? <Text style={styles.err}>{err}</Text> : null}
      </View>

      <View style={{ flex: 1 }} />
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <Pressable style={styles.pill} onPress={pay} accessibilityRole="button"><Text style={styles.pillT}>Pay {reg.data ? formatPeso(reg.data.total_amount) : ""}</Text></Pressable>
        <Text style={styles.secured}>Secured by PayMongo</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.canvas },
  pad: { paddingHorizontal: 22 },
  hero: { flex: 1, alignItems: "center", justifyContent: "center" },
  back: { color: theme.primary, fontSize: 15, fontWeight: "500" },
  h: { fontSize: 24, fontWeight: "700", letterSpacing: -0.4, color: theme.ink, marginTop: 10 },
  summary: { backgroundColor: theme.parchment, borderRadius: 16, padding: 18, marginTop: 20 },
  sumRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sumMuted: { color: theme.inkMuted, fontSize: 14 },
  sumVal: { fontSize: 14, fontWeight: "600", color: theme.ink },
  sumDivider: { height: 1, backgroundColor: theme.hairline, marginVertical: 12 },
  sumTotalLabel: { fontSize: 15, fontWeight: "600", color: theme.ink },
  sumTotal: { fontSize: 20, fontWeight: "700", color: theme.primary },
  label: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4, color: theme.inkMuted, marginTop: 22, marginBottom: 10 },
  methods: { flexDirection: "row", gap: 10 },
  method: { flex: 1, borderRadius: 14, padding: 13, borderWidth: 1.5, borderColor: theme.hairline, backgroundColor: theme.canvas, alignItems: "center" },
  methodOn: { borderColor: theme.primary, backgroundColor: theme.primaryTint },
  methodL: { fontSize: 14, fontWeight: "600", color: theme.ink },
  methodS: { fontSize: 11, color: theme.inkMuted, marginTop: 2 },
  footer: { paddingHorizontal: 22, paddingTop: 10 },
  pill: { backgroundColor: theme.primary, borderRadius: theme.radius.pill, padding: 15, alignItems: "center" },
  pillT: { color: "#fff", fontSize: 16, fontWeight: "600" },
  secured: { textAlign: "center", color: theme.inkMuted, fontSize: 12, marginTop: 10 },
  link: { color: theme.primary, fontSize: 14, fontWeight: "600", textAlign: "center", marginTop: 14 },
  linkMuted: { color: theme.inkMuted, fontSize: 14, fontWeight: "600", textAlign: "center", marginTop: 14 },
  err: { color: theme.danger, marginTop: 12, textAlign: "center" },
  pendingH: { fontSize: 20, fontWeight: "600", color: theme.ink, marginTop: 26 },
  pendingSub: { color: theme.inkMuted, fontSize: 14, textAlign: "center", marginTop: 8, maxWidth: 260, lineHeight: 20 },
  pendingNote: { color: theme.inkMuted, fontSize: 13, textAlign: "center", marginTop: 8 },
  pendingChip: { backgroundColor: theme.parchment, borderRadius: theme.radius.pill, paddingVertical: 5, paddingHorizontal: 12, marginTop: 18 },
  pendingChipT: { color: theme.inkMuted, fontSize: 12, fontWeight: "600" },
  checkOuter: { width: 92, height: 92, borderRadius: 46, backgroundColor: theme.primaryTint, alignItems: "center", justifyContent: "center" },
  checkInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: theme.primary, alignItems: "center", justifyContent: "center" },
  checkMark: { color: "#fff", fontSize: 30, fontWeight: "700" },
  confirmH: { fontSize: 26, fontWeight: "700", letterSpacing: -0.4, color: theme.ink, marginTop: 24 },
  confirmSub: { color: theme.inkMuted, fontSize: 15, textAlign: "center", marginTop: 10, maxWidth: 280, lineHeight: 21 },
  mono: { fontFamily: "Courier" },
});
