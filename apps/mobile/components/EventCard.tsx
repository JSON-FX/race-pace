import { useState } from "react";
import { View, Pressable, Image } from "react-native";
import { formatAddress, formatDateRange } from "@race-pace/shared";
import type { EventRow } from "../lib/events";
import { ElevationHero } from "./ElevationHero";
import { OrgAvatar } from "./OrgAvatar";
import { StatusBadge, eventStatusKind } from "./StatusBadge";
import { shortDate } from "../lib/format";
import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/text";

export function EventCard({ event, showOrg = true, onPress }: { event: EventRow; showOrg?: boolean; onPress: () => void }) {
  const cancelled = eventStatusKind(event) === "cancelled";
  const address = formatAddress(event) || event.place;
  const dateRange = event.event_date ? formatDateRange(event.event_date, event.end_date, shortDate) : "";
  const dateLabel = dateRange ? (cancelled ? `was ${dateRange}` : dateRange) : "";
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card className="rounded-[18px] border border-border overflow-hidden bg-card mb-4 gap-0 py-0 shadow-none shadow-transparent">
        <View>
          {event.hero_image_url && !imgFailed ? (
            <Image testID="event-card-image" source={{ uri: event.hero_image_url }} style={{ height: 132, width: "100%" }} resizeMode="cover" onError={() => setImgFailed(true)} />
          ) : (
            <ElevationHero height={132} />
          )}
          <View className="absolute top-3 left-3"><StatusBadge event={event} /></View>
        </View>
        <View className="p-[14px] px-4">
          <Text className="text-[17px] font-semibold tracking-[-0.2px] text-foreground" numberOfLines={1}>{event.name}</Text>
          {address ? <Text className="text-[13px] text-muted-foreground mt-[3px]">{address}</Text> : null}
          {dateLabel ? <Text className="text-[13px] text-muted-foreground mt-0.5">{dateLabel}</Text> : null}
          {event.joined_count > 0 ? <Text className="text-[12px] text-muted-foreground mt-0.5">+{event.joined_count} joined</Text> : null}
          {showOrg && event.org_name ? (
            <View className="flex-row items-center gap-[9px] mt-[13px] pt-3 border-t border-divider">
              <OrgAvatar name={event.org_name} color={event.org_color} size={24} />
              <Text className="text-[13px] text-muted-foreground">{event.org_name}</Text>
            </View>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}
