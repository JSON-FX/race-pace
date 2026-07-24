import { useMarketplaceEvents, useOrgs } from "../../lib/events";
import { useGlobalRefresh } from "../../lib/useGlobalRefresh";
import { FilterableEventList } from "../../components/FilterableEventList";
import { Text } from "@/components/ui/text";

export default function Marketplace() {
  const { data, isLoading, isError, refetch } = useMarketplaceEvents();
  const { data: orgs } = useOrgs();
  const { refreshing, onRefresh } = useGlobalRefresh();

  return (
    <FilterableEventList
      events={data ?? []}
      orgs={orgs ?? []}
      isLoading={isLoading}
      isError={isError}
      onRetry={refetch}
      refreshing={refreshing}
      onRefresh={onRefresh}
      contentContainerClassName="pt-2 pb-8"
      emptyMessage="Check back soon — new races drop weekly."
      topHeader={<Text className="text-3xl font-bold tracking-[-0.5px] px-[22px] text-foreground">Events</Text>}
    />
  );
}
