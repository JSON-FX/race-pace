import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export function PillMultiSelect({ label, value, options, labels, onChange, accessibilityLabel }: {
  label: string; value: string[]; options: readonly string[]; labels?: Record<string, string>;
  onChange: (v: string[]) => void; accessibilityLabel?: string;
}) {
  return (
    <View className="mt-[14px]">
      <Text
        className="text-[11px] font-semibold tracking-[0.4px] text-muted-foreground mb-2"
        accessibilityLabel={accessibilityLabel}
      >
        {label}
      </Text>
      <ToggleGroup type="multiple" value={value} onValueChange={onChange} className="flex-row flex-wrap gap-2">
        {options.map((opt) => {
          const active = value.includes(opt);
          const optLabel = labels?.[opt] ?? opt;
          return (
            <ToggleGroupItem
              key={opt}
              value={opt}
              accessibilityLabel={optLabel}
              className={cn("h-auto rounded-full border px-3.5 py-2", active ? "border-primary bg-primary" : "border-border")}
            >
              <Text className={active ? "text-primary-foreground font-semibold" : undefined}>{optLabel}</Text>
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </View>
  );
}
