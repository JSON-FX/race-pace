import { useEffect, useMemo, useState } from "react";
import { View, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import Svg, { Line } from "react-native-svg";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { customDataSchema, formatPeso, formatDateRange, isProfileKey, BLOOD_TYPES, SHIRT_SIZES, GENDERS, type FormField } from "@race-pace/shared";
import { useCategory, useEvent, useFormFields, useAddons } from "../../lib/events";
import { startCheckout, CheckoutError } from "../../lib/registration";
import { getProfile, upsertProfile, type Profile } from "../../lib/profile";
import { longDate } from "../../lib/format";
import { useAuth } from "../../lib/auth";
import { DynamicField } from "../../components/DynamicField";
import { PillSelect } from "../../components/PillSelect";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

const TOGGLE_ROW = "flex-row items-center gap-3 border border-border rounded-[14px] p-[14px] mt-4";

const WAIVER_TEXT =
  "I understand that trail and ultra running is an inherently dangerous activity, held over remote and technical terrain, in variable weather, and often far from immediate medical care. I confirm that I am medically fit to take part and have trained appropriately for this distance.\n\n" +
  "I accept full responsibility for my own safety and assume all risks associated with the event — including injury, illness, and in extreme cases death. I agree to follow all race rules, marshal instructions, and mandatory-gear requirements, and to retire from the course if instructed or if I cannot continue safely.\n\n" +
  "To the fullest extent permitted by law, I release the organizer, its staff, volunteers, sponsors, and landowners from liability for any loss, injury, or damage arising from my participation, and I consent to receive first aid or emergency medical treatment if needed.";

export default function Register() {
  const { categoryId } = useLocalSearchParams<{ categoryId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const cat = useCategory(categoryId);
  const eventId = cat.data?.event_id ?? "";
  const ev = useEvent(eventId);
  const fields = useFormFields(eventId);
  const addons = useAddons(eventId);

  const [bibName, setBibName] = useState("");
  const [dob, setDob] = useState("");
  const [emergency, setEmergency] = useState("");
  const [gender, setGender] = useState("");
  const [shirtSize, setShirtSize] = useState("");
  const [bloodType, setBloodType] = useState("");
  const [firstUltra, setFirstUltra] = useState(false);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [selectedAddons, setSelectedAddons] = useState<Record<string, boolean>>({});
  const [waiver, setWaiver] = useState(false);
  const [waiverOpen, setWaiverOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [perfWidth, setPerfWidth] = useState(0);
  const [idempotencyKey] = useState(() => `${categoryId}:${Date.now()}`);
  const [loadedProfile, setLoadedProfile] = useState<Profile | null>(null);
  const [prefillDone, setPrefillDone] = useState(false);
  const [saveBack, setSaveBack] = useState(false);
  const [saveBackTouched, setSaveBackTouched] = useState(false);

  // Bib name, date of birth, and emergency contact are no longer asked here — they carry over
  // from the runner's Race Passport (loaded below) and still flow through to custom_data, so
  // tickets keep showing a bib. Shirt size stays on the form, prefilled from the same passport.
  useEffect(() => {
    if (session?.user.id) {
      getProfile(session.user.id)
        .then((p) => {
          if (p) {
            setBibName(p.bib_name ?? ""); setDob(p.date_of_birth ?? ""); setGender(p.gender ?? "");
            setShirtSize(p.shirt_size ?? ""); setBloodType(p.blood_type ?? ""); setEmergency(p.emergency_contact ?? "");
            setLoadedProfile(p);
          }
        })
        .finally(() => setPrefillDone(true));
    } else {
      setPrefillDone(true);
    }
  }, [session?.user.id]);

  const basePrice = cat.data?.base_price ?? 0;
  const selectedAddonList = useMemo(() => (addons.data ?? []).filter((a) => selectedAddons[a.id]), [addons.data, selectedAddons]);
  const total = useMemo(() => basePrice + selectedAddonList.reduce((s, a) => s + a.price, 0), [basePrice, selectedAddonList]);

  // Save-back diff only tracks the fields still editable on this screen (the kit pills). It must
  // run every render — hooks can't follow the loading-gate return below, or the count changes.
  const passportPairs: [keyof Profile, string][] = [["gender", gender], ["shirt_size", shirtSize], ["blood_type", bloodType]];
  const prof = (k: keyof Profile) => (loadedProfile?.[k] as string | null) ?? "";
  const filledFromEmpty = passportPairs.some(([k, v]) => !prof(k) && v.trim() !== "");
  const editedExisting = passportPairs.some(([k, v]) => prof(k) !== "" && v.trim() !== "" && v !== prof(k));
  const showSaveBack = filledFromEmpty || editedExisting;

  useEffect(() => { if (!saveBackTouched) setSaveBack(filledFromEmpty); }, [filledFromEmpty, saveBackTouched]);

  if (cat.isLoading || (eventId && (fields.isLoading || ev.isLoading))) return <View className="flex-1 items-center justify-center bg-background"><ActivityIndicator className="text-primary" /></View>;

  const fieldRows = fields.data ?? [];
  const eventQuestions = fieldRows.filter((f) => !isProfileKey(f.key));
  const requested = new Set(fieldRows.filter((f) => isProfileKey(f.key)).map((f) => f.key));
  const eventFields: FormField[] = eventQuestions.map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.required, options: f.options ?? undefined }));

  const dateLabel = ev.data?.event_date ? formatDateRange(ev.data.event_date, ev.data.end_date, longDate) : null;
  const stubMeta = [dateLabel, ev.data?.org_name].filter(Boolean).join(" · ");

  async function submit() {
    const parsed = customDataSchema(eventFields).safeParse(values);
    if (!parsed.success) { setError("Please complete the required fields correctly."); return; }
    const passport: Record<string, string> = { bib_name: bibName, date_of_birth: dob, gender, shirt_size: shirtSize, blood_type: bloodType, emergency_contact: emergency };
    for (const f of fieldRows) {
      if (isProfileKey(f.key) && f.required && !passport[f.key]?.trim()) { setError(`${f.label} is required.`); return; }
    }
    if (!waiver) { setError("You must accept the waiver."); return; }
    setError(null); setBusy(true);
    try {
      if (saveBack && session?.user.id && prefillDone) {
        try {
          await upsertProfile({ id: session.user.id, gender: gender || null, shirt_size: shirtSize || null, blood_type: bloodType || null });
        } catch (e) { console.warn("profile save-back failed", e); }
      }
      const res = await startCheckout({
        event_id: eventId, category_id: categoryId,
        addon_ids: Object.keys(selectedAddons).filter((id) => selectedAddons[id]),
        custom_data: { bib_name: bibName, date_of_birth: dob, gender, shirt_size: shirtSize, blood_type: bloodType, emergency_contact: emergency, first_ultra: firstUltra, ...values },
        waiver_accepted: true, idempotency_key: idempotencyKey,
      });
      router.replace({ pathname: "/pay/[registrationId]", params: { registrationId: res.registration_id, checkoutUrl: res.checkout_url } });
    } catch (e) {
      // Lost a race with another device/tab, or the event page's own gate was
      // stale — either way the server is the source of truth. Route straight
      // to the entry that already exists instead of leaving the runner stuck
      // on a form for a distance they can't have.
      if (e instanceof CheckoutError && e.message === "already_registered" && e.registrationId) {
        const rid = e.registrationId;
        Alert.alert(
          "You're already entered",
          "You can only hold one entry per race. We'll take you to it.",
          [{ text: "OK", onPress: () => router.replace(`/pay/${rid}`) }],
        );
        return;
      }
      setError(e instanceof Error ? e.message : "Registration failed");
    } finally { setBusy(false); }
  }

  return (
    <View className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 4, paddingHorizontal: 22, paddingBottom: 120 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} accessibilityRole="button"><Text className="text-primary text-[15px] font-medium">‹ {cat.data?.label ?? "Back"}</Text></Pressable>
        <Text className="text-[24px] font-bold tracking-[-0.4px] text-foreground mt-[10px] mb-[16px]">Register</Text>

        {/* Ticket-stub summary of what you're registering for */}
        <View className="rounded-[16px] overflow-hidden" style={{ backgroundColor: "#12281D" }}>
          <View className="px-[15px] pt-[15px]">
            {ev.data?.name ? <Text className="text-[10.5px] font-semibold uppercase" style={{ letterSpacing: 1.2, color: "#7FE0A6" }}>{ev.data.name}</Text> : null}
            <Text className="text-white text-[19px] font-bold tracking-[-0.3px] mt-[3px]">{cat.data?.label}</Text>
            {stubMeta ? <Text className="text-[12px] mt-[5px]" style={{ color: "rgba(255,255,255,0.72)" }}>{stubMeta}</Text> : null}
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
            <Text className="text-[10px] font-semibold uppercase" style={{ letterSpacing: 1, color: "rgba(255,255,255,0.6)" }}>Entry fee</Text>
            <Text className="text-white text-[18px] font-bold" style={{ fontVariant: ["tabular-nums"] }}>{formatPeso(basePrice)}</Text>
          </View>
        </View>

        <Text className="text-[15px] font-bold tracking-[-0.2px] text-foreground mt-[22px]">Your kit</Text>
        <PillSelect label="SHIRT SIZE" value={shirtSize} options={SHIRT_SIZES} onChange={setShirtSize} accessibilityLabel="Shirt size" />
        {requested.has("gender") && <PillSelect label="GENDER" value={gender} options={GENDERS} onChange={setGender} />}
        {requested.has("blood_type") && <PillSelect label="BLOOD TYPE" value={bloodType} options={BLOOD_TYPES} onChange={setBloodType} />}

        <Pressable className={TOGGLE_ROW} onPress={() => setFirstUltra((v) => !v)} accessibilityRole="button" accessibilityLabel="First ultra at this distance">
          <Text className="flex-1 text-[14px] text-foreground">First ultra at this distance?</Text>
          <View pointerEvents="none"><Switch checked={firstUltra} onCheckedChange={() => {}} accessible={false} importantForAccessibility="no-hide-descendants" /></View>
        </Pressable>

        {eventQuestions.map((f) => (
          <DynamicField key={f.id} field={f} value={values[f.key]} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
        ))}

        {(addons.data ?? []).length > 0 && <Text className="text-[15px] font-bold tracking-[-0.2px] text-foreground mt-[22px] mb-[10px]">Add-ons</Text>}
        {(addons.data ?? []).map((a) => {
          const on = !!selectedAddons[a.id];
          return (
            <Pressable key={a.id} className="flex-row items-center gap-3 border border-border rounded-[14px] py-[13px] px-[14px] mb-[10px]" onPress={() => setSelectedAddons((s) => ({ ...s, [a.id]: !s[a.id] }))} accessibilityRole="button" accessibilityLabel={a.name}>
              <View className="flex-1"><Text className="text-[14px] font-medium text-foreground">{a.name}</Text><Text className="text-[13px] text-primary font-semibold mt-[2px]">+{formatPeso(a.price)}</Text></View>
              <View pointerEvents="none"><Switch checked={on} onCheckedChange={() => {}} accessible={false} importantForAccessibility="no-hide-descendants" /></View>
            </Pressable>
          );
        })}

        {showSaveBack && (
          <Pressable className={TOGGLE_ROW} onPress={() => { setSaveBackTouched(true); setSaveBack((v) => !v); }}>
            <Text className="flex-1 text-[14px] text-foreground">Save these details to my profile?</Text>
            <Switch checked={saveBack} onCheckedChange={(v) => { setSaveBackTouched(true); setSaveBack(v); }} accessibilityLabel="Save details to profile" />
          </Pressable>
        )}

        <Pressable className={TOGGLE_ROW} onPress={() => setWaiver((v) => !v)} accessibilityRole="button" accessibilityLabel="Accept waiver">
          <Text className="flex-1 text-[13px] text-foreground leading-[19px]">I accept the event <Text className="text-primary font-semibold" onPress={() => setWaiverOpen(true)} accessibilityRole="link" accessibilityLabel="Read the waiver">waiver</Text> and confirm I'm medically fit.</Text>
          <View pointerEvents="none"><Switch checked={waiver} onCheckedChange={() => {}} accessible={false} importantForAccessibility="no-hide-descendants" /></View>
        </Pressable>

        {selectedAddonList.length > 0 ? (
          <View className="flex-row justify-between items-center mt-[18px]">
            <Text className="text-[15px] font-semibold text-foreground">Total</Text>
            <Text className="text-[20px] font-bold text-primary" style={{ fontVariant: ["tabular-nums"] }}>{formatPeso(total)}</Text>
          </View>
        ) : null}
        {error ? <Text className="text-destructive mt-3 text-[13px]">{error}</Text> : null}
      </ScrollView>

      <View className="absolute left-0 right-0 bottom-0 px-[22px] pt-[14px] bg-background border-t border-divider" style={{ paddingBottom: insets.bottom + 16 }}>
        <Button className="h-auto py-[15px] sm:h-auto" disabled={busy} onPress={submit} accessibilityRole="button" accessibilityLabel="Register"><Text className="text-[16px] font-semibold text-primary-foreground">{busy ? "Submitting…" : `Register · ${formatPeso(total)}`}</Text></Button>
      </View>

      <Dialog open={waiverOpen} onOpenChange={setWaiverOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Event waiver</DialogTitle>
            <DialogDescription>Please read this before you register.</DialogDescription>
          </DialogHeader>
          <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator>
            <Text className="text-[13px] text-foreground leading-[20px]">{WAIVER_TEXT}</Text>
          </ScrollView>
          <DialogFooter>
            <Button onPress={() => { setWaiver(true); setWaiverOpen(false); }} accessibilityRole="button"><Text className="font-semibold text-primary-foreground">I accept</Text></Button>
            <Button variant="outline" onPress={() => setWaiverOpen(false)} accessibilityRole="button"><Text className="font-semibold text-foreground">Close</Text></Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </View>
  );
}
