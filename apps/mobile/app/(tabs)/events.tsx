import { useMemo, useState } from "react";
import { View, TextInput, FlatList, ActivityIndicator, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { Search } from "lucide-react-native";
import { useMarketplaceEvents } from "../../lib/events";
import { EventCard } from "../../components/EventCard";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";

export default function Marketplace() {
  const { data, isLoading, isError, refetch } = useMarketplaceEvents();
  const router = useRouter();
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const list = data ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((e) => [e.name, e.place, e.region, e.city_name, e.province_name, e.region_name, e.org_name].filter(Boolean).some((s) => s!.toLowerCase().includes(needle)));
  }, [data, q]);

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
        <Pressable onPress={() => refetch()} accessibilityRole="button">
          <Text className="text-destructive">Couldn't load events. Tap to retry.</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      className="flex-1 bg-background"
      data={rows}
      keyExtractor={(e) => e.id}
      contentContainerClassName="px-[22px] pt-2 pb-8"
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={
        <View className="mb-4">
          <Text className="text-3xl font-bold tracking-[-0.5px] text-foreground">Events</Text>
          <View className="flex-row items-center gap-2 bg-muted rounded-[11px] py-3 px-[14px] mt-[14px]">
            <Icon as={Search} size={17} className="text-muted-foreground" />
            <TextInput
              className="flex-1 p-0 text-[15px] text-foreground placeholder:text-muted-foreground"
              value={q}
              onChangeText={setQ}
              placeholder="Search by name or place"
              autoCapitalize="none"
              accessibilityLabel="Search events"
            />
          </View>
        </View>
      }
      ListEmptyComponent={
        <View className="items-center pt-20">
          <View className="h-[74px] w-[74px] items-center justify-center rounded-full bg-muted">
            <Icon as={Search} size={30} className="text-muted-foreground" />
          </View>
          <Text className="text-lg font-semibold text-foreground mt-[18px]">No events found</Text>
          <Text className="text-sm text-muted-foreground mt-1.5 text-center max-w-[240px]">
            {q ? "Try a different search." : "Check back soon — new races drop weekly."}
          </Text>
        </View>
      }
      renderItem={({ item }) => <EventCard event={item} onPress={() => router.push(`/event/${item.id}`)} />}
    />
  );
}
