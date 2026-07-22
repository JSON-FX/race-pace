import { useEffect, useMemo, useState } from "react";
import { View, ScrollView, Pressable, Alert, Image } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Camera, ChevronRight } from "lucide-react-native";
import { useAuth } from "../../lib/auth";
import { getProfile, upsertProfile, type Profile } from "../../lib/profile";
import { initials } from "../../components/OrgAvatar";
import { PillSelect } from "../../components/PillSelect";
import { PsgcAddressPicker } from "../../components/PsgcAddressPicker";
import { BLOOD_TYPES, SHIRT_SIZES, GENDERS, formatAddress, type PsgcAddress } from "@race-pace/shared";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { Icon } from "@/components/ui/icon";

const ACCOUNT = ["Payment methods", "Notifications", "Help & support"];
const FIELD_LABEL = "text-[11px] font-semibold tracking-[0.4px] text-muted-foreground mb-2";
const CARD = "rounded-[16px] border border-border bg-card p-4";
const CARD_HEADING = "mb-3 text-[13px] font-bold text-foreground";

export default function Profile() {
  const { session, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const uid = session?.user.id;

  const [fullName, setFullName] = useState("");
  const [bibName, setBibName] = useState("");
  const [address, setAddress] = useState<PsgcAddress | null>(null);
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("");
  const [shirtSize, setShirtSize] = useState("");
  const [bloodType, setBloodType] = useState("");
  const [emergency, setEmergency] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Snapshot of the last-saved values, so the Save bar only appears once something changed.
  const [saved, setSaved] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!uid) return;
    getProfile(uid).then((p) => {
      if (!p) { setSaved(snapshot({})); return; }
      setFullName(p.full_name ?? ""); setBibName(p.bib_name ?? "");
      setAddress(p.city_psgc_code ? { city_psgc_code: p.city_psgc_code, city_name: p.city_name ?? null, province_name: p.province_name ?? null, region_name: null } : null);
      setDob(p.date_of_birth ?? ""); setGender(p.gender ?? ""); setShirtSize(p.shirt_size ?? "");
      setBloodType(p.blood_type ?? ""); setEmergency(p.emergency_contact ?? "");
      setSaved(snapshot({
        fullName: p.full_name, bibName: p.bib_name, dob: p.date_of_birth, gender: p.gender,
        shirtSize: p.shirt_size, bloodType: p.blood_type, emergency: p.emergency_contact,
        city: p.city_psgc_code,
      }));
    });
  }, [uid]);

  const current = snapshot({ fullName, bibName, dob, gender, shirtSize, bloodType, emergency, city: address?.city_psgc_code });
  const dirty = useMemo(() => JSON.stringify(current) !== JSON.stringify(saved), [current, saved]);

  async function save() {
    if (!uid) return;
    setBusy(true);
    const { error } = await upsertProfile({
      id: uid, full_name: fullName, bib_name: bibName,
      city_psgc_code: address?.city_psgc_code ?? null, city_name: address?.city_name ?? null, province_name: address?.province_name ?? null,
      date_of_birth: dob || null, gender: gender || null, shirt_size: shirtSize || null,
      blood_type: bloodType || null, emergency_contact: emergency || null,
    });
    setBusy(false);
    if (!error) setSaved(current);
    Alert.alert(error ? "Save failed" : "Saved", error ?? "Your profile was updated.");
  }
  async function doSignOut() { await signOut(); router.replace("/(auth)/sign-in"); }

  // Cover + avatar upload land in the next step (needs the image picker + storage).
  function changePhoto(kind: "cover photo" | "profile photo") {
    Alert.alert("Coming up next", `Uploading a ${kind} is wired in the next step.`);
  }

  const name = fullName || session?.user.email || "Runner";
  const kit = [gender, shirtSize && `Shirt ${shirtSize}`, bloodType].filter(Boolean);

  return (
    <View className="flex-1 bg-background">
      <ScrollView contentContainerStyle={{ paddingBottom: dirty ? insets.bottom + 92 : insets.bottom + 32 }} showsVerticalScrollIndicator={false}>
        {/* ── Race passport header: cover photo + avatar ── */}
        <View>
          <Pressable onPress={() => changePhoto("cover photo")} accessibilityRole="button" accessibilityLabel="Change cover photo">
            <View className="bg-forest" style={{ height: 150 + insets.top }}>
              {coverUrl ? <Image source={{ uri: coverUrl }} style={{ width: "100%", height: "100%" }} resizeMode="cover" /> : null}
            </View>
            <View className="absolute right-3.5 flex-row items-center gap-1.5 rounded-full bg-black/35 px-3 py-1.5" style={{ top: insets.top + 8 }}>
              <Icon as={Camera} size={13} className="text-white" />
              <Text className="text-[12px] font-semibold text-white">Edit cover</Text>
            </View>
          </Pressable>

          <View className="items-center px-[22px]">
            <Pressable onPress={() => changePhoto("profile photo")} accessibilityRole="button" accessibilityLabel="Change profile photo" className="-mt-[46px]">
              <Avatar alt={name} style={{ width: 92, height: 92, borderRadius: 46 }} className="border-4 border-background">
                {avatarUrl ? <AvatarImage source={{ uri: avatarUrl }} /> : null}
                <AvatarFallback style={{ backgroundColor: "#0F2A20", borderRadius: 46 }}>
                  <Text style={{ color: "#fff", fontWeight: "700", fontSize: 34 }}>{initials(name)}</Text>
                </AvatarFallback>
              </Avatar>
              <View className="absolute bottom-0 right-0 h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-primary">
                <Icon as={Camera} size={13} className="text-primary-foreground" />
              </View>
            </Pressable>

            <Text className="mt-2.5 text-[22px] font-bold tracking-[-0.3px] text-foreground">{name}</Text>
            {bibName ? <Text className="mt-1 rounded-md bg-secondary px-2.5 py-0.5 text-[11px] font-bold tracking-[0.06em] text-secondary-foreground">BIB · {bibName}</Text> : null}
            {address?.city_name ? <Text className="mt-1.5 text-[13px] text-muted-foreground">{formatAddress(address)}</Text> : null}
            {kit.length ? <Text className="mt-1.5 text-[12px] text-muted-foreground">{kit.join("  ·  ")}</Text> : null}
          </View>
        </View>

        {/* ── Editable cards ── */}
        <View className="mt-5 gap-3 px-[22px]">
          <View className={CARD}>
            <Text className={CARD_HEADING}>Identity</Text>
            <View className="gap-3">
              <View>
                <Text className={FIELD_LABEL}>FULL NAME</Text>
                <Input value={fullName} onChangeText={setFullName} placeholder="Full name" accessibilityLabel="Full name" />
              </View>
              <View>
                <Text className={FIELD_LABEL}>BIB NAME</Text>
                <Input value={bibName} onChangeText={setBibName} placeholder="Bib name" autoCapitalize="characters" accessibilityLabel="Bib name" />
              </View>
              <PsgcAddressPicker label="CITY" value={address} onChange={setAddress} />
            </View>
          </View>

          <View className={CARD}>
            <View className="mb-3 flex-row items-center justify-between">
              <Text className="text-[13px] font-bold text-foreground">Race kit</Text>
              <Text className="rounded-full bg-secondary px-2.5 py-0.5 text-[10px] font-semibold text-secondary-foreground">fill once</Text>
            </View>
            <Text className="-mt-1 mb-3 text-[12px] leading-[17px] text-muted-foreground">
              We'll add these to every race you register for.
            </Text>
            <View className="gap-3">
              <View>
                <Text className={FIELD_LABEL}>DATE OF BIRTH</Text>
                <Input value={dob} onChangeText={setDob} placeholder="YYYY-MM-DD" autoCapitalize="none" accessibilityLabel="Date of birth" />
              </View>
              <PillSelect label="GENDER" value={gender} options={GENDERS} onChange={setGender} />
              <PillSelect label="SHIRT SIZE" value={shirtSize} options={SHIRT_SIZES} onChange={setShirtSize} />
              <PillSelect label="BLOOD TYPE" value={bloodType} options={BLOOD_TYPES} onChange={setBloodType} />
              <View>
                <Text className={FIELD_LABEL}>EMERGENCY CONTACT</Text>
                <Input value={emergency} onChangeText={setEmergency} placeholder="Name & mobile number" accessibilityLabel="Emergency contact" />
              </View>
            </View>
          </View>

          {/* ── Account ── */}
          <View className={`${CARD} mt-2`}>
            <Text className={CARD_HEADING}>Account</Text>
            {ACCOUNT.map((m, i) => (
              <Pressable
                key={m}
                onPress={() => Alert.alert(m, "Coming soon.")}
                accessibilityRole="button"
                className={`flex-row items-center py-3 ${i > 0 ? "border-t border-border" : ""}`}
              >
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

      {/* ── Save bar — appears only when something changed ── */}
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

// Normalizes the editable fields to a comparable string map (nulls → "").
function snapshot(v: Partial<Record<"fullName" | "bibName" | "dob" | "gender" | "shirtSize" | "bloodType" | "emergency" | "city", string | null | undefined>>): Record<string, string> {
  return {
    fullName: v.fullName ?? "", bibName: v.bibName ?? "", dob: v.dob ?? "", gender: v.gender ?? "",
    shirtSize: v.shirtSize ?? "", bloodType: v.bloodType ?? "", emergency: v.emergency ?? "", city: v.city ?? "",
  };
}
