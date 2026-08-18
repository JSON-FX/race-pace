import { useEffect, useRef, useState } from "react";
import { View, ScrollView, Pressable, ActivityIndicator } from "react-native";
import Svg, { Line } from "react-native-svg";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, Lock, Ban } from "lucide-react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { formatPeso } from "@race-pace/shared";
import { useRegistration, verifyPayment, createMethodCheckout } from "../../lib/registration";
import { holdExpired } from "../../lib/holdExpiry";
import { cacheTicket } from "../../lib/ticketCache";
import { MethodLogo } from "../../components/PaymentLogos";
import { Text } from "@/components/ui/text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

const TIMEOUT_MS = 90_000;
const RETURN_PATH = "pay-callback"; // deliberately NOT pay/return (collides with pay/[registrationId])
const METHODS = [
  { key: "card", label: "Card" },
  { key: "gcash", label: "GCash" },
  { key: "maya", label: "Maya" },
];

/**
 * apps/mobile has NO error-code map — there is no equivalent of
 * apps/site/lib/errors.ts here, and building one is a bigger decision than this
 * fix (every other code still surfaces raw). `org_suspended` is the one code
 * this screen can actually receive and act on, so it gets its copy inline.
 *
 * Kept verbatim in step with apps/site/lib/errors.ts's `org_suspended` entry:
 * the same runner can hit the same wall on either client, and two different
 * sentences for one condition is how support tickets stop matching each other.
 * No "try again" imperative — suspension is permanent until a super admin
 * lifts it — and "Nothing was charged" because a runner told only that
 * something failed on a pay screen has no way to know whether their money
 * moved.
 */
