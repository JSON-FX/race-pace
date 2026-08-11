import { useState } from "react";
import { View, Pressable, Image, StyleSheet } from "react-native";
import { ChevronRight, CreditCard } from "lucide-react-native";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { ElevationHero } from "./ElevationHero";

export type RaceCardVariant = "registered" | "completed" | "refunded" | "unpaid" | "expired";

const BADGE: Record<RaceCardVariant, { variant: "paid" | "completed" | "refunded" | "unpaid"; label: string }> = {
  registered: { variant: "paid", label: "Registered" },
  completed: { variant: "completed", label: "Completed" },
  refunded: { variant: "refunded", label: "Refunded" },
  unpaid: { variant: "unpaid", label: "Unpaid" },
  // Reuses the "completed" badge treatment (muted, not the amber "unpaid"
  // tint) — an expired hold isn't awaiting anything anymore, it's over, same
  // as a completed or refunded entry. See myRacesGroups.ts for why this lands
  // in the same segment as those two.
  expired: { variant: "completed", label: "Expired" },
};

export function RaceCard({
  variant, title, meta, orgName, eventHeroUrl, onPress, onPay, onCancel,
}: {
  variant: RaceCardVariant;
  title: string;
  meta?: string | null;
  orgName?: string | null;
  eventHeroUrl?: string | null;
  onPress?: () => void;
  onPay?: () => void;
  onCancel?: () => void;
}) {
  const badge = BADGE[variant];
  const isUnpaid = variant === "unpaid";
  const showChevron = variant === "completed" || variant === "refunded" || variant === "expired";
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <Card className="mb-3 rounded-[14px] p-4 shadow-none shadow-transparent">
        <View className="flex-row items-center gap-3.5">
          <View className="h-[54px] w-[54px] overflow-hidden rounded-[14px]">
            {eventHeroUrl && !imgFailed ? (
              <Image
                testID="race-card-hero"
                source={{ uri: eventHeroUrl }}
                onError={() => setImgFailed(true)}
                resizeMode="cover"
                style={StyleSheet.absoluteFill}
              />
            ) : (
              <ElevationHero height={54} />
            )}
          </View>
          <View className="flex-1">
            {orgName ? <Text className="text-[11px] font-medium text-muted-foreground" numberOfLines={1}>{orgName}</Text> : null}
            <Text className="text-[15px] font-semibold text-foreground" numberOfLines={1}>{title}</Text>
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
