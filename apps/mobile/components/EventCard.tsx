import { View, Text, Pressable, Image, StyleSheet } from "react-native";
import { formatAddress } from "@race-pace/shared";
import type { EventRow } from "../lib/events";
import { ElevationHero } from "./ElevationHero";
import { OrgAvatar } from "./OrgAvatar";
import { StatusBadge, eventStatusKind } from "./StatusBadge";
import { shortDate } from "../lib/format";
import { theme } from "../lib/theme";

export function EventCard({ event, showOrg = true, onPress }: { event: EventRow; showOrg?: boolean; onPress: () => void }) {
  const cancelled = eventStatusKind(event) === "cancelled";
  const dateLabel = event.event_date ? (cancelled ? `was ${shortDate(event.event_date)}` : shortDate(event.event_date)) : "";
  const meta = [formatAddress(event) || event.place, dateLabel].filter(Boolean).join(" · ");
  return (
    <Pressable style={styles.card} onPress={onPress} accessibilityRole="button">
      <View>
        {event.hero_image_url ? (
          <Image testID="event-card-image" source={{ uri: event.hero_image_url }} style={{ height: 132, width: "100%" }} resizeMode="cover" />
        ) : (
          <ElevationHero height={132} />
        )}
        <View style={styles.badge}><StatusBadge event={event} /></View>
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{event.name}</Text>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}
        {showOrg && event.org_name ? (
          <View style={styles.orgRow}>
            <OrgAvatar name={event.org_name} color={event.org_color} size={24} />
            <Text style={styles.org}>{event.org_name}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: theme.hairline, borderRadius: theme.radius.lg, overflow: "hidden", backgroundColor: theme.canvas, marginBottom: 16 },
  badge: { position: "absolute", top: 12, left: 12 },
  body: { padding: 14, paddingHorizontal: 16 },
  name: { fontSize: 17, fontWeight: "600", letterSpacing: -0.2, color: theme.ink },
  meta: { fontSize: 13, color: theme.inkMuted, marginTop: 3 },
  orgRow: { flexDirection: "row", alignItems: "center", gap: 9, marginTop: 13, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.divider },
  org: { fontSize: 13, color: theme.inkMuted },
});
