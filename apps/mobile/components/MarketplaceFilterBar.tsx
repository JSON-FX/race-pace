import { View, Pressable } from "react-native";
import { SlidersHorizontal } from "lucide-react-native";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DATE_SEGMENT_ORDER, DATE_SEGMENT_LABELS, type DateSegment } from "@/lib/marketplaceFilters";

export function MarketplaceFilterBar({ dateSegment, onDateSegmentChange, activeFilterCount, onPressMoreFilters }: {
  dateSegment: DateSegment; onDateSegmentChange: (s: DateSegment) => void;
  activeFilterCount: number; onPressMoreFilters: () => void;
}) {
  return (
    <View className="mt-[14px]">
      <View className="flex-row bg-muted rounded-[12px] p-[3px]">
        <ToggleGroup
          type="single"
          value={dateSegment}
          onValueChange={(v) => { if (v) onDateSegmentChange(v as DateSegment); }}
          className="flex-row flex-1"
        >
          {DATE_SEGMENT_ORDER.map((seg) => {
            const active = dateSegment === seg;
            return (
              <ToggleGroupItem
                key={seg}
                value={seg}
                accessibilityLabel={DATE_SEGMENT_LABELS[seg]}
                className={cn("flex-1 rounded-[9px] py-2", active ? "bg-primary" : "bg-transparent")}
              >
                <Text className={cn("text-center text-[12px]", active ? "text-primary-foreground font-semibold" : "text-muted-foreground")}>
                  {DATE_SEGMENT_LABELS[seg]}
                </Text>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </View>

      <Pressable
        onPress={onPressMoreFilters}
        accessibilityRole="button"
        accessibilityLabel="More filters"
        className="flex-row items-center justify-center gap-[6px] border border-border rounded-[12px] py-[10px] mt-[10px]"
      >
        <Icon as={SlidersHorizontal} size={15} className="text-muted-foreground" />
        <Text className="text-[12.5px] text-muted-foreground">More filters</Text>
        {activeFilterCount > 0 ? (
          <Badge className="ml-1"><Text>{activeFilterCount}</Text></Badge>
        ) : null}
      </Pressable>
    </View>
  );
}
