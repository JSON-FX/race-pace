import { useEffect, useMemo, useState } from "react";
import { View, FlatList, Pressable, ActivityIndicator, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { formatPeso } from "@race-pace/shared";
import { useMyRegistrations, cancelRegistration, type RegistrationRow } from "../../lib/registration";
import { useGlobalRefresh } from "../../lib/useGlobalRefresh";
import { cacheMyRaces, getCachedMyRaces, type CachedTicket } from "../../lib/ticketCache";
import { groupMyRaces, defaultSegment, type SegmentKey } from "../../lib/myRacesGroups";
import { shortDate, todayIsoNow } from "../../lib/format";
import { RaceCard } from "../../components/RaceCard";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

const SEGMENTS: { key: SegmentKey; label: string }[] = [
  { key: "registered", label: "Registered" },
  { key: "completed", label: "Completed" },
  { key: "unpaid", label: "Unpaid" },
];

const EMPTY_COPY: Record<SegmentKey, { title: string; body: string }> = {
  registered: { title: "No upcoming races", body: "Races you've paid for show up here until race day." },
  completed: { title: "No completed races", body: "Finished races land here with your receipt." },
  unpaid: { title: "Nothing to pay", body: "Registrations awaiting payment show up here." },
};

function cachedToRows(cached: CachedTicket[]): RegistrationRow[] {
  return cached.map((c) => ({
    id: c.rid, status: c.status, total_amount: 0, ticket_token: c.token, org_id: c.orgId,
    eventName: c.eventName, categoryLabel: c.categoryLabel, categoryDistance: null, checkoutUrl: null,
    eventStatus: null, eventDate: null, originalDate: null, statusNote: null, payment: null,
  }));
}

export default function MyRaces() {
  const { data, isLoading, isError, refetch } = useMyRegistrations();
  const { refreshing, onRefresh } = useGlobalRefresh();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [cached, setCached] = useState<CachedTicket[] | null>(null);
  const [segment, setSegment] = useState<SegmentKey | null>(null);
  const [pendingCancel, setPendingCancel] = useState<RegistrationRow | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  useEffect(() => { getCachedMyRaces().then(setCached).catch(() => setCached([])); }, []);

  useEffect(() => {
    if (data) {
      cacheMyRaces(data.map((r) => ({
        rid: r.id, token: r.ticket_token, eventName: r.eventName, categoryLabel: r.categoryLabel,
        runnerName: "", status: r.status, orgId: r.org_id,
      })));
    }
  }, [data]);

  const rows: RegistrationRow[] = data ?? (cached ? cachedToRows(cached) : []);
  const groups = useMemo(() => groupMyRaces(rows, todayIsoNow()), [rows]);
  const activeSegment: SegmentKey = segment ?? defaultSegment(groups);

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

  async function confirmCancel() {
    if (!pendingCancel) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelRegistration(pendingCancel.id);
      await queryClient.invalidateQueries({ queryKey: ["my-registrations"] });
      setPendingCancel(null);
    } catch {
      setCancelError("Couldn't cancel. Try again.");
    } finally {
      setCancelling(false);
    }
  }

  function renderCard(item: RegistrationRow) {
    if (activeSegment === "unpaid") {
      const meta = [item.categoryLabel, item.total_amount ? `${formatPeso(item.total_amount)} due` : null].filter(Boolean).join(" · ");
      return (
        <RaceCard
          variant="unpaid" title={item.eventName} meta={meta} distanceKm={item.categoryDistance}
          onPress={() => router.push(`/pay/${item.id}`)}
          onPay={() => router.push(`/pay/${item.id}`)}
          onCancel={() => { setCancelError(null); setPendingCancel(item); }}
        />
      );
    }
    const meta = [item.categoryLabel, item.eventDate ? shortDate(item.eventDate) : null].filter(Boolean).join(" · ");
    if (activeSegment === "completed") {
      const refunded = item.status === "refunded";
      return (
        <RaceCard
          variant={refunded ? "refunded" : "completed"} title={item.eventName} meta={meta} distanceKm={item.categoryDistance}
          onPress={() => router.push(`/registration/${item.id}`)}
        />
      );
    }
    return (
      <RaceCard
        variant="registered" title={item.eventName} meta={meta} distanceKm={item.categoryDistance}
        onPress={() => router.push(`/ticket/${item.id}`)}
      />
    );
  }

  return (
    <View className="flex-1 bg-background">
      <FlatList
        data={groups[activeSegment]}
        keyExtractor={(r) => r.id}
        contentContainerClassName="px-[22px] pt-2 pb-8"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <View>
            <Text className="mb-3 text-3xl font-bold tracking-[-0.5px] text-foreground">My races</Text>
            <View className="mb-2 flex-row rounded-[12px] bg-muted p-[3px]">
              <ToggleGroup
                type="single"
                value={activeSegment}
                onValueChange={(v) => { if (v) setSegment(v as SegmentKey); }}
                className="flex-1 flex-row"
              >
                {SEGMENTS.map((s) => {
                  const active = activeSegment === s.key;
                  const count = groups.counts[s.key];
                  return (
                    <ToggleGroupItem
                      key={s.key}
                      value={s.key}
                      accessibilityLabel={s.label}
                      className={cn("flex-1 rounded-[9px] py-2", active ? "bg-primary" : "bg-transparent")}
                    >
                      <Text
                        className={cn(
                          "text-center text-[12.5px]",
                          active
                            ? "font-semibold text-primary-foreground"
                            : s.key === "unpaid" && count > 0
                              ? "font-semibold text-amber"
                              : "text-muted-foreground"
                        )}
                      >
                        {s.label} {count}
                      </Text>
                    </ToggleGroupItem>
                  );
                })}
              </ToggleGroup>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View className="items-center pt-16">
            <View className="h-[74px] w-[74px] items-center justify-center rounded-full bg-muted">
              <Text className="text-[30px] text-muted-foreground">⚑</Text>
            </View>
            <Text className="mt-[18px] text-lg font-semibold text-foreground">{EMPTY_COPY[activeSegment].title}</Text>
            <Text className="mt-1.5 max-w-[230px] text-center text-sm text-muted-foreground">{EMPTY_COPY[activeSegment].body}</Text>
            <Pressable
              className="mt-5 rounded-full bg-primary px-[26px] py-[13px]"
              onPress={() => router.push("/(tabs)/events")}
              accessibilityRole="button"
            >
              <Text className="text-[15px] font-semibold text-primary-foreground">Browse events</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => renderCard(item)}
      />

      <Dialog open={pendingCancel !== null} onOpenChange={(o) => { if (!o) { setPendingCancel(null); setCancelError(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this registration?</DialogTitle>
            <DialogDescription>
              This removes {pendingCancel?.eventName}{pendingCancel?.categoryLabel ? ` · ${pendingCancel.categoryLabel}` : ""} from your races. It can't be undone.
            </DialogDescription>
          </DialogHeader>
          {cancelError ? <Text className="text-center text-[13px] text-destructive">{cancelError}</Text> : null}
          <DialogFooter>
            <Button variant="destructive" onPress={confirmCancel} disabled={cancelling} accessibilityRole="button">
              <Text className="font-semibold text-white">{cancelling ? "Cancelling…" : "Cancel registration"}</Text>
            </Button>
            <Button variant="outline" onPress={() => { setPendingCancel(null); setCancelError(null); }} accessibilityRole="button">
              <Text className="font-semibold text-foreground">Keep it</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </View>
  );
}
