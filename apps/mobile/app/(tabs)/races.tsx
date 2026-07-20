import { useEffect, useState } from "react";
import { View, Text, FlatList, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMyRegistrations } from "../../lib/registration";
import { cacheMyRaces, getCachedMyRaces, type CachedTicket } from "../../lib/ticketCache";
import { shortDate } from "../../lib/format";
import { theme } from "../../lib/theme";

type Row = { id: string; eventName: string; categoryLabel: string; km: number | null; date: string | null; status: string };

export default function MyRaces() {
  const { data, isLoading, isError, refetch } = useMyRegistrations();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [cached, setCached] = useState<CachedTicket[] | null>(null);

  useEffect(() => { getCachedMyRaces().then(setCached).catch(() => setCached([])); }, []);

  useEffect(() => {
    if (data) {
      cacheMyRaces(data.map((r) => ({
        rid: r.id, token: r.ticket_token, eventName: r.eventName, categoryLabel: r.categoryLabel,
        runnerName: "", status: r.status, orgId: r.org_id,
      })));
    }
  }, [data]);

  const rows: Row[] = data
    ? data.map((r) => ({ id: r.id, eventName: r.eventName, categoryLabel: r.categoryLabel, km: r.categoryDistance, date: r.eventDate, status: r.status }))
    : (cached ?? []).map((c) => ({ id: c.rid, eventName: c.eventName, categoryLabel: c.categoryLabel, km: null, date: null, status: c.status }));

  if (!data && (cached === null || isLoading)) return <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>;
  if (isError && !data && rows.length === 0) {
    return <View style={styles.center}><Pressable onPress={() => refetch()} accessibilityRole="button"><Text style={styles.err}>Couldn't load. Tap to retry.</Text></Pressable></View>;
  }

  return (
    <FlatList
      style={styles.list}
      data={rows}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ paddingTop: insets.top + 6, paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={<Text style={styles.h}>My Races</Text>}
      ListEmptyComponent={
        <View style={styles.empty}>
          <View style={styles.emptyIcon}><Text style={{ fontSize: 30, color: theme.inkFaint }}>⚑</Text></View>
          <Text style={styles.emptyH}>No registrations yet</Text>
          <Text style={styles.emptySub}>Find a trail worth chasing and your races will show up here.</Text>
          <Pressable style={styles.browse} onPress={() => router.push("/(tabs)/events")} accessibilityRole="button"><Text style={styles.browseT}>Browse events</Text></Pressable>
        </View>
      }
      renderItem={({ item }) => {
        const paid = item.status === "paid";
        const meta = [item.categoryLabel, item.date ? shortDate(item.date) : null].filter(Boolean).join(" · ");
        return (
          <Pressable style={styles.row} onPress={() => router.push(paid ? `/ticket/${item.id}` : `/pay/${item.id}`)} accessibilityRole="button">
            <View style={styles.kmBadge}><Text style={styles.kmNum}>{item.km ?? "—"}</Text><Text style={styles.kmUnit}>KM</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.eventName}</Text>
              {meta ? <Text style={styles.meta}>{meta}</Text> : null}
            </View>
            <View style={[styles.pill, paid ? styles.pillPaid : styles.pillPending]}>
              <Text style={[styles.pillT, paid ? styles.pillTPaid : styles.pillTPending]}>{paid ? "Paid" : "Pending"}</Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: theme.canvas },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.canvas },
  h: { fontSize: 30, fontWeight: "700", letterSpacing: -0.5, color: theme.ink, paddingHorizontal: 22, marginBottom: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 15, paddingHorizontal: 22, borderTopWidth: 1, borderTopColor: theme.divider },
  kmBadge: { width: 46, height: 46, borderRadius: 13, backgroundColor: theme.primaryTint, alignItems: "center", justifyContent: "center" },
  kmNum: { color: theme.primary, fontSize: 13, fontWeight: "700", lineHeight: 15 },
  kmUnit: { color: theme.primary, fontSize: 9, fontWeight: "700" },
  name: { fontSize: 15, fontWeight: "600", color: theme.ink },
  meta: { fontSize: 12, color: theme.inkMuted, marginTop: 2 },
  pill: { borderRadius: theme.radius.pill, paddingVertical: 5, paddingHorizontal: 13 },
  pillPaid: { backgroundColor: theme.paidTint }, pillPending: { backgroundColor: theme.parchment },
  pillT: { fontSize: 12, fontWeight: "700" },
  pillTPaid: { color: theme.paid }, pillTPending: { color: theme.inkMuted },
  empty: { alignItems: "center", paddingTop: 80, paddingHorizontal: 22 },
  emptyIcon: { width: 74, height: 74, borderRadius: 37, backgroundColor: theme.parchment, alignItems: "center", justifyContent: "center" },
  emptyH: { fontSize: 18, fontWeight: "600", color: theme.ink, marginTop: 18 },
  emptySub: { color: theme.inkMuted, fontSize: 14, marginTop: 6, textAlign: "center", maxWidth: 230 },
  browse: { backgroundColor: theme.primary, borderRadius: theme.radius.pill, paddingVertical: 13, paddingHorizontal: 26, marginTop: 20 },
  browseT: { color: "#fff", fontSize: 15, fontWeight: "600" },
  err: { color: theme.stop },
});
