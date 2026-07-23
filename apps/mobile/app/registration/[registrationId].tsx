import { View, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MapPinCheck, QrCode } from "lucide-react-native";
import { formatPeso } from "@race-pace/shared";
import { useRegistration } from "../../lib/registration";
import { longDate, paymentMethodLabel } from "../../lib/format";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";

export default function RegistrationReceipt() {
  const { registrationId } = useLocalSearchParams<{ registrationId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const reg = useRegistration(registrationId);
  const ref = registrationId.slice(0, 8).toUpperCase();

  if (reg.isLoading && !reg.data) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator className="text-primary" />
      </View>
    );
  }

  const p = reg.data?.payment ?? null;
  const refunded = reg.data?.status === "refunded";
  const reference = p?.providerRef || ref;
  const subtitle = [reg.data?.categoryDistance ? `${reg.data.categoryDistance}K` : null, reg.data?.categoryLabel]
    .filter(Boolean)
    .join(" · ");

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingTop: insets.top + 6, paddingHorizontal: 22, paddingBottom: insets.bottom + 30 }}
      showsVerticalScrollIndicator={false}
    >
      <Pressable onPress={() => router.back()} accessibilityRole="button" className="py-2">
        <Text className="text-[15px] font-medium text-primary">‹ My Races</Text>
      </Pressable>

      <Text className="mt-1 text-[22px] font-bold tracking-[-0.3px] text-foreground">{reg.data?.eventName ?? "Race"}</Text>
      <View className="mt-1.5 flex-row items-center gap-2">
        {subtitle ? <Text className="text-[13px] text-muted-foreground">{subtitle}</Text> : null}
        <Badge variant={refunded ? "refunded" : "completed"}><Text>{refunded ? "Refunded" : "Completed"}</Text></Badge>
      </View>

      <Text className="mb-2 mt-[22px] text-[11px] font-semibold tracking-[0.4px] text-muted-foreground">PAYMENT</Text>
      <View className="rounded-[14px] border border-border bg-card px-4">
        <Row label="Paid on" value={p?.createdAt ? longDate(p.createdAt.slice(0, 10)) : "—"} />
        <Row label="Method" value={paymentMethodLabel(p?.method)} />
        <Row label="Amount" value={p?.amount != null ? formatPeso(p.amount) : "—"} />
        <Row label="Platform fee" value={p?.platformFee != null ? formatPeso(p.platformFee) : "—"} />
        <Row label="Reference" value={reference} mono last />
      </View>

      <Text className="mb-2 mt-[18px] text-[11px] font-semibold tracking-[0.4px] text-muted-foreground">RACE DAY</Text>
      <View className="flex-row items-center justify-between rounded-[14px] border border-border bg-card p-4">
        <View className="flex-row items-center gap-2.5">
          <Icon as={MapPinCheck} size={18} className="text-muted-foreground" />
          <Text className="text-[13px] text-muted-foreground">Check-in</Text>
        </View>
        <Text className="text-[12px] text-muted-foreground">Not recorded yet</Text>
      </View>

      {reg.data?.status === "paid" ? (
        <Pressable
          onPress={() => router.push(`/ticket/${registrationId}`)}
          accessibilityRole="button"
          className="mt-3 flex-row items-center justify-center gap-2 rounded-[12px] border border-border py-3"
        >
          <Icon as={QrCode} size={17} className="text-primary" />
          <Text className="text-[14px] font-semibold text-primary">View race pass</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function Row({ label, value, mono, last }: { label: string; value: string; mono?: boolean; last?: boolean }) {
  return (
    <View className={`flex-row items-center justify-between py-3 ${last ? "" : "border-b border-border"}`}>
      <Text className="text-[13px] text-muted-foreground">{label}</Text>
      <Text className="text-[13px] font-semibold text-foreground" style={mono ? { fontFamily: "Courier" } : undefined}>{value}</Text>
    </View>
  );
}
