import { useEffect, useState } from "react";
import { View, FlatList, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { useMyRegistrations } from "../../lib/registration";
import { useGlobalRefresh } from "../../lib/useGlobalRefresh";
import { cacheMyRaces, getCachedMyRaces, type CachedTicket } from "../../lib/ticketCache";
import { shortDate } from "../../lib/format";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Text } from "@/components/ui/text";

type Row = { id: string; eventName: string; categoryLabel: string; km: number | null; date: string | null; status: string };

export default function MyRaces() {
  const { data, isLoading, isError, refetch } = useMyRegistrations();
  const { refreshing, onRefresh } = useGlobalRefresh();
  const router = useRouter();
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

  if (!data && (cached === null || isLoading)) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator className="text-primary" />
      </View>
    );
  }
  if (isError && !data && rows.length === 0) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Pressable onPress={() => refetch()} accessibilityRole="button">
          <Text className="text-destructive">Couldn't load. Tap to retry.</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      className="flex-1 bg-background"
      data={rows}
      keyExtractor={(r) => r.id}
      contentContainerClassName="px-[22px] pt-2 pb-8"
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListHeaderComponent={<Text className="mb-2 text-3xl font-bold tracking-[-0.5px] text-foreground">My Races</Text>}
      ListEmptyComponent={
        <View className="items-center pt-20">
          <View className="h-[74px] w-[74px] items-center justify-center rounded-full bg-muted">
            <Text className="text-[30px] text-muted-foreground">⚑</Text>
          </View>
          <Text className="mt-[18px] text-lg font-semibold text-foreground">No registrations yet</Text>
          <Text className="mt-1.5 max-w-[230px] text-center text-sm text-muted-foreground">
            Find a trail worth chasing and your races will show up here.
          </Text>
          <Pressable
            className="mt-5 rounded-full bg-primary px-[26px] py-[13px]"
            onPress={() => router.push("/(tabs)/events")}
            accessibilityRole="button"
          >
            <Text className="text-[15px] font-semibold text-primary-foreground">Browse events</Text>
          </Pressable>
        </View>
      }
      renderItem={({ item }) => {
        const paid = item.status === "paid";
        const meta = [item.categoryLabel, item.date ? shortDate(item.date) : null].filter(Boolean).join(" · ");
        return (
          <Pressable onPress={() => router.push(paid ? `/ticket/${item.id}` : `/pay/${item.id}`)} accessibilityRole="button">
            <Card className="mb-3 flex-row items-center gap-3.5 rounded-[14px] p-4 shadow-none shadow-transparent">
              <View className="h-[46px] w-[46px] items-center justify-center rounded-[13px] bg-secondary">
                <Text className="text-[13px] font-bold leading-[15px] text-primary">{item.km ?? "—"}</Text>
                <Text className="text-[9px] font-bold text-primary">KM</Text>
              </View>
              <View className="flex-1">
                <Text className="text-[15px] font-semibold text-foreground">{item.eventName}</Text>
                {meta ? <Text className="mt-0.5 text-xs text-muted-foreground">{meta}</Text> : null}
              </View>
              <Badge variant={paid ? "paid" : undefined} className={paid ? undefined : "bg-muted"}>
                <Text className={paid ? undefined : "text-muted-foreground"}>{paid ? "Paid" : "Pending"}</Text>
              </Badge>
            </Card>
          </Pressable>
        );
      }}
    />
  );
}
