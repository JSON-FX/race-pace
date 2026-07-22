import { useMemo, useEffect, useState } from "react";
import { View, ScrollView, Pressable, Alert, Image, ActivityIndicator, TextInput } from "react-native";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Camera, ChevronRight } from "lucide-react-native";
import { useAuth } from "../../lib/auth";
import { getProfile, upsertProfile } from "../../lib/profile";
import { pickAndUploadProfileImage } from "../../lib/profileImage";
import { useMyRegistrations } from "../../lib/registration";
import { initials } from "../../components/OrgAvatar";
import { PsgcAddressPicker } from "../../components/PsgcAddressPicker";
import { BLOOD_TYPES, SHIRT_SIZES, GENDERS, type PsgcAddress } from "@race-pace/shared";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

const ACCOUNT = ["Payment methods", "Notifications", "Help & support"];
const CARD = "rounded-[16px] border border-border bg-card px-4";
const CARD_HEADING = "pt-3.5 pb-1 text-[13px] font-bold text-foreground";
const ROW = "flex-row items-center justify-between py-3";
const RLABEL = "text-[14px] text-muted-foreground";
const RVALUE = "text-[15px] font-semibold text-foreground";

export default function Profile() {
  const { session, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const uid = session?.user.id;
  const myRaces = useMyRegistrations();
  const raceCount = myRaces.data?.length ?? 0;

  const [fullName, setFullName] = useState("");
  const [bibName, setBibName] = useState("");
  const [address, setAddress] = useState<PsgcAddress | null>(null);
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("");
  const [shirtSize, setShirtSize] = useState("");
  const [bloodType, setBloodType] = useState("");
  const [emgName, setEmgName] = useState("");
  const [emgPhone, setEmgPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState<null | "avatar" | "cover">(null);
  const [overCover, setOverCover] = useState(true); // status-bar is light while the forest cover is under it
  const [saved, setSaved] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!uid) return;
    getProfile(uid).then((p) => {
      if (!p) { setSaved(snapshot({})); return; }
      const [en, ep] = splitEmergency(p.emergency_contact);
      setFullName(p.full_name ?? ""); setBibName(p.bib_name ?? "");
      setAddress(p.city_psgc_code ? { city_psgc_code: p.city_psgc_code, city_name: p.city_name ?? null, province_name: p.province_name ?? null, region_name: null } : null);
      setDob(p.date_of_birth ?? ""); setGender(p.gender ?? ""); setShirtSize(p.shirt_size ?? "");
      setBloodType(p.blood_type ?? ""); setEmgName(en); setEmgPhone(ep);
      setAvatarUrl(p.avatar_url ?? null); setCoverUrl(p.cover_url ?? null);
      setSaved(snapshot({ fullName: p.full_name, bibName: p.bib_name, dob: p.date_of_birth, gender: p.gender, shirtSize: p.shirt_size, bloodType: p.blood_type, emgName: en, emgPhone: ep, city: p.city_psgc_code }));
    });
  }, [uid]);

  const current = snapshot({ fullName, bibName, dob, gender, shirtSize, bloodType, emgName, emgPhone, city: address?.city_psgc_code });
  const dirty = useMemo(() => JSON.stringify(current) !== JSON.stringify(saved), [current, saved]);

  async function save() {
    if (!uid) return;
    setBusy(true);
    const { error } = await upsertProfile({
      id: uid, full_name: fullName, bib_name: bibName,
      city_psgc_code: address?.city_psgc_code ?? null, city_name: address?.city_name ?? null, province_name: address?.province_name ?? null,
      date_of_birth: dob || null, gender: gender || null, shirt_size: shirtSize || null,
      blood_type: bloodType || null, emergency_contact: joinEmergency(emgName, emgPhone),
    });
    setBusy(false);
    if (!error) setSaved(current);
    Alert.alert(error ? "Save failed" : "Saved", error ?? "Your profile was updated.");
  }
  async function doSignOut() { await signOut(); router.replace("/(auth)/sign-in"); }

  async function changePhoto(kind: "avatar" | "cover") {
    if (!uid || photoBusy) return;
    try {
      setPhotoBusy(kind);
      const url = await pickAndUploadProfileImage(uid, kind);
      if (!url) return;
      if (kind === "avatar") setAvatarUrl(url); else setCoverUrl(url);
      const { error } = await upsertProfile({ id: uid, ...(kind === "avatar" ? { avatar_url: url } : { cover_url: url }) });
      if (error) Alert.alert("Couldn't save photo", error);
    } catch (e) {
      Alert.alert("Couldn't update photo", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setPhotoBusy(null);
    }
  }

  const name = fullName || session?.user.email || "Runner";

  return (
    <View className="flex-1 bg-background">
      <StatusBar style={overCover ? "light" : "auto"} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: dirty ? insets.bottom + 92 : insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={32}
        onScroll={(e) => setOverCover(e.nativeEvent.contentOffset.y < 150)}
      >
        {/* ── Race passport header: full-bleed forest cover + avatar + stats ── */}
        <View className="relative overflow-hidden bg-forest">
          {coverUrl ? (
            <>
              <Image source={{ uri: coverUrl }} className="absolute inset-0 h-full w-full" resizeMode="cover" />
              <View className="absolute inset-0 bg-black/35" />
            </>
          ) : null}

          <View className="px-[22px] pb-8" style={{ paddingTop: insets.top + 18 }}>
            <View className="flex-row items-center gap-4">
              <Pressable onPress={() => changePhoto("avatar")} accessibilityRole="button" accessibilityLabel="Change profile photo">
                <Avatar alt={name} style={{ width: 76, height: 76, borderRadius: 38 }} className="border-2 border-white/25">
                  {avatarUrl ? <AvatarImage source={{ uri: avatarUrl }} /> : null}
                  <AvatarFallback style={{ backgroundColor: "#0B2018", borderRadius: 38 }}>
                    <Text style={{ color: "#fff", fontWeight: "700", fontSize: 27 }}>{initials(name)}</Text>
                  </AvatarFallback>
                </Avatar>
                <View className="absolute -bottom-0.5 -right-0.5 h-6 w-6 items-center justify-center rounded-full border-2 border-forest bg-primary">
                  {photoBusy === "avatar" ? <ActivityIndicator size="small" color="#fff" /> : <Icon as={Camera} size={12} className="text-primary-foreground" />}
                </View>
              </Pressable>

              <View className="flex-1">
                <Text className="text-[20px] font-bold tracking-[-0.3px] text-white" numberOfLines={1}>{name}</Text>
                {bibName ? <Text className="mt-1.5 self-start rounded-md bg-white/15 px-2 py-0.5 text-[11px] font-bold tracking-[0.06em] text-white">BIB · {bibName}</Text> : null}
              </View>
            </View>

            <View className="mt-7 flex-row gap-8">
              <Stat label="RACES" value={String(raceCount)} />
              <Stat label="BLOOD" value={bloodType || "—"} />
              <Stat label="SHIRT" value={shirtSize || "—"} />
            </View>
          </View>

          <Pressable
            onPress={() => changePhoto("cover")}
            accessibilityRole="button"
            accessibilityLabel="Change cover photo"
            className="absolute right-3.5 flex-row items-center gap-1.5 rounded-full bg-black/30 px-3 py-1.5"
            style={{ top: insets.top + 6 }}
          >
            {photoBusy === "cover" ? <ActivityIndicator size="small" color="#fff" /> : <Icon as={Camera} size={12} className="text-white" />}
            <Text className="text-[12px] font-semibold text-white">{photoBusy === "cover" ? "Uploading…" : "Edit cover"}</Text>
          </Pressable>
        </View>

        {/* ── Cards ── */}
        <View className="mt-4 gap-3 px-[22px]">
          <View className={CARD}>
            <Text className={CARD_HEADING}>Identity</Text>
            <TextRow label="Full name" value={fullName} onChangeText={setFullName} placeholder="Add your name" accessibilityLabel="Full name" first />
            <TextRow label="Bib name" value={bibName} onChangeText={setBibName} placeholder="On your bib" autoCapitalize="characters" accessibilityLabel="Bib name" />
            <View className="border-t border-border py-3">
              <PsgcAddressPicker label="CITY" value={address} onChange={setAddress} />
            </View>
          </View>

          <View className={CARD}>
            <View className="flex-row items-center justify-between pt-3.5 pb-1">
              <Text className="text-[13px] font-bold text-foreground">Race kit</Text>
              <Text className="rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-semibold text-secondary-foreground">fill once</Text>
            </View>
            <Text className="pb-1 text-[12px] leading-[17px] text-muted-foreground">We'll add these to every race you register for.</Text>
            <TextRow label="Date of birth" value={dob} onChangeText={setDob} placeholder="YYYY-MM-DD" autoCapitalize="none" accessibilityLabel="Date of birth" first />
            <SelectRow label="Gender" value={gender} options={GENDERS} placeholder="Select" onChange={setGender} accessibilityLabel="Gender" />
            <SelectRow label="Shirt size" value={shirtSize} options={SHIRT_SIZES} placeholder="Select" onChange={setShirtSize} accessibilityLabel="Shirt size" />
            <SelectRow label="Blood type" value={bloodType} options={BLOOD_TYPES} placeholder="Select" onChange={setBloodType} accessibilityLabel="Blood type" />
            <TextRow label="Emergency name" value={emgName} onChangeText={setEmgName} placeholder="Contact name" accessibilityLabel="Emergency contact name" />
            <TextRow label="Emergency phone" value={emgPhone} onChangeText={setEmgPhone} placeholder="Mobile number" keyboardType="phone-pad" accessibilityLabel="Emergency contact number" />
          </View>

          <View className={`${CARD} mt-2`}>
            <Text className={CARD_HEADING}>Account</Text>
            {ACCOUNT.map((m, i) => (
              <Pressable key={m} onPress={() => Alert.alert(m, "Coming soon.")} accessibilityRole="button" className={cn("flex-row items-center py-3", i > 0 && "border-t border-border")}>
                <Text className="flex-1 text-[14px] text-foreground">{m}</Text>
                <Icon as={ChevronRight} size={18} className="text-muted-foreground/50" />
              </Pressable>
            ))}
          </View>

          <Button variant="ghost" className="mt-1" onPress={doSignOut}>
            <Text className="text-[15px] font-semibold text-destructive">Sign out</Text>
          </Button>
        </View>
      </ScrollView>

      {dirty ? (
        <View className="absolute inset-x-0 bottom-0 border-t border-divider bg-background/95 px-[22px] pt-3" style={{ paddingBottom: insets.bottom + 12 }}>
          <Button className="h-auto py-[15px] sm:h-auto" disabled={busy} onPress={save} accessibilityLabel="Save changes">
            <Text className="text-base font-semibold text-primary-foreground">{busy ? "Saving…" : "Save changes"}</Text>
          </Button>
        </View>
      ) : null}
    </View>
  );
}

