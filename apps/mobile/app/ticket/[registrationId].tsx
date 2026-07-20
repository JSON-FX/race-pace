import { useEffect, useState } from "react";
import { View, Text, ScrollView, ActivityIndicator, Pressable, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRegistration } from "../../lib/registration";
import { getCachedTicket, cacheTicket, type CachedTicket } from "../../lib/ticketCache";
import { getProfile } from "../../lib/profile";
import { useAuth } from "../../lib/auth";
import { TicketQR } from "../../components/TicketQR";
import { StatusBanner } from "../../components/StatusBadge";
import { longDate } from "../../lib/format";
import { theme } from "../../lib/theme";

export default function Ticket() {
  const { registrationId } = useLocalSearchParams<{ registrationId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const reg = useRegistration(registrationId);
  const [cached, setCached] = useState<CachedTicket | null>(null);
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [profile, setProfile] = useState<{ full_name: string | null; bib_name: string | null } | null>(null);

  useEffect(() => {
    getCachedTicket(registrationId).then((c) => { setCached(c); setCacheLoaded(true); }).catch(() => setCacheLoaded(true));
  }, [registrationId]);

  useEffect(() => {
    if (reg.data?.status === "paid" && reg.data.ticket_token) {
      const t: CachedTicket = { rid: reg.data.id, token: reg.data.ticket_token, eventName: reg.data.eventName, categoryLabel: reg.data.categoryLabel, runnerName: cached?.runnerName ?? "", status: "paid", orgId: reg.data.org_id };
      cacheTicket(t); setCached(t);
    }
    // `cached` intentionally excluded — including it re-triggers this effect on every setCached, looping.
  }, [reg.data]);

  useEffect(() => { if (session?.user.id) getProfile(session.user.id).then((p) => p && setProfile(p)); }, [session?.user.id]);

  const token = reg.data?.ticket_token ?? cached?.token ?? null;
  const eventName = reg.data?.eventName ?? cached?.eventName ?? "";
  const categoryLabel = reg.data?.categoryLabel ?? cached?.categoryLabel ?? "";
  const ref = registrationId.slice(0, 8).toUpperCase();

  if (!cacheLoaded && reg.isLoading) return <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>;

  return (
    <ScrollView style={styles.c} contentContainerStyle={{ paddingTop: insets.top + 6, paddingHorizontal: 22, paddingBottom: insets.bottom + 30 }} showsVerticalScrollIndicator={false}>
      <Pressable onPress={() => router.back()} accessibilityRole="button" style={{ paddingVertical: 8 }}><Text style={styles.back}>‹ My Races</Text></Pressable>

      {reg.data ? <StatusBanner event={{ status: reg.data.eventStatus ?? "open", original_date: reg.data.originalDate, event_date: reg.data.eventDate, status_note: reg.data.statusNote }} /> : null}

      {token ? (
        <>
          <View style={styles.card}>
            <View style={styles.pass}>
              <Text style={styles.passKicker}>RACE PASS · {categoryLabel.toUpperCase()}</Text>
              <Text style={styles.passEvent}>{eventName}</Text>
              {reg.data?.eventDate ? <Text style={styles.passDate}>{longDate(reg.data.eventDate)}</Text> : null}
            </View>
            <View style={styles.qrSection}>
              <View style={styles.qrBox}><TicketQR value={token} size={150} /></View>
              <Text style={styles.ref}>{ref}</Text>
              <Text style={styles.qrNote}>Show this QR at check-in. <Text style={{ fontWeight: "700" }}>Works offline.</Text></Text>
            </View>
          </View>

          <View style={styles.grid}>
            <Info label="RUNNER" value={profile?.full_name || "—"} />
            <Info label="BIB" value={profile?.bib_name || ref} />
            <Info label="CATEGORY" value={categoryLabel} />
            <Info label="DISTANCE" value={reg.data?.categoryDistance ? `${reg.data.categoryDistance} KM` : "—"} />
          </View>

          <View style={styles.pulseChip}>
            <View style={styles.pulseDot} />
            <Text style={styles.pulseT}>Present QR at start line</Text>
          </View>
        </>
      ) : (
        <Text style={styles.empty}>No ticket yet — complete payment to get your race pass.</Text>
      )}
    </ScrollView>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <View style={styles.infoCard}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue} numberOfLines={1}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.parchment },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.parchment },
  back: { color: theme.primary, fontSize: 15, fontWeight: "500" },
  card: { backgroundColor: theme.canvas, borderWidth: 1, borderColor: theme.hairline, borderRadius: 22, overflow: "hidden", marginTop: 6 },
  pass: { backgroundColor: theme.forest, padding: 22 },
  passKicker: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "600", letterSpacing: 0.5 },
  passEvent: { color: "#fff", fontSize: 22, fontWeight: "700", letterSpacing: -0.3, marginTop: 8 },
  passDate: { color: "rgba(255,255,255,0.75)", fontSize: 13, marginTop: 5 },
  qrSection: { borderTopWidth: 1.5, borderTopColor: theme.hairline, borderStyle: "dashed", padding: 26, alignItems: "center" },
  qrBox: { padding: 14, backgroundColor: "#fff", borderWidth: 1, borderColor: theme.hairline, borderRadius: 16 },
  ref: { fontFamily: "Courier", color: theme.inkMuted, fontSize: 13, marginTop: 14, letterSpacing: 1 },
  qrNote: { color: theme.ink, fontSize: 13, marginTop: 6, textAlign: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 14 },
  infoCard: { flexGrow: 1, flexBasis: "47%", backgroundColor: theme.canvas, borderWidth: 1, borderColor: theme.hairline, borderRadius: 14, padding: 14 },
  infoLabel: { fontSize: 10, color: theme.inkMuted },
  infoValue: { fontSize: 14, fontWeight: "600", color: theme.ink, marginTop: 3 },
  pulseChip: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, backgroundColor: theme.primaryTint, borderRadius: 14, padding: 14, marginTop: 14 },
  pulseDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: theme.primary },
  pulseT: { color: theme.primaryDark, fontSize: 13, fontWeight: "600" },
  empty: { color: theme.inkMuted, textAlign: "center", marginTop: 40 },
});
