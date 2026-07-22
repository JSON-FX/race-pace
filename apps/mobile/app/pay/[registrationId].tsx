import { useEffect, useRef, useState } from "react";
import { View, Pressable, ActivityIndicator } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { formatPeso } from "@race-pace/shared";
import { useRegistration } from "../../lib/registration";
import { cacheTicket } from "../../lib/ticketCache";
import { Text } from "@/components/ui/text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const TIMEOUT_MS = 90_000;
const RETURN_PATH = "pay-callback"; // deliberately NOT pay/return (collides with pay/[registrationId])
const METHODS = [
  { key: "card", label: "Card", sub: "Visa · Mastercard" },
  { key: "gcash", label: "GCash", sub: "E-wallet" },
  { key: "maya", label: "Maya", sub: "E-wallet" },
];

const PILL_BTN = "h-auto py-[15px] sm:h-auto";
const PILL_TXT = "text-[16px] font-semibold text-primary-foreground";
const LINK_BASE = "mt-[14px] text-center text-[14px] font-semibold";

export default function Pay() {
  const { registrationId, checkoutUrl } = useLocalSearchParams<{ registrationId: string; checkoutUrl?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [awaiting, setAwaiting] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [method, setMethod] = useState("gcash");
  const [err, setErr] = useState<string | null>(null);
  const reg = useRegistration(registrationId, { poll: awaiting });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const paid = reg.data?.status === "paid";
  const url = checkoutUrl ?? reg.data?.checkoutUrl ?? null;

  useEffect(() => {
    if (paid && reg.data) {
      cacheTicket({ rid: reg.data.id, token: reg.data.ticket_token, eventName: reg.data.eventName, categoryLabel: reg.data.categoryLabel, runnerName: "", status: "paid", orgId: reg.data.org_id });
      if (timer.current) clearTimeout(timer.current);
    }
  }, [paid, reg.data]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function pay() {
    if (!url) { setErr("No checkout link available. Go back and try again."); return; }
    setErr(null);
    const redirect = Linking.createURL(RETURN_PATH);
    const full = url + (url.includes("?") ? "&" : "?") + "return=" + encodeURIComponent(redirect);
    try { await WebBrowser.openAuthSessionAsync(full, redirect); } catch { /* poll drives the outcome */ }
    setTimedOut(false); setAwaiting(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
  }

  if (paid) {
    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top, paddingHorizontal: 22 }}>
        <View className="flex-1 items-center justify-center">
          <View className="h-[92px] w-[92px] items-center justify-center rounded-[46px] bg-secondary">
            <View className="h-[60px] w-[60px] items-center justify-center rounded-[30px] bg-primary">
              <Text className="text-[30px] font-bold text-white">✓</Text>
            </View>
          </View>
          <Text className="mt-6 text-[26px] font-bold tracking-[-0.4px] text-foreground">Payment confirmed</Text>
          <Text className="mt-[10px] max-w-[280px] text-center text-[15px] leading-[21px] text-muted-foreground">
            You're registered for <Text className="font-semibold text-foreground">{reg.data?.eventName} {reg.data?.categoryLabel}</Text>. Ref <Text style={{ fontFamily: "Courier" }}>{registrationId.slice(0, 8).toUpperCase()}</Text>.
          </Text>
        </View>
        <View style={{ paddingBottom: insets.bottom + 20 }}>
          <Button className={PILL_BTN} onPress={() => router.replace(`/ticket/${registrationId}`)} accessibilityRole="button">
            <Text className={PILL_TXT}>View ticket</Text>
          </Button>
          <Pressable onPress={() => router.replace("/(tabs)/races")} accessibilityRole="button">
            <Text className={cn(LINK_BASE, "text-muted-foreground")}>Back to My Races</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (awaiting) {
    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top, paddingHorizontal: 22 }}>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" className="text-primary" />
          <Text className="mt-[26px] text-[20px] font-semibold text-foreground">Waiting for confirmation…</Text>
          <Text className="mt-2 max-w-[260px] text-center text-[14px] leading-[20px] text-muted-foreground">We're confirming your payment. This usually takes a few seconds.</Text>
          {timedOut ? <Text className="mt-2 text-center text-[13px] text-muted-foreground">Still processing. If you completed payment, tap Check again.</Text> : null}
          <Badge className="mt-[18px] bg-muted">
            <Text className="text-muted-foreground">Pending</Text>
          </Badge>
        </View>
        <View style={{ paddingBottom: insets.bottom + 20 }}>
          <Button className={PILL_BTN} onPress={() => reg.refetch()} accessibilityRole="button">
            <Text className={PILL_TXT}>Check again</Text>
          </Button>
          <Pressable onPress={pay} accessibilityRole="button">
            <Text className={cn(LINK_BASE, "text-primary")}>Retry payment</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top + 6 }}>
      <View className="px-[22px]">
        <Pressable onPress={() => router.back()} accessibilityRole="button">
          <Text className="text-[15px] font-medium text-primary">‹ Register</Text>
        </Pressable>
        <Text className="mt-[10px] text-[24px] font-bold tracking-[-0.4px] text-foreground">Payment</Text>

        <View className="mt-5 rounded-[16px] bg-muted p-[18px]">
          <View className="flex-row items-center justify-between">
            <Text className="text-[14px] text-muted-foreground">{reg.data?.eventName ?? ""}</Text>
            <Text className="text-[14px] font-semibold text-foreground">{reg.data?.categoryLabel ?? ""}</Text>
          </View>
          <View className="my-3 h-px bg-border" />
          <View className="flex-row items-center justify-between">
            <Text className="text-[15px] font-semibold text-foreground">Total</Text>
            <Text className="text-[20px] font-bold text-primary">{reg.data ? formatPeso(reg.data.total_amount) : ""}</Text>
          </View>
        </View>

        <Text className="mb-[10px] mt-[22px] text-[11px] font-semibold tracking-[0.4px] text-muted-foreground">PAY WITH</Text>
        <View className="flex-row gap-[10px]">
          {METHODS.map((m) => {
            const on = method === m.key;
            return (
              <Pressable
                key={m.key}
                className={cn(
                  "flex-1 items-center rounded-[14px] border-[1.5px] border-border bg-background p-[13px]",
                  on && "border-primary bg-secondary"
                )}
                onPress={() => setMethod(m.key)}
                accessibilityRole="button"
              >
                <Text className="text-[14px] font-semibold text-foreground">{m.label}</Text>
                <Text className="mt-[2px] text-[11px] text-muted-foreground">{m.sub}</Text>
              </Pressable>
            );
          })}
        </View>
        {err ? <Text className="mt-3 text-center text-destructive">{err}</Text> : null}
      </View>

      <View className="flex-1" />
      <View className="px-[22px] pt-[10px]" style={{ paddingBottom: insets.bottom + 16 }}>
        <Button className={PILL_BTN} onPress={pay} accessibilityRole="button">
          <Text className={PILL_TXT}>Pay {reg.data ? formatPeso(reg.data.total_amount) : ""}</Text>
        </Button>
        <Text className="mt-[10px] text-center text-[12px] text-muted-foreground">Secured by PayMongo</Text>
      </View>
    </View>
  );
}
