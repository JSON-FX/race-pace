import { useState } from "react";
import { View, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatPeso } from "@race-pace/shared";
import { useEvent, useCategories } from "../../lib/events";
import { EventGallery } from "../../components/EventGallery";
import { OrgAvatar } from "../../components/OrgAvatar";
import { StatusBanner, eventStatusKind } from "../../components/StatusBadge";
import { longDate } from "../../lib/format";
import { Button } from "@/components/ui/button";
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
  const meta = [
    (fullAddress || event.place) && `◎ ${fullAddress || [event.place, event.region].filter(Boolean).join(" · ")}`,
    event.venue && `🏁 ${event.venue}`,
    event.event_date && `⚑ ${longDate(event.event_date)}`,
    event.elevation_gain_m && `▲ ${event.elevation_gain_m.toLocaleString()}m gain`,
    event.cutoff_hours && `⏱ ${event.cutoff_hours}h cutoff`,
  ].filter(Boolean) as string[];

  return (
    <View className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
        <View>
          <EventGallery images={[event.hero_image_url, ...(event.gallery ?? [])]} height={250} />
          <Pressable
            onPress={() => router.back()}
            className="absolute left-[18px] w-[36px] h-[36px] rounded-full bg-white/90 items-center justify-center"
            style={{ top: insets.top + 4 }}
            accessibilityRole="button"
          >
            <Text className="text-[20px] text-[#1D1D1F] -mt-[2px]">‹</Text>
          </Pressable>
        </View>

        <StatusBanner event={event} />

        <View className="px-[22px] pt-[18px]">
          <Text className="text-[26px] font-bold tracking-[-0.4px] text-foreground leading-[30px]">{event.name}</Text>

          <Pressable className="flex-row items-center gap-[10px] bg-muted rounded-[14px] py-[11px] px-[13px] mt-[14px]" onPress={() => router.push(`/org/${event.org_id}`)} accessibilityRole="button">
            <OrgAvatar name={event.org_name} color={event.org_color} size={34} />
            <View className="flex-1">
              <Text className="text-[13px] font-semibold text-foreground">{event.org_name}</Text>
              {(event.province_name ?? event.region) ? <Text className="text-[12px] text-muted-foreground mt-[1px]">{event.province_name ?? event.region}</Text> : null}
            </View>
            <Text className="text-primary text-[13px] font-semibold">View ›</Text>
          </Pressable>

          {event.description ? <Text className="text-[14px] text-foreground leading-[22px] mt-[14px]">{event.description}</Text> : null}

          {meta.length ? (
            <View className="flex-row flex-wrap gap-[16px] mt-[16px]">
              {meta.map((m) => <Text key={m} className="text-[13px] text-muted-foreground">{m}</Text>)}
            </View>
          ) : null}

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
