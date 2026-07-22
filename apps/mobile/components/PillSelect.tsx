import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export function PillSelect({ label, value, options, onChange, accessibilityLabel }: {
  label: string; value: string | null; options: readonly string[];
  onChange: (v: string) => void; accessibilityLabel?: string;
}) {
  return (
    <View className="mt-[14px]">
      <Text
        className="text-[11px] font-semibold tracking-[0.4px] text-muted-foreground mb-2"
        accessibilityLabel={accessibilityLabel}
      >
        {label}
      </Text>
      <ToggleGroup
        type="single"
        value={value ?? undefined}
        onValueChange={(v) => {
          // type="single" reports undefined on deselect (pressing the active
          // pill again) — PillSelect has no deselect concept, so ignore it.
          if (v) onChange(v);
        }}
        className="flex-row flex-wrap gap-2"
      >
        {options.map((opt) => {
          const active = value === opt;
          return (
            <ToggleGroupItem
              key={opt}
              value={opt}
              accessibilityLabel={opt}
              className={cn(
                "h-auto rounded-full border px-3.5 py-2",
                active ? "border-primary bg-primary" : "border-border"
              )}
            >
              <Text className={active ? "text-primary-foreground font-semibold" : undefined}>
                {opt}
              </Text>
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </View>
  );
}