const ORG_SUSPENDED_COPY =
  "This organizer isn't taking registrations right now. Nothing was charged — try again another time or pick another race.";

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
  const [perfWidth, setPerfWidth] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const reg = useRegistration(registrationId, { poll: awaiting });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const paid = reg.data?.status === "paid";
  // THE ORGANIZER'S ORGANIZATION IS SUSPENDED. `url` below is a PayMongo
  // session minted before the suspension — from the route param the register
  // flow passes, or the one stored on the payment row — and PayMongo does not
  // care that the platform switched the organizer off: that page is still
  // chargeable. registrations-checkout writes checkout_url on EVERY
  // registration, so the stored one is never absent.
  //
  // payment-session refuses to mint a NEW session for a suspended org
  // (org_suspended, 409), and `pay()` below used to fall back past that
  // refusal to exactly this `url`. Nulling it here, plus the early return
  // further down that removes the Pay button entirely, is what closes it.
  // Mirrors apps/site's PayPanel `orgSuspended` guard.
  const orgSuspended = reg.data?.orgIsActive === false;
  const url = orgSuspended ? null : (checkoutUrl ?? reg.data?.checkoutUrl ?? null);
  // Bookmark/direct-push protection: a runner can land here straight from a
  // push notification or a stale tab long after the 24-hour hold ran out.
  // payment-session (the edge function createMethodCheckout calls) refuses a
  // lapsed hold too — that's the real boundary — but refusing only there
  // means tapping Pay just silently fails with "No checkout link available",
  // which reads as a bug rather than an explanation. Checked here, not inside
  // `awaiting`: once a checkout is actually in flight, a lapse discovered
  // mid-poll must not yank the runner off a payment that could still resolve
  // via the late-capture/resurrect path (confirm_payment_tx).
  const lapsed = !!reg.data && holdExpired(reg.data.status, reg.data.expiresAt);
  // Mirrors apps/site's PayPanel.tsx `eventClosed` guard (that file's
  // eventStatus.ts isRegistrationClosed, inlined here per this app's existing
  // pattern — see apps/mobile/app/event/[id].tsx's `registerable`). The
  // organizer can close/cancel/complete the event while this exact screen is
  // open — the query polls, so the status can flip under the runner. Critical
  // because `url` above can hold a PayMongo session created while the event
  // was still open and chargeable.
  const eventClosed = ["cancelled", "closed", "completed"].includes(reg.data?.eventStatus ?? "");
  // A registration also reaches `status === 'expired'` when the organizer
  // closes the event early (the `events_close_expires_pending` trigger,
  // 20260809100200), not just when the 24h hold lapses (`lapsed`, below).
  // `eventClosed` above catches the common case, since the event flips status
  // in the same transaction, but NOT the organizer reopening the event
  // afterward: eventStatus goes back to something registerable while this
  // specific registration stays 'expired' forever (nothing resurrects it),
  // and its stored session can still be young enough to charge. So `status`
  // must be checked directly — this is a different fact from a
  // runner-abandoned hold and needs its own, distinct copy from `lapsed`.
  const expiredByOrganizer = reg.data?.status === "expired";
  const eventId = reg.data?.event_id;

  useEffect(() => {
    if (paid && reg.data) {
      cacheTicket({ rid: reg.data.id, token: reg.data.ticket_token, eventName: reg.data.eventName, categoryLabel: reg.data.categoryLabel, runnerName: "", status: "paid", orgId: reg.data.org_id });
      if (timer.current) clearTimeout(timer.current);
    }
  }, [paid, reg.data]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function pay() {
    setErr(null);
    const redirect = Linking.createURL(RETURN_PATH);
    // Scope a fresh checkout to the chosen method so PayMongo opens straight to it; fall back to
    // the all-methods session created at registration if that call fails.
    setPreparing(true);
    const scoped = await createMethodCheckout(registrationId, method);
    setPreparing(false);
    // The SERVER's answer, and the only fresh fact available at the moment of
    // the tap: a suspension landing between render and tap leaves `orgSuspended`
    // above stale, and this is the only thing that sees it. Handled before the
    // fallback, so a refusal cannot be routed around by `url`.
    if (scoped.code === "org_suspended") { setErr(ORG_SUSPENDED_COPY); return; }
    const payUrl = scoped.url ?? url;
    if (!payUrl) { setErr("No checkout link available. Go back and try again."); return; }
    const full = payUrl + (payUrl.includes("?") ? "&" : "?") + "return=" + encodeURIComponent(redirect);
    setTimedOut(false); setAwaiting(true);
    try { await WebBrowser.openAuthSessionAsync(full, redirect); } catch { /* poll drives the outcome */ }
    // Back from the hosted checkout — confirm server-side (verified with PayMongo, never the redirect).
    verifyPayment(registrationId).then(() => reg.refetch());
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
          <Button className={PILL_BTN} onPress={async () => { await verifyPayment(registrationId); reg.refetch(); }} accessibilityRole="button">
            <Text className={PILL_TXT}>Check again</Text>
          </Button>
          <Pressable onPress={pay} accessibilityRole="button">
            <Text className={cn(LINK_BASE, "text-primary")}>Retry payment</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (eventClosed) {
    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top, paddingHorizontal: 22 }}>
        <View className="flex-1 items-center justify-center">
          <View className="h-[92px] w-[92px] items-center justify-center rounded-[46px] bg-amber-tint">
            <Icon as={Ban} size={30} className="text-amber" />
          </View>
          <Text className="mt-6 text-[24px] font-bold tracking-[-0.4px] text-foreground">This race is no longer accepting entries</Text>
          <Text className="mt-[10px] max-w-[280px] text-center text-[15px] leading-[21px] text-muted-foreground">
            {reg.data?.statusNote ?? "The organizer closed registration for this event. You have not been charged."}
          </Text>
        </View>
        <View style={{ paddingBottom: insets.bottom + 20 }}>
          <Button className={PILL_BTN} onPress={() => router.replace("/(tabs)/races")} accessibilityRole="button">
            <Text className={PILL_TXT}>Back to My Races</Text>
          </Button>
        </View>
      </View>
    );
  }

  if (orgSuspended) {
    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top, paddingHorizontal: 22 }}>
        <View className="flex-1 items-center justify-center">
          <View className="h-[92px] w-[92px] items-center justify-center rounded-[46px] bg-amber-tint">
            <Icon as={Ban} size={30} className="text-amber" />
          </View>
          <Text className="mt-6 text-[24px] font-bold tracking-[-0.4px] text-foreground">This organizer is not taking payments</Text>
          <Text className="mt-[10px] max-w-[280px] text-center text-[15px] leading-[21px] text-muted-foreground">
            {ORG_SUSPENDED_COPY}
          </Text>
        </View>
        <View style={{ paddingBottom: insets.bottom + 20 }}>
          <Button className={PILL_BTN} onPress={() => router.replace("/(tabs)/races")} accessibilityRole="button">
            <Text className={PILL_TXT}>Back to My Races</Text>
          </Button>
        </View>
      </View>
    );
  }

  if (expiredByOrganizer) {
    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top, paddingHorizontal: 22 }}>
        <View className="flex-1 items-center justify-center">
          <View className="h-[92px] w-[92px] items-center justify-center rounded-[46px] bg-amber-tint">
            <Icon as={Ban} size={30} className="text-amber" />
          </View>
          <Text className="mt-6 text-[24px] font-bold tracking-[-0.4px] text-foreground">This entry was closed</Text>
          <Text className="mt-[10px] max-w-[280px] text-center text-[15px] leading-[21px] text-muted-foreground">
            The organizer closed this registration before you paid. You have not been charged.
          </Text>
        </View>
        <View style={{ paddingBottom: insets.bottom + 20 }}>
          <Button
            className={PILL_BTN}
            onPress={() => (eventId ? router.replace(`/event/${eventId}`) : router.replace("/(tabs)/races"))}
            accessibilityRole="button"
          >
            <Text className={PILL_TXT}>Enter again</Text>
          </Button>
          <Pressable onPress={() => router.replace("/(tabs)/races")} accessibilityRole="button">
            <Text className={cn(LINK_BASE, "text-muted-foreground")}>Back to My Races</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (lapsed) {
    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top, paddingHorizontal: 22 }}>
        <View className="flex-1 items-center justify-center">
          <View className="h-[92px] w-[92px] items-center justify-center rounded-[46px] bg-amber-tint">
            <Icon as={Lock} size={30} className="text-amber" />
          </View>
          <Text className="mt-6 text-[24px] font-bold tracking-[-0.4px] text-foreground">Payment window closed</Text>
          <Text className="mt-[10px] max-w-[280px] text-center text-[15px] leading-[21px] text-muted-foreground">
            This hold ran out and the slot is back in the pool. You'll need to enter again.
          </Text>
        </View>
        <View style={{ paddingBottom: insets.bottom + 20 }}>
          <Button
            className={PILL_BTN}
            onPress={() => (eventId ? router.replace(`/event/${eventId}`) : router.replace("/(tabs)/races"))}
            accessibilityRole="button"
          >
            <Text className={PILL_TXT}>Enter again</Text>
          </Button>
          <Pressable onPress={() => router.replace("/(tabs)/races")} accessibilityRole="button">
            <Text className={cn(LINK_BASE, "text-muted-foreground")}>Back to My Races</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const total = reg.data?.total_amount ?? 0;
  const entryFee = reg.data?.basePrice ?? total;
  const addonTotal = Math.max(0, total - entryFee);
  const inclusions = reg.data?.inclusions ?? [];

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top + 6 }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} accessibilityRole="button">
          <Text className="text-[15px] font-medium text-primary">‹ Register</Text>
        </Pressable>
        <Text className="mt-[10px] text-[24px] font-bold tracking-[-0.4px] text-foreground">Payment</Text>

        {/* Ticket-stub total — echoes the register screen */}
        <View className="mt-5 rounded-[16px] overflow-hidden" style={{ backgroundColor: "#12281D" }}>
          <View className="px-[15px] pt-[15px]">
            {reg.data?.eventName ? <Text className="text-[10.5px] font-semibold uppercase" style={{ letterSpacing: 1.2, color: "#7FE0A6" }}>{reg.data.eventName}</Text> : null}
            <Text className="text-white text-[19px] font-bold tracking-[-0.3px] mt-[3px]">{reg.data?.categoryLabel ?? ""}</Text>
          </View>
          <View className="relative my-[4px] h-[16px] justify-center" onLayout={(e) => setPerfWidth(e.nativeEvent.layout.width)}>
            {perfWidth > 0 ? (
              <Svg width={perfWidth} height={2}>
                <Line x1={0} y1={1} x2={perfWidth} y2={1} stroke="rgba(255,255,255,0.32)" strokeWidth={1.5} strokeDasharray="5,4" strokeLinecap="round" />
              </Svg>
            ) : null}
            <View className="absolute left-[-8px] top-0 h-[16px] w-[16px] rounded-full bg-background" />
            <View className="absolute right-[-8px] top-0 h-[16px] w-[16px] rounded-full bg-background" />
          </View>
          <View className="flex-row items-center justify-between px-[15px] pb-[13px]">
            <Text className="text-[10px] font-semibold uppercase" style={{ letterSpacing: 1, color: "rgba(255,255,255,0.6)" }}>Total due</Text>
            <Text className="text-white text-[18px] font-bold" style={{ fontVariant: ["tabular-nums"] }}>{reg.data ? formatPeso(reg.data.total_amount) : ""}</Text>
          </View>
        </View>

        {/* Charge breakdown — why the total is what it is */}
        <View className="mt-[14px] overflow-hidden rounded-[14px] border border-border">
          <View className="flex-row items-center justify-between px-[14px] py-[11px]">
            <Text className="text-[13px] text-muted-foreground">Entry fee</Text>
            <Text className="text-[13px] font-semibold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>{formatPeso(entryFee)}</Text>
          </View>
          {addonTotal > 0 ? (
            <View className="flex-row items-center justify-between border-t border-border px-[14px] py-[11px]">
              <Text className="text-[13px] text-muted-foreground">Add-ons</Text>
              <Text className="text-[13px] font-semibold text-foreground" style={{ fontVariant: ["tabular-nums"] }}>+{formatPeso(addonTotal)}</Text>
            </View>
          ) : null}
          <View className="flex-row items-center justify-between border-t border-border px-[14px] py-[11px]">
            <Text className="text-[13px] text-muted-foreground">Booking fee</Text>
            <Text className="text-[13px] font-semibold text-primary">Free</Text>
          </View>
        </View>

        {inclusions.length > 0 ? (
          <View className="mt-[18px]">
            <Text className="mb-[10px] text-[15px] font-bold tracking-[-0.2px] text-foreground">What's included</Text>
            {inclusions.map((item, i) => (
              <View key={i} className="flex-row items-center gap-[9px] py-[5px]">
                <View className="h-[18px] w-[18px] items-center justify-center rounded-full bg-secondary">
                  <Icon as={Check} size={11} className="text-primary" />
                </View>
                <Text className="flex-1 text-[13.5px] text-foreground">{item}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Text className="mb-[2px] mt-[22px] text-[11px] font-semibold tracking-[0.4px] text-muted-foreground">PAY WITH</Text>
        {METHODS.map((m) => {
          const on = method === m.key;
          return (
            <Pressable
              key={m.key}
              onPress={() => setMethod(m.key)}
              className={cn("mt-[9px] flex-row items-center gap-[12px] rounded-[14px] border-[1.5px] border-border bg-background px-[15px] py-[13px]", on && "border-primary bg-secondary")}
              accessibilityRole="button"
              accessibilityLabel={m.label}
            >
              <View className="flex-1 flex-row items-center gap-[8px]">
                <MethodLogo methodKey={m.key} />
                <Text className="text-[13.5px] font-semibold text-foreground">{m.label}</Text>
              </View>
              <View className={cn("h-[20px] w-[20px] items-center justify-center rounded-full border-[1.5px]", on ? "border-primary bg-primary" : "border-border")}>
                {on ? <Icon as={Check} size={12} className="text-primary-foreground" /> : null}
              </View>
            </Pressable>
          );
        })}
        {err ? <Text className="mt-3 text-center text-destructive">{err}</Text> : null}
      </ScrollView>

      <View className="border-t border-divider bg-background px-[22px] pt-[12px]" style={{ paddingBottom: insets.bottom + 16 }}>
        <Button className={PILL_BTN} onPress={pay} disabled={preparing} accessibilityRole="button">
          <Text className={PILL_TXT}>{preparing ? "Opening…" : `Pay ${reg.data ? formatPeso(reg.data.total_amount) : ""}`}</Text>
        </Button>
        <View className="mt-[10px] flex-row items-center justify-center gap-[5px]">
          <Icon as={Lock} size={12} className="text-muted-foreground" />
          <Text className="text-[12px] text-muted-foreground">Encrypted and secured by PayMongo</Text>
        </View>
      </View>
    </View>
  );
}
