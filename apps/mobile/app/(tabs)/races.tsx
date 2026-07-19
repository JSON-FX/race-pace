import { useEffect, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useOrg } from "../../lib/org";
import { useMyRegistrations } from "../../lib/registration";
import { cacheMyRaces, getCachedMyRaces, type CachedTicket } from "../../lib/ticketCache";
import { theme } from "../../lib/theme";

type Row = { id: string; eventName: string; categoryLabel: string; status: string };

export default function MyRaces() {
  const { selectedOrgId } = useOrg();
  const { data, isLoading, isError, refetch } = useMyRegistrations(selectedOrgId);
  const router = useRouter();
  const [cached, setCached] = useState<CachedTicket[] | null>(null);

  // Load the offline cache so the list survives a cold, no-signal launch.
  useEffect(() => {
    if (selectedOrgId) getCachedMyRaces(selectedOrgId).then(setCached).catch(() => setCached([]));
  }, [selectedOrgId]);

  // Write-through cache whenever fresh network data arrives.
  useEffect(() => {
    if (selectedOrgId && data) {
      cacheMyRaces(selectedOrgId, data.map((r) => ({
        rid: r.id, token: r.ticket_token, eventName: r.eventName, categoryLabel: r.categoryLabel,
        runnerName: "", status: r.status, orgId: r.org_id,
      })));
    }
  }, [data, selectedOrgId]);

  // Prefer fresh network data; fall back to the cached list when offline.
  const rows: Row[] = data
    ? data.map((r) => ({ id: r.id, eventName: r.eventName, categoryLabel: r.categoryLabel, status: r.status }))
    : (cached ?? []).map((c) => ({ id: c.rid, eventName: c.eventName, categoryLabel: c.categoryLabel, status: c.status }));

  // Spinner only while we have neither network data nor a resolved cache.
  if (!data && (cached === null || isLoading)) return <View style={styles.center}><ActivityIndicator /></View>;
  // Error only when the network failed AND there is nothing cached to show.
  if (isError && !data && rows.length === 0) {
    return (
      <View style={styles.center}>
        <Pressable onPress={() => refetch()} accessibilityRole="button"><Text style={styles.err}>Couldn't load. Tap to retry.</Text></Pressable>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.list}
      data={rows}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      ListHeaderComponent={<Text style={styles.h}>My Races</Text>}
      ListEmptyComponent={<Text style={styles.empty}>No registrations yet.</Text>}
      renderItem={({ item }) => {
        const paid = item.status === "paid";
        return (
          <Pressable style={styles.card} onPress={() => router.push(paid ? `/ticket/${item.id}` : `/pay/${item.id}`)} accessibilityRole="button">
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.eventName}</Text>
              <Text style={styles.meta}>{item.categoryLabel}</Text>
            </View>
            <View style={[styles.badge, paid ? styles.badgePaid : styles.badgePending]}>
              <Text style={[styles.badgeT, paid ? styles.badgeTPaid : styles.badgeTPending]}>{paid ? "Paid" : "Pending"}</Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: theme.canvas },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  h: { fontSize: 28, fontWeight: "600", letterSpacing: -0.4, color: theme.ink, marginBottom: 12 },
  card: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: theme.hairline, borderRadius: theme.radius.lg, padding: 16, marginBottom: 12 },
  name: { fontSize: 17, fontWeight: "600", color: theme.ink },
  meta: { color: theme.inkMuted, marginTop: 3, fontSize: 13 },
  badge: { borderRadius: theme.radius.pill, paddingVertical: 5, paddingHorizontal: 12 },
  badgePaid: { backgroundColor: "#e7f3ff" },
  badgePending: { backgroundColor: theme.parchment },
  badgeT: { fontSize: 12, fontWeight: "700" },
  badgeTPaid: { color: theme.primary },
  badgeTPending: { color: theme.inkMuted },
  empty: { color: theme.inkMuted },
  err: { color: theme.stop },
});
