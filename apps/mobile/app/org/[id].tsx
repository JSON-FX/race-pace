import { View, Pressable, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useOrg, useEventsByOrg } from "../../lib/events";
import { useGlobalRefresh } from "../../lib/useGlobalRefresh";
import { OrgHeader } from "../../components/OrgHeader";
import { FilterableEventList } from "../../components/FilterableEventList";
import { Text } from "@/components/ui/text";

export default function OrgPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const org = useOrg(id);
  const events = useEventsByOrg(id);
  const { refreshing, onRefresh } = useGlobalRefresh();

  if (org.isLoading) return <View className="flex-1 items-center justify-center bg-background"><ActivityIndicator className="text-primary" /></View>;
  if (!org.data) return <View className="flex-1 items-center justify-center bg-background"><Text className="text-muted-foreground text-[13px]">Organization not found.</Text></View>;

  // The organizer filter is redundant on a single-org page, so scope its picker
  // to just this org (with a synthesized event_count, which the picker needs to
  // list it) rather than every org — otherwise you could filter this page down
  // to a different org and get zero results.
  const orgsForFilter = [{ ...org.data, event_count: events.data?.length ?? 0 }];

  return (
    <View className="flex-1 bg-background">
      <FilterableEventList
        events={events.data ?? []}
        orgs={orgsForFilter}
        showOrgOnCards={false}
        isLoading={events.isLoading}
        isError={events.isError}
        onRetry={events.refetch}
        refreshing={refreshing}
        onRefresh={onRefresh}
        emptyMessage="No events yet."
        topHeader={
          <>
            <OrgHeader org={org.data} eventCount={events.data?.length} />
            <Text className="text-lg font-bold tracking-[-0.3px] px-[22px] mt-[22px] text-foreground">Events</Text>
          </>
        }
      />
      <Pressable
        onPress={() => router.back()}
        className="absolute left-[18px] w-9 h-9 rounded-full bg-white/90 items-center justify-center"
        style={{ top: insets.top + 4 }}
        accessibilityRole="button"
      >
        <Text className="text-[20px] text-[#1D1D1F] -mt-[2px]">‹</Text>
      </Pressable>
    </View>
  );
}
