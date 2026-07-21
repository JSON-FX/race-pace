import { useState } from "react";
import { View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatPeso } from "@race-pace/shared";
import { useEvent, useCategories } from "../../lib/events";
import { EventGallery } from "../../components/EventGallery";
import { OrgAvatar } from "../../components/OrgAvatar";
import { StatusBanner, eventStatusKind } from "../../components/StatusBadge";
import { longDate } from "../../lib/format";
import { theme } from "../../lib/theme";

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const ev = useEvent(id);
  const cats = useCategories(id);
  const [selected, setSelected] = useState<string | null>(null);

  if (ev.isLoading || cats.isLoading) return <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>;
  const event = ev.data;
  if (!event) return <View style={styles.center}><Text style={styles.meta}>Event not found.</Text></View>;

  const categories = cats.data ?? [];
  const selectedId = selected ?? categories[0]?.id ?? null;
  const selectedCat = categories.find((c) => c.id === selectedId);
  const registerable = !["cancelled", "closed", "completed"].includes(event.status);

  const fullAddress = [event.city_name, event.province_name, event.region_name].filter(Boolean).join(" · ");
  const meta = [
    (fullAddress || event.place) && `◎ ${fullAddress || [event.place, event.region].filter(Boolean).join(" · ")}`,
    event.venue && `🏁 ${event.venue}`,
    event.event_date && `⚑ ${longDate(event.event_date)}`,
    event.elevation_gain_m && `▲ ${event.elevation_gain_m.toLocaleString()}m gain`,
    event.cutoff_hours && `⏱ ${event.cutoff_hours}h cutoff`,
  ].filter(Boolean) as string[];

  return (
    <View style={styles.c}>
      <ScrollView contentContainerStyle={{ paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
        <View>
          <EventGallery images={[event.hero_image_url, ...(event.gallery ?? [])]} height={250} />
          <Pressable onPress={() => router.back()} style={[styles.roundBtn, { top: insets.top + 4 }]} accessibilityRole="button"><Text style={styles.roundIcon}>‹</Text></Pressable>
        </View>

        <StatusBanner event={event} />

        <View style={styles.pad}>
          <Text style={styles.name}>{event.name}</Text>

          <Pressable style={styles.orgCard} onPress={() => router.push(`/org/${event.org_id}`)} accessibilityRole="button">
            <OrgAvatar name={event.org_name} color={event.org_color} size={34} />
            <View style={{ flex: 1 }}>
              <Text style={styles.orgName}>{event.org_name}</Text>
              {(event.province_name ?? event.region) ? <Text style={styles.orgRegion}>{event.province_name ?? event.region}</Text> : null}
            </View>
            <Text style={styles.view}>View ›</Text>
          </Pressable>

          {event.description ? <Text style={styles.desc}>{event.description}</Text> : null}

          {meta.length ? (
            <View style={styles.metaWrap}>
              {meta.map((m) => <Text key={m} style={styles.metaChip}>{m}</Text>)}
            </View>
          ) : null}

          <Text style={styles.section}>Pick a distance</Text>
          <View style={{ gap: 10 }}>
            {categories.length === 0 ? <Text style={styles.meta}>No categories open.</Text> : null}
            {categories.map((c) => {
              const on = c.id === selectedId;
              const left = c.slots_total - c.slots_taken;
              const disabled = !registerable || left <= 0;
              return (
                <Pressable key={c.id} disabled={disabled} onPress={() => setSelected(c.id)}
                  style={[styles.catRow, on && styles.catRowOn, disabled && styles.catDisabled]} accessibilityRole="button">
                  <View style={[styles.radio, { borderColor: on ? theme.primary : theme.inkFaint, backgroundColor: on ? theme.primary : "transparent" }]}>
                    {on ? <Text style={styles.check}>✓</Text> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.catTitle}>{c.label}</Text>
                    <Text style={styles.catSlots}>{left <= 0 ? "Sold out" : `${left} slots left`}</Text>
                  </View>
                  <Text style={styles.price}>{formatPeso(c.base_price)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        {registerable ? (
          <Pressable style={styles.cta} onPress={() => selectedId && router.push(`/register/${selectedId}`)} accessibilityRole="button">
            <Text style={styles.ctaT}>Register{selectedCat ? ` · ${selectedCat.label}` : ""}</Text>
          </Pressable>
        ) : (
          <View style={styles.ctaClosed}><Text style={styles.ctaClosedT}>Registration closed</Text></View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.canvas },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: theme.canvas },
  roundBtn: { position: "absolute", left: 18, width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.9)", alignItems: "center", justifyContent: "center" },
  roundIcon: { fontSize: 20, color: theme.ink, marginTop: -2 },
  pad: { paddingHorizontal: 22, paddingTop: 18 },
  name: { fontSize: 26, fontWeight: "700", letterSpacing: -0.4, color: theme.ink, lineHeight: 30 },
  orgCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.parchment, borderRadius: theme.radius.card, padding: 11, paddingHorizontal: 13, marginTop: 14 },
  orgName: { fontSize: 13, fontWeight: "600", color: theme.ink },
  orgRegion: { fontSize: 12, color: theme.inkMuted, marginTop: 1 },
  view: { color: theme.primary, fontSize: 13, fontWeight: "600" },
  desc: { fontSize: 14, color: theme.ink, lineHeight: 22, marginTop: 14 },
  metaWrap: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 16 },
  metaChip: { fontSize: 13, color: theme.inkMuted },
  section: { fontSize: 18, fontWeight: "700", letterSpacing: -0.3, color: theme.ink, marginTop: 22, marginBottom: 12 },
  meta: { color: theme.inkMuted, fontSize: 13 },
  catRow: { flexDirection: "row", alignItems: "center", gap: 13, padding: 14, borderRadius: theme.radius.card, borderWidth: 1.5, borderColor: theme.hairline, backgroundColor: theme.canvas },
  catRowOn: { borderColor: theme.primary, backgroundColor: theme.primaryTint },
  catDisabled: { opacity: 0.5 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  check: { color: "#fff", fontSize: 12, fontWeight: "700" },
  catTitle: { fontSize: 15, fontWeight: "600", color: theme.ink },
  catSlots: { fontSize: 12, color: theme.inkMuted, marginTop: 2 },
  price: { fontSize: 15, fontWeight: "600", color: theme.primary },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 22, paddingTop: 14, backgroundColor: theme.canvas, borderTopWidth: 1, borderTopColor: theme.divider },
  cta: { backgroundColor: theme.primary, borderRadius: theme.radius.pill, padding: 15, alignItems: "center" },
  ctaT: { color: "#fff", fontSize: 16, fontWeight: "600" },
  ctaClosed: { backgroundColor: "#E5E5E7", borderRadius: theme.radius.pill, padding: 15, alignItems: "center" },
  ctaClosedT: { color: "#9A9A9E", fontSize: 16, fontWeight: "600" },
});
