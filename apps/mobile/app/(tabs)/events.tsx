import { useMemo, useState } from "react";
import { View, SectionList, ActivityIndicator, Pressable, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { Search } from "lucide-react-native";
import { useMarketplaceEvents, useOrgs } from "../../lib/events";
import { useGlobalRefresh } from "../../lib/useGlobalRefresh";
import { EventCard } from "../../components/EventCard";
import { FeaturedCarousel } from "../../components/FeaturedCarousel";
import { MarketplaceFilterBar } from "../../components/MarketplaceFilterBar";
import { MarketplaceFilterSheet } from "../../components/MarketplaceFilterSheet";
import {
  DEFAULT_MARKETPLACE_FILTERS, filterMarketplaceEvents, pickFeaturedEvents,
  groupEventsForDisplay, countActiveFilters, type MarketplaceFilters,
} from "../../lib/marketplaceFilters";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";

const PAST_EVENTS_TITLE = "Past events";

function todayIsoNow(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Marketplace() {
  const { data, isLoading, isError, refetch } = useMarketplaceEvents();
  const { data: orgs } = useOrgs();
  const { refreshing, onRefresh } = useGlobalRefresh();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<MarketplaceFilters>(DEFAULT_MARKETPLACE_FILTERS);
  const [sheetOpen, setSheetOpen] = useState(false);
  const todayIso = todayIsoNow();

  const allEvents = data ?? [];

  function search(list: typeof allEvents) {
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((e) =>
      [e.name, e.place, e.region, e.city_name, e.province_name, e.region_name, e.org_name].filter(Boolean).some((s) => s!.toLowerCase().includes(needle))
    );
  }

  // Upcoming and past are computed independently (not as an either/or mode
  // switch) so the scroll order is always upcoming -> current -> past, with
  // past appended at the very end rather than replacing the list above it.
  const upcoming = useMemo(
    () => search(filterMarketplaceEvents(allEvents, { ...filters, showPast: false }, todayIso)),
    [allEvents, filters, q, todayIso]
  );
  const past = useMemo(
    () => search(filterMarketplaceEvents(allEvents, { ...filters, showPast: true }, todayIso)),
    [allEvents, filters, q, todayIso]
  );

  const featured = useMemo(() => pickFeaturedEvents(upcoming, todayIso), [upcoming, todayIso]);
  const featuredIds = useMemo(() => new Set(featured.map((e) => e.id)), [featured]);
  const listEvents = useMemo(() => upcoming.filter((e) => !featuredIds.has(e.id)), [upcoming, featuredIds]);
  const upcomingSections = useMemo(
    () => groupEventsForDisplay(listEvents, filters.dateSegment, todayIso),
    [listEvents, filters.dateSegment, todayIso]
  );
  const sections = useMemo(() => {
    if (!filters.showPast || past.length === 0) return upcomingSections;
    return [...upcomingSections, { title: PAST_EVENTS_TITLE, data: past }];
  }, [upcomingSections, past, filters.showPast]);

  function clearFilters() {
    setFilters(DEFAULT_MARKETPLACE_FILTERS);
    setQ("");
  }

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator className="text-primary" />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Button variant="ghost" onPress={() => refetch()}>
          <Text className="text-destructive">Couldn't load events. Tap to retry.</Text>
        </Button>
      </View>
    );
  }

  const hasActiveFilters = countActiveFilters(filters) > 0 || filters.dateSegment !== "all";
  const pastSectionShown = sections.some((s) => s.title === PAST_EVENTS_TITLE);

  return (
    <>
      <SectionList
        className="flex-1 bg-background"
        sections={sections}
        keyExtractor={(e) => e.id}
        contentContainerClassName="px-[22px] pt-2 pb-8"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View className="mb-2">
            <Text className="text-3xl font-bold tracking-[-0.5px] text-foreground">Events</Text>
            <View className="flex-row items-center gap-2 bg-muted rounded-[11px] py-3 px-[14px] mt-[14px]">
              <Icon as={Search} size={17} className="text-muted-foreground" />
              <Input
                className="flex-1 border-0 bg-transparent h-auto p-0 shadow-none text-[15px]"
                value={q}
                onChangeText={setQ}
                placeholder="Search by name or place"
                autoCapitalize="none"
                accessibilityLabel="Search events"
              />
            </View>

            <MarketplaceFilterBar
              dateSegment={filters.dateSegment}
              onDateSegmentChange={(dateSegment) => setFilters((f) => ({ ...f, dateSegment }))}
              activeFilterCount={countActiveFilters(filters)}
              onPressMoreFilters={() => setSheetOpen(true)}
            />

            {featured.length > 0 ? (
              <View className="mt-5">
                <Text className="text-[13px] font-bold uppercase tracking-[0.6px] text-muted-foreground mb-3">Coming up soon</Text>
                <FeaturedCarousel events={featured} onPressEvent={(e) => router.push(`/event/${e.id}`)} />
              </View>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) =>
          section.title === PAST_EVENTS_TITLE ? (
            <Pressable
              onPress={() => setFilters((f) => ({ ...f, showPast: false }))}
              accessibilityRole="button"
              className="flex-row items-center justify-between mt-2 pt-4 pb-3 border-t border-divider"
            >
              <Text className="text-[13px] font-bold uppercase tracking-[0.6px] text-muted-foreground">Past events</Text>
              <Text className="text-[12.5px] font-semibold text-primary">Hide</Text>
            </Pressable>
          ) : section.title ? (
            <View className="flex-row items-center gap-[10px] my-3">
              <View className="flex-1 h-px bg-divider" />
              <Text className="text-[12.5px] font-bold text-muted-foreground">{section.title}</Text>
              <View className="flex-1 h-px bg-divider" />
            </View>
          ) : null
        }
        ListFooterComponent={
          pastSectionShown ? null : (
            <Pressable
              onPress={() => setFilters((f) => ({ ...f, showPast: !f.showPast }))}
              accessibilityRole="button"
              className="flex-row items-center justify-between mt-5 pt-4 border-t border-divider"
            >
              <Text className="text-[13px] font-bold uppercase tracking-[0.6px] text-muted-foreground">Past events</Text>
              <Text className="text-[12.5px] font-semibold text-primary">{filters.showPast ? "Hide" : "Show"}</Text>
            </Pressable>
          )
        }
        ListEmptyComponent={
          <View className="items-center pt-20">
            <View className="h-[74px] w-[74px] items-center justify-center rounded-full bg-muted">
              <Icon as={Search} size={30} className="text-muted-foreground" />
            </View>
            <Text className="text-lg font-semibold text-foreground mt-[18px]">No events found</Text>
            <Text className="text-sm text-muted-foreground mt-1.5 text-center max-w-[240px]">
              {q ? "Try a different search." : hasActiveFilters ? "No events match your filters." : "Check back soon — new races drop weekly."}
            </Text>
            {hasActiveFilters ? (
              <Pressable onPress={clearFilters} accessibilityRole="button" className="mt-4">
                <Text className="text-[14px] font-semibold text-primary">Clear filters</Text>
              </Pressable>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <EventCard event={item} onPress={() => router.push(`/event/${item.id}`)} />}
      />

      <MarketplaceFilterSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        filters={filters}
        onApply={setFilters}
        allEvents={allEvents}
        orgs={orgs ?? []}
        todayIso={todayIso}
      />
    </>
  );
}
