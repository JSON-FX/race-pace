import { View, Pressable } from "react-native";
import { ChevronRight, CreditCard } from "lucide-react-native";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";

export type RaceCardVariant = "registered" | "completed" | "refunded" | "unpaid";

const BADGE: Record<RaceCardVariant, { variant: "paid" | "completed" | "refunded" | "unpaid"; label: string }> = {
  registered: { variant: "paid", label: "Registered" },
  completed: { variant: "completed", label: "Completed" },
  refunded: { variant: "refunded", label: "Refunded" },
  unpaid: { variant: "unpaid", label: "Unpaid" },
};

export function RaceCard({
  variant, title, meta, distanceKm, onPress, onPay, onCancel,
}: {
  variant: RaceCardVariant;
  title: string;
  meta?: string | null;
  distanceKm?: number | null;
  onPress?: () => void;
  onPay?: () => void;
  onCancel?: () => void;
}) {
  const badge = BADGE[variant];
  const green = variant === "registered";
  const isUnpaid = variant === "unpaid";
  const showChevron = variant === "completed" || variant === "refunded";

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card className="mb-3 rounded-[14px] p-4 shadow-none shadow-transparent">
        <View className="flex-row items-center gap-3.5">
          <View className={`h-[46px] w-[46px] items-center justify-center rounded-[13px] ${green ? "bg-secondary" : "bg-muted"}`}>
            <Text className={`text-[13px] font-bold leading-[15px] ${green ? "text-primary" : "text-muted-foreground"}`}>{distanceKm ?? "—"}</Text>
            <Text className={`text-[9px] font-bold ${green ? "text-primary" : "text-muted-foreground"}`}>KM</Text>
          </View>
          <View className="flex-1">
            <Text className="text-[15px] font-semibold text-foreground">{title}</Text>
            {meta ? <Text className="mt-0.5 text-xs text-muted-foreground">{meta}</Text> : null}
          </View>
          <Badge variant={badge.variant}><Text>{badge.label}</Text></Badge>
          {showChevron ? <Icon as={ChevronRight} size={18} className="text-muted-foreground" /> : null}
        </View>

        {isUnpaid ? (
          <View className="mt-3 flex-row gap-2">
            <Button className="h-auto flex-1 flex-row gap-1.5 py-2.5" onPress={onPay} accessibilityRole="button">
              <Icon as={CreditCard} size={16} className="text-primary-foreground" />
              <Text className="text-[13px] font-semibold text-primary-foreground">Complete payment</Text>
            </Button>
            <Button variant="outline" className="h-auto py-2.5" onPress={onCancel} accessibilityRole="button">
              <Text className="text-[13px] font-semibold text-destructive">Cancel</Text>
            </Button>
          </View>
        ) : null}
      </Card>
    </Pressable>
  );
}
