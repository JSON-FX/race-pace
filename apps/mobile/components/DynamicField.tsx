import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import type { FormFieldRow } from "@/lib/events";

export function DynamicField({ field, value, onChange }: {
  field: FormFieldRow; value: unknown; onChange: (v: unknown) => void;
}) {
  return (
    <View className="mb-4">
      <Text className="text-sm font-semibold text-foreground mb-[6px]">
        {field.label}{field.required ? " *" : ""}
      </Text>
      {(field.type === "text" || field.type === "date") && (
        <Input
          value={(value as string) ?? ""}
          onChangeText={onChange}
          placeholder={field.type === "date" ? "YYYY-MM-DD" : ""}
          autoCapitalize="none"
          accessibilityLabel={field.label}
        />
      )}
      {field.type === "number" && (
        <Input
          keyboardType="numeric"
          value={value != null ? String(value) : ""}
          onChangeText={(t) => onChange(t === "" ? undefined : Number(t))}
          accessibilityLabel={field.label}
        />
      )}
      {field.type === "checkbox" && (
        <Switch checked={!!value} onCheckedChange={onChange} accessibilityLabel={field.label} />
      )}
      {field.type === "select" && (
        <ToggleGroup
          type="single"
          value={(value as string) ?? undefined}
          onValueChange={(v) => {
            // type="single" reports undefined on deselect (pressing the active
            // pill again) — this field has no deselect concept, so ignore it
            // (matches the original Pressable's re-press-is-a-no-op behavior).
            if (v) onChange(v);
          }}
          className="flex-row flex-wrap gap-2"
        >
          {(field.options ?? []).map((opt) => {
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
      )}
      {field.type === "file" && (
        <Text className="text-muted-foreground italic">File uploads aren't supported yet.</Text>
      )}
    </View>
  );
}
