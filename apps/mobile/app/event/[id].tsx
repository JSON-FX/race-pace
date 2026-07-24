import { useState } from "react";
import { View, ScrollView, Pressable, ActivityIndicator } from "react-native";
import Svg, { Defs, LinearGradient, Stop, Rect } from "react-native-svg";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft, ChevronRight, Calendar, MapPin, Flag, Mountain, Clock, Route, type LucideIcon } from "lucide-react-native";
import { formatPeso, formatDateRange } from "@race-pace/shared";
import { useEvent, useCategories } from "../../lib/events";
import { EventGallery } from "../../components/EventGallery";
import { OrgAvatar } from "../../components/OrgAvatar";
import { StatusBanner } from "../../components/StatusBadge";
import { longDate, flagOffLabel } from "../../lib/format";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const ev = useEvent(id);
  const cats = useCategories(id);
  const [selected, setSelected] = useState<string | null>(null);

  if (ev.isLoading || cats.isLoading) return <View className="flex-1 items-center justify-center bg-background"><ActivityIndicator className="text-primary" /></View>;
  const event = ev.data;
  if (!event) return <View className="flex-1 items-center justify-center bg-background"><Text className="text-muted-foreground text-[13px]">Event not found.</Text></View>;

  const categories = cats.data ?? [];
  const selectedId = selected ?? categories[0]?.id ?? null;
  const selectedCat = categories.find((c) => c.id === selectedId);
  const registerable = !["cancelled", "closed", "completed"].includes(event.status);

  const fullAddress = [event.city_name, event.province_name, event.region_name].filter(Boolean).join(" · ");
  const dateLabel = event.event_date ? formatDateRange(event.event_date, event.end_date, longDate) : null;
  const cityLabel = event.city_name ?? event.province_name ?? event.region ?? null;
  const orgLocation = [event.province_name, event.region_name].filter(Boolean).join(" · ") || event.region;

  const distinctKm = [...new Set(categories.map((c) => c.distance_km).filter((d): d is number => d != null))].sort((a, b) => a - b);
  const distLabel = distinctKm.length ? (distinctKm.length > 1 ? `${distinctKm[0]}–${distinctKm[distinctKm.length - 1]}K` : `${distinctKm[0]}K`) : "—";
  const cutoffLabel = event.cutoff_hours != null ? `${event.cutoff_hours} hr${event.cutoff_hours === 1 ? "" : "s"}` : "—";
  const stats: { icon: LucideIcon; value: string; label: string }[] = [
    { icon: Route, value: distLabel, label: "Distance" },
    { icon: Mountain, value: event.elevation_gain_m != null ? `${event.elevation_gain_m.toLocaleString()} m` : "—", label: "Elevation" },
    { icon: Flag, value: flagOffLabel(event.flag_off) ?? "—", label: "Flag-off" },
    { icon: Clock, value: cutoffLabel, label: "Cutoff" },
  ];
  const statRows = [stats.slice(0, 2), stats.slice(2, 4)];

  return (
    <View className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
        <View>
          <EventGallery images={[event.hero_image_url, ...(event.gallery ?? [])]} height={300} />
          <Svg style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: "70%", width: "100%" }} viewBox="0 0 100 100" preserveAspectRatio="none" pointerEvents="none">
            <Defs>
              <LinearGradient id="evscrim" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#000000" stopOpacity={0} />
                <Stop offset="0.5" stopColor="#000000" stopOpacity={0.32} />
                <Stop offset="1" stopColor="#000000" stopOpacity={0.85} />
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width={100} height={100} fill="url(#evscrim)" />
          </Svg>
          <View pointerEvents="none" className="absolute left-0 right-0 bottom-[74px] px-[22px]">
            <Text className="text-white text-[26px] font-bold tracking-[-0.4px] leading-[31px]" style={{ textShadowColor: "rgba(0,0,0,0.4)", textShadowRadius: 12 }}>{event.name}</Text>
            <View className="flex-row items-center gap-[6px] mt-[8px]">
              {dateLabel ? <><Icon as={Calendar} size={13} className="text-white" /><Text className="text-white text-[12.5px] font-medium">{dateLabel}</Text></> : null}
              {dateLabel && cityLabel ? <Text className="text-white/50 text-[12px]">·</Text> : null}
              {cityLabel ? <><Icon as={MapPin} size={13} className="text-white" /><Text className="text-white text-[12.5px] font-medium">{cityLabel}</Text></> : null}
            </View>
          </View>
          <Pressable onPress={() => router.back()} className="absolute left-[16px] h-[36px] w-[36px] items-center justify-center rounded-full bg-white/90" style={{ top: insets.top + 4 }} accessibilityRole="button" accessibilityLabel="Back">
            <Icon as={ChevronLeft} size={20} className="text-foreground" />
          </Pressable>
        </View>

        <View className="px-[22px]">
          <View className="-mt-[62px] rounded-[18px]" style={{ shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4 }}>
            <View className="rounded-[18px] border border-border bg-background p-[13px]">
              <Pressable className="flex-row items-center gap-[10px]" onPress={() => router.push(`/org/${event.org_id}`)} accessibilityRole="button">
                <OrgAvatar name={event.org_name} color={event.org_color} logoUrl={event.org_logo_url} size={32} />
                <View className="flex-1">
                  <Text className="text-[13px] font-semibold text-foreground">{event.org_name}</Text>
                  {orgLocation ? <Text className="text-[11.5px] text-muted-foreground mt-[1px]">{orgLocation}</Text> : null}
                </View>
                <View className="flex-row items-center">
                  <Text className="text-primary text-[12.5px] font-semibold">View</Text>
                  <Icon as={ChevronRight} size={14} className="text-primary" />
                </View>
              </Pressable>
              <View className="mt-[12px]">
                {statRows.map((row, ri) => (
                  <View key={ri} className={cn("flex-row", ri > 0 && "border-t border-border")}>
                    {row.map((s, ci) => (
                      <View key={s.label} className={cn("flex-1 flex-row items-center gap-[9px] px-[12px] py-[11px]", ci === 0 && "border-r border-border")}>
                        <Icon as={s.icon} size={17} className="text-primary" />
                        <View className="flex-1">
                          <Text className="text-[14px] font-bold text-foreground" numberOfLines={1} style={{ fontVariant: ["tabular-nums"] }}>{s.value}</Text>
                          <Text className="text-[9px] font-semibold uppercase text-muted-foreground mt-[1px]" style={{ letterSpacing: 0.5 }}>{s.label}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            </View>
          </View>
        </View>

        <StatusBanner event={event} />

        <View className="px-[22px] pt-[16px]">
          {event.description ? <Text className="text-[14px] text-foreground leading-[22px]">{event.description}</Text> : null}

          <View className="mt-[14px] gap-[8px]">
            {(fullAddress || event.place) ? (
              <View className="flex-row items-center gap-[8px]">
                <Icon as={MapPin} size={15} className="text-muted-foreground" />
                <Text className="text-[13px] text-muted-foreground flex-1">{fullAddress || event.place}</Text>
              </View>
            ) : null}
            {event.venue ? (
              <View className="flex-row items-center gap-[8px]">
                <Icon as={Flag} size={15} className="text-muted-foreground" />
                <Text className="text-[13px] text-muted-foreground flex-1">{event.venue}</Text>
              </View>
            ) : null}
          </View>

          <Text className="text-[18px] font-bold tracking-[-0.3px] text-foreground mt-[22px] mb-[12px]">Pick a distance</Text>
          <View className="gap-[10px]">
            {categories.length === 0 ? <Text className="text-muted-foreground text-[13px]">No categories open.</Text> : null}
            {categories.map((c) => {
              const on = c.id === selectedId;
              const left = c.slots_total - c.slots_taken;
              const disabled = !registerable || left <= 0;
              return (
                <Pressable
                  key={c.id}
                  disabled={disabled}
                  onPress={() => setSelected(c.id)}
                  className={cn(
                    "flex-row items-center gap-[13px] p-[14px] rounded-[14px] border-[1.5px] border-border bg-background",
                    on && "border-primary bg-secondary",
                    disabled && "opacity-50"
                  )}
                  accessibilityRole="button"
                >
                  <View className={cn("w-[22px] h-[22px] rounded-[11px] border-2 items-center justify-center", on ? "bg-primary border-primary" : "bg-transparent border-border")}>
                    {on ? <Text className="text-primary-foreground text-[12px] font-bold">✓</Text> : null}
                  </View>
                  <View className="flex-1">
                    <Text className="text-[15px] font-semibold text-foreground">{c.label}</Text>
                    <Text className="text-[12px] text-muted-foreground mt-[2px]">{left <= 0 ? "Sold out" : `${left} slots left`}</Text>
                  </View>
                  <Text className="text-[15px] font-semibold text-primary">{formatPeso(c.base_price)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <View className="absolute left-0 right-0 bottom-0 px-[22px] pt-[14px] bg-background border-t border-divider" style={{ paddingBottom: insets.bottom + 16 }}>
        {registerable ? (
          <Button className="h-auto py-[15px] sm:h-auto" onPress={() => selectedId && router.push(`/register/${selectedId}`)} accessibilityRole="button">
            <Text className="text-[16px] font-semibold">Register{selectedCat ? ` · ${selectedCat.label}` : ""}</Text>
          </Button>
        ) : (
          <View className="bg-muted rounded-full py-[15px] items-center">
            <Text className="text-muted-foreground text-[16px] font-semibold">Registration closed</Text>
          </View>
        )}
      </View>
    </View>
  );
}
