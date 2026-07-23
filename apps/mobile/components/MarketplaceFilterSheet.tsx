import { useEffect, useState } from "react";
import { View, Pressable, ScrollView } from "react-native";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { PillMultiSelect } from "./PillMultiSelect";
import { RegionFilterPicker } from "./RegionFilterPicker";
import { OrganizerFilterPicker } from "./OrganizerFilterPicker";
import {
  DISTANCE_BUCKET_ORDER, DISTANCE_BUCKET_LABELS,
  DEFAULT_MARKETPLACE_FILTERS, filterMarketplaceEvents,
  type MarketplaceFilters, type RegionFilterValue,
} from "@/lib/marketplaceFilters";
import type { EventRow, OrgRow } from "@/lib/events";

function regionSummary(region: RegionFilterValue | null): string {
  if (!region) return "All regions";
  return region.city_name ?? region.province_name ?? region.region_name;
}

type SubView = "root" | "region" | "organizer";

export function MarketplaceFilterSheet({ open, onOpenChange, filters, onApply, allEvents, orgs, todayIso }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  filters: MarketplaceFilters; onApply: (f: MarketplaceFilters) => void;
  allEvents: EventRow[]; orgs: OrgRow[]; todayIso: string;
}) {
  const [draft, setDraft] = useState<MarketplaceFilters>(filters);
  const [subView, setSubView] = useState<SubView>("root");

  useEffect(() => {
    if (open) { setDraft(filters); setSubView("root"); }
  }, [open, filters]);

  const matchCount = filterMarketplaceEvents(allEvents, draft, todayIso).length;

  function apply() {
    onApply(draft);
    onOpenChange(false);
  }
  function reset() {
    setDraft((d) => ({ ...DEFAULT_MARKETPLACE_FILTERS, dateSegment: d.dateSegment, showPast: d.showPast }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        overlayClassName="justify-end items-stretch p-0"
        showCloseButton={false}
        className="rounded-b-none rounded-t-[22px] mx-0 w-full max-w-full min-h-[420px] max-h-[80%] gap-0"
      >
        <View className="w-9 h-1 rounded-full bg-border self-center mb-3" />

        {subView === "root" ? (
          <>
            <View className="flex-row items-center justify-between mb-2">
              <Text className="text-[17px] font-bold text-foreground">More filters</Text>
              <Pressable onPress={reset} accessibilityRole="button">
                <Text className="text-[12.5px] text-muted-foreground">Reset</Text>
              </Pressable>
            </View>

            <ScrollView>
              <Text className="text-[12px] font-bold uppercase tracking-[0.5px] text-muted-foreground mt-2 mb-2">Region</Text>
              <Pressable
                onPress={() => setSubView("region")}
                accessibilityRole="button"
                className="flex-row items-center justify-between py-3 border-b border-divider"
              >
                <Text className="text-[14.5px] text-foreground">Region / Province / City</Text>
                <View className="flex-row items-center gap-1">
                  <Text className="text-[13px] text-muted-foreground">{regionSummary(draft.region)}</Text>
                  <Icon as={ChevronRight} size={16} className="text-muted-foreground" />
                </View>
              </Pressable>

              <PillMultiSelect
                label="DISTANCE"
                value={draft.distanceBuckets}
                options={DISTANCE_BUCKET_ORDER}
                labels={DISTANCE_BUCKET_LABELS}
                onChange={(v) => setDraft((d) => ({ ...d, distanceBuckets: v as MarketplaceFilters["distanceBuckets"] }))}
              />

              <Text className="text-[12px] font-bold uppercase tracking-[0.5px] text-muted-foreground mt-5 mb-2">Organizer</Text>
              <Pressable
                onPress={() => setSubView("organizer")}
                accessibilityRole="button"
                className="flex-row items-center justify-between py-3 border-b border-divider"
              >
                <Text className="text-[14.5px] text-foreground">
                  {draft.orgIds.length > 0 ? `${draft.orgIds.length} selected` : "All organizers"}
                </Text>
                <Icon as={ChevronRight} size={16} className="text-muted-foreground" />
              </Pressable>
            </ScrollView>

            <View className="flex-row gap-[10px] mt-[18px]">
              <Button variant="outline" className="flex-1" onPress={() => onOpenChange(false)}>
                <Text>Cancel</Text>
              </Button>
              <Button className="flex-1" onPress={apply}>
                <Text>Show {matchCount} {matchCount === 1 ? "event" : "events"}</Text>
              </Button>
            </View>
          </>
        ) : null}

        {subView === "region" ? (
          <>
            <View className="flex-row items-center gap-[10px] mb-4">
              <Pressable onPress={() => setSubView("root")} accessibilityRole="button" accessibilityLabel="Back">
                <Icon as={ChevronLeft} size={20} className="text-primary" />
              </Pressable>
              <Text className="text-[17px] font-bold text-foreground">Region</Text>
            </View>
            <RegionFilterPicker onChange={(region) => setDraft((d) => ({ ...d, region }))} />
          </>
        ) : null}

        {subView === "organizer" ? (
          <OrganizerFilterPicker
            orgs={orgs}
            selectedIds={draft.orgIds}
            onChangeSelectedIds={(orgIds) => setDraft((d) => ({ ...d, orgIds }))}
            onBack={() => setSubView("root")}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