// A stat cell on the forest header (fixed white — sits on the forest surface).
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text className="text-[17px] font-bold text-white">{value}</Text>
      <Text className="mt-0.5 text-[10px] font-semibold tracking-[0.06em] text-white/60">{label}</Text>
    </View>
  );
}

// A label→value row whose value is an inline, right-aligned text field.
function TextRow({ label, value, onChangeText, placeholder, accessibilityLabel, first, keyboardType, autoCapitalize }: {
  label: string; value: string; onChangeText: (v: string) => void; placeholder?: string; accessibilityLabel?: string;
  first?: boolean; keyboardType?: "phone-pad" | "default"; autoCapitalize?: "none" | "characters" | "sentences";
}) {
  return (
    <View className={cn(ROW, !first && "border-t border-border")}>
      <Text className={RLABEL}>{label}</Text>
      <TextInput
        className="flex-1 pl-4 text-[15px] font-semibold text-foreground placeholder:text-muted-foreground/60"
        textAlign="right"
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

// A label→value row whose value opens an RNR Select dropdown.
function SelectRow({ label, value, options, placeholder, onChange, accessibilityLabel }: {
  label: string; value: string; options: readonly string[]; placeholder: string; onChange: (v: string) => void; accessibilityLabel: string;
}) {
  return (
    <View className={cn(ROW, "border-t border-border")}>
      <Text className={RLABEL}>{label}</Text>
      <Select value={value ? { value, label: value } : undefined} onValueChange={(o) => onChange(o?.value ?? "")}>
        <SelectTrigger accessibilityLabel={accessibilityLabel} className="h-auto min-h-0 gap-1 border-0 bg-transparent px-0 py-0 shadow-none">
          <SelectValue placeholder={placeholder} className={RVALUE} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o} value={o} label={o} />)}
        </SelectContent>
      </Select>
    </View>
  );
}

// Emergency contact is stored in one column; the UI splits it into name + phone.
function splitEmergency(s: string | null | undefined): [string, string] {
  const v = s ?? "";
  const i = v.indexOf(" · ");
  return i >= 0 ? [v.slice(0, i), v.slice(i + 3)] : [v, ""];
}
function joinEmergency(name: string, phone: string): string | null {
  return [name.trim(), phone.trim()].filter(Boolean).join(" · ") || null;
}

function snapshot(v: Partial<Record<"fullName" | "bibName" | "dob" | "gender" | "shirtSize" | "bloodType" | "emgName" | "emgPhone" | "city", string | null | undefined>>): Record<string, string> {
  return {
    fullName: v.fullName ?? "", bibName: v.bibName ?? "", dob: v.dob ?? "", gender: v.gender ?? "",
    shirtSize: v.shirtSize ?? "", bloodType: v.bloodType ?? "", emgName: v.emgName ?? "", emgPhone: v.emgPhone ?? "", city: v.city ?? "",
  };
}
