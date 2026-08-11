import { useState } from "react";
import { View, ScrollView, Pressable, ActivityIndicator } from "react-native";
import Svg, { Defs, LinearGradient, Stop, Rect } from "react-native-svg";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Calendar, MapPin, Flag, Mountain, Clock, Check, Route, type LucideIcon } from "lucide-react-native";
import { formatPeso, formatDateRange } from "@race-pace/shared";
import { useEvent, useCategories } from "../../lib/events";
import { supabase } from "../../lib/supabase";
import { holdExpired } from "../../lib/holdExpiry";
import { EventGallery } from "../../components/EventGallery";
import { OrgAvatar } from "../../components/OrgAvatar";
import { StatusBanner } from "../../components/StatusBadge";
import { longDate, flagOffLabel } from "../../lib/format";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

/** The one live entry a runner may hold for this event, if they hold one.
 *  `expires_at` is only meaningful while `status` is "pending". Mirrors
 *  apps/site/lib/entry.ts's `MyEntry` (kept snake_case here to match the raw
 *  row shape, since this file has no server/client boundary to cross). */
type MyEntry = { id: string; status: "pending" | "paid"; category_id: string; expires_at: string | null };

export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const ev = useEvent(id);
  const cats = useCategories(id);
  const [selected, setSelected] = useState<string | null>(null);

  // One entry per event, so this gates EVERY distance below, not just the one
  // the runner picked. Mirrors apps/site/lib/entry.ts's fetchMyEntry, and the
  // expiry check uses this app's own holdExpired copy (lib/holdExpiry.ts,
  // itself a deliberate copy of apps/site/lib/holdExpiry.ts): a pending row
  // past its expires_at is already gone to the server (registrations-
  // checkout), whether or not the 15-minute sweep has flipped its status yet.
  const { data: myEntry, isLoading: myEntryLoading } = useQuery({
    queryKey: ["my-entry", id],
    queryFn: async (): Promise<MyEntry | null> => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      const { data } = await supabase
        .from("registrations")
        .select("id,status,category_id,expires_at")
        .eq("event_id", id)
        .eq("user_id", auth.user.id)
        .in("status", ["pending", "paid"])
        .maybeSingle();
      if (!data) return null;
      if (holdExpired(data.status, data.expires_at ?? null)) return null;
      return data as MyEntry;
    },
  });

  // myEntry has to gate the initial paint too, not just ev/cats — it resolves later than
  // both (an extra auth.getUser() round-trip ahead of its own DB query), so without this the
  // ungated Register CTA and stale "N slots left" rows render for a beat, then snap to the
  // gated view once it lands. A signed-out runner still sees Register normally: myEntry
  // resolves to null quickly for them (no session to look up an entry for), it just has to
  // actually resolve first rather than defaulting registerable to false in the meantime.
  if (ev.isLoading || cats.isLoading || myEntryLoading) return <View className="flex-1 items-center justify-center bg-background"><ActivityIndicator className="text-primary" /></View>;
  const event = ev.data;
  if (!event) return <View className="flex-1 items-center justify-center bg-background"><Text className="text-muted-foreground text-[13px]">Event not found.</Text></View>;

  const categories = cats.data ?? [];
  const selectedId = selected ?? categories[0]?.id ?? null;
  const selectedCat = categories.find((c) => c.id === selectedId);
  const registerable = !["cancelled", "closed", "completed"].includes(event.status) && !myEntry;

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
              // An entry is one PER EVENT, so every row has to reflect it, not
              // just the one the runner actually picked — otherwise the other
              // rows would keep inviting a tap into a 409 the checkout has
              // already ruled out. "Mine" and "entered elsewhere" read as two
              // different states, same distinction the web DistanceRow makes:
              // paid is a settled confirmation, pending carries a deadline
              // and money so it stays the more urgent-looking of the two.
              const mine = myEntry?.category_id === c.id;
              const paidMine = mine && myEntry?.status === "paid";
              const pendingMine = mine && !paidMine;
              return (
                <Pressable
                  key={c.id}
                  disabled={disabled}
                  onPress={() => setSelected(c.id)}
                  className={cn(
                    "flex-row items-center gap-[13px] p-[14px] rounded-[14px] border-[1.5px] border-border bg-background",
                    on && !myEntry && "border-primary bg-secondary",
                    paidMine && "border-paid bg-paid-tint",
                    pendingMine && "border-amber bg-amber-tint",
                    disabled && !mine && "opacity-50"
                  )}
                  accessibilityRole="button"
                >
                  <View
                    className={cn(
                      "w-[22px] h-[22px] rounded-[11px] border-2 items-center justify-center",
                      // Colored ring + colored icon on the theme's own base surface
                      // (bg-background), not a solid paid/amber fill — a solid fill sitting
                      // on top of the row's own bg-paid-tint/bg-amber-tint would need a
                      // foreground color that flips with the fill in dark mode, and neither
                      // token has one (unlike primary/destructive, which define -foreground
                      // pairs). text-paid/text-amber on bg-background is the same base
                      // foreground/background pairing every other icon in this file already
                      // relies on for contrast, just recolored — both sides move together
                      // under .dark, so there's nothing here for dark mode to break.
                      paidMine
                        ? "bg-background border-paid"
                        : pendingMine
                          ? "bg-background border-amber"
                          : on
                            ? "bg-primary border-primary"
                            : "bg-transparent border-border"
                    )}
                  >
                    {paidMine ? (
                      <Icon as={Check} size={12} className="text-paid" />
                    ) : pendingMine ? (
                      <Icon as={Clock} size={12} className="text-amber" />
                    ) : on ? (
                      <Text className="text-primary-foreground text-[12px] font-bold">✓</Text>
                    ) : null}
                  </View>
                  <View className="flex-1">
                    <Text className="text-[15px] font-semibold text-foreground">{c.label}</Text>
                    <Text className={cn("text-[12px] mt-[2px]", paidMine ? "text-paid" : pendingMine ? "text-amber" : "text-muted-foreground")}>
                      {mine
                        ? paidMine
                          ? "Your entry — confirmed"
                          : "Your entry — payment pending"
                        : myEntry
                          ? "You're entered on another distance"
                          : left <= 0
                            ? "Sold out"
                            : `${left} slots left`}
                    </Text>
                  </View>
                  <Text className="text-[15px] font-semibold text-primary">{formatPeso(c.base_price)}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </ScrollView>

      <View className="absolute left-0 right-0 bottom-0 px-[22px] pt-[14px] bg-background border-t border-divider" style={{ paddingBottom: insets.bottom + 16 }}>
        {myEntry ? (
          // Same amber-vs-settled pairing as the distance rows above: paid is
          // a flat tint with no border (confirmation, nothing left to do);
          // pending keeps a visible amber border on top of the same tint —
          // same border width on both so switching states never resizes the
          // bar — because it's the one with a deadline and money attached.
          <Pressable
            className={cn(
              "rounded-full px-5 py-[15px] flex-row items-center justify-center gap-[8px] border-[1.5px]",
              myEntry.status === "paid" ? "border-transparent bg-paid-tint" : "border-amber bg-amber-tint"
            )}
            onPress={() => router.push(myEntry.status === "paid" ? `/registration/${myEntry.id}` : `/pay/${myEntry.id}`)}
            accessibilityRole="button"
            accessibilityLabel={myEntry.status === "paid" ? "You're in — view entry" : "Finish payment"}
          >
            <Icon as={myEntry.status === "paid" ? Check : Clock} size={17} className={myEntry.status === "paid" ? "text-paid" : "text-amber"} />
            <Text className={cn("text-[16px] font-semibold", myEntry.status === "paid" ? "text-paid" : "text-amber")}>
              {myEntry.status === "paid" ? "You're in — view entry" : "Finish payment"}
            </Text>
          </Pressable>
        ) : registerable ? (
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
