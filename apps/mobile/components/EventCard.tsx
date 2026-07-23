import { useRef, useState } from "react";
import { View, Pressable, Image } from "react-native";
import Svg, { Defs, LinearGradient, Stop, Rect } from "react-native-svg";
import { formatAddress, formatDateRange } from "@race-pace/shared";
import type { EventRow } from "../lib/events";
import { ElevationHero } from "./ElevationHero";
import { OrgAvatar } from "./OrgAvatar";
import { StatusBadge, eventStatusKind } from "./StatusBadge";
import { shortDate, distanceLabel } from "../lib/format";
import { Text } from "@/components/ui/text";

let _gid = 0;

export function EventCard({ event, showOrg = true, onPress }: { event: EventRow; showOrg?: boolean; onPress: () => void }) {
  const cancelled = eventStatusKind(event) === "cancelled";
  const address = formatAddress(event) || event.place;
  const dateRange = event.event_date ? formatDateRange(event.event_date, event.end_date, shortDate) : "";
  const dateLabel = dateRange ? (cancelled ? `was ${dateRange}` : dateRange) : "";
  const [imgFailed, setImgFailed] = useState(false);
  // Unique gradient id per card instance — SVG <Defs> ids are scoped per
  // render tree, and many cards render at once in a FlatList, so a shared id
  // would let one card's gradient leak into another's (same technique as
  // ElevationHero's `_gid` counter).
  const idRef = useRef<string | undefined>(undefined);
  if (!idRef.current) idRef.current = `ecg${_gid++}`;
  const distinctDistances = [...new Set(event.distances)].sort((a, b) => a - b);

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <View className="rounded-[18px] overflow-hidden mb-4" style={{ height: 210 }}>
        {event.hero_image_url && !imgFailed ? (
          <Image
            testID="event-card-image"
            source={{ uri: event.hero_image_url }}
            style={{ position: "absolute", height: "100%", width: "100%" }}
            resizeMode="cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <View style={{ position: "absolute", height: "100%", width: "100%" }}>
            <ElevationHero height={210} />
          </View>
        )}

        <Svg
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "70%", width: "100%" }}
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <Defs>
            <LinearGradient id={idRef.current} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#000000" stopOpacity={0} />
              <Stop offset="1" stopColor="#000000" stopOpacity={0.82} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={100} height={100} fill={`url(#${idRef.current})`} />
        </Svg>

        <View className="absolute top-3 left-3"><StatusBadge event={event} /></View>
        {showOrg && event.org_name ? (
          <View className="absolute top-3 right-3">
            <OrgAvatar name={event.org_name} color={event.org_color} size={38} radius={11} />
          </View>
        ) : null}

        <View className="absolute left-[14px] right-[14px] bottom-3">
          <Text className="text-[16.5px] font-bold text-white" numberOfLines={1}>{event.name}</Text>
          {address ? <Text className="text-[12.5px] text-white/85 mt-[3px]" numberOfLines={1}>{address}</Text> : null}
          {dateLabel ? <Text className="text-[12.5px] text-white/85 mt-0.5">{dateLabel}</Text> : null}
          {event.joined_count > 0 ? <Text className="text-[11.5px] text-white/70 mt-0.5">+{event.joined_count} joined</Text> : null}
          {distinctDistances.length > 0 ? (
            <View className="flex-row flex-wrap gap-[6px] mt-[9px]">
              {distinctDistances.map((d) => (
                <View key={d} className="bg-white/15 border border-white/25 rounded-full px-[9px] py-[3px]">
                  <Text className="text-[11px] font-semibold text-white">{distanceLabel(d)}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}
