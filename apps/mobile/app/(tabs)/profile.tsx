import { useEffect, useState } from "react";
import { View, ScrollView, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../../lib/auth";
import { getProfile, upsertProfile } from "../../lib/profile";
import { OrgAvatar } from "../../components/OrgAvatar";
import { PillSelect } from "../../components/PillSelect";
import { PsgcAddressPicker } from "../../components/PsgcAddressPicker";
import { BLOOD_TYPES, SHIRT_SIZES, GENDERS, formatAddress, type PsgcAddress } from "@race-pace/shared";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";

const MENU = ["Payment methods", "Notifications", "Help & support"];
// Matches the field-label look already established by PillSelect / PsgcAddressPicker,
// so the plain-Input fields (name, DOB, emergency contact) line up visually with them.
const FIELD_LABEL = "text-[11px] font-semibold tracking-[0.4px] text-muted-foreground mb-2";

export default function Profile() {
  const { session, signOut } = useAuth();
  const router = useRouter();
  const uid = session?.user.id;
  const [fullName, setFullName] = useState("");
  const [bibName, setBibName] = useState("");
  const [address, setAddress] = useState<PsgcAddress | null>(null);
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("");
  const [shirtSize, setShirtSize] = useState("");
  const [bloodType, setBloodType] = useState("");
  const [emergency, setEmergency] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!uid) return;
    getProfile(uid).then((p) => {
      if (p) {
        setFullName(p.full_name ?? ""); setBibName(p.bib_name ?? "");
        setAddress(p.city_psgc_code ? { city_psgc_code: p.city_psgc_code, city_name: p.city_name ?? null, province_name: p.province_name ?? null, region_name: null } : null);
        setDob(p.date_of_birth ?? ""); setGender(p.gender ?? ""); setShirtSize(p.shirt_size ?? "");
        setBloodType(p.blood_type ?? ""); setEmergency(p.emergency_contact ?? "");
      }
    });
  }, [uid]);

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
    Alert.alert(error ? "Save failed" : "Saved", error ?? "Your profile was updated.");
  }
  async function doSignOut() { await signOut(); router.replace("/(auth)/sign-in"); }

  const name = fullName || session?.user.email || "Runner";

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="pt-2.5 pb-10" showsVerticalScrollIndicator={false}>
      <View className="items-center px-[22px]">
        <OrgAvatar name={name} color="#0F2A20" size={82} />
        <Text className="mt-3 text-[22px] font-bold tracking-[-0.3px] text-foreground">{name}</Text>
        {address?.city_name ? <Text className="mt-0.5 text-[13px] text-muted-foreground">{formatAddress(address)}</Text> : null}
      </View>

      <View className="mt-6 px-[22px]">
        <Text className="mb-3 text-[15px] font-semibold text-foreground">Profile</Text>
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

        <Text className="mb-3 mt-[26px] text-[15px] font-semibold text-foreground">Race details</Text>
        <Text className="-mt-1.5 mb-3 text-[13px] leading-[18px] text-muted-foreground">
          Fill these once — we'll add them to every race you register for.
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

        <Button className="mt-5 h-auto py-[15px] sm:h-auto" disabled={busy} onPress={save}>
          <Text className="text-base font-semibold text-primary-foreground">{busy ? "Saving…" : "Save changes"}</Text>
        </Button>

        <View className="mt-5">
          {MENU.map((m) => (
            <View key={m} className="flex-row items-center border-t border-divider py-[15px]">
              <Text className="flex-1 text-sm text-foreground">{m}</Text>
              <Text className="text-lg text-muted-foreground/40">›</Text>
            </View>
          ))}
        </View>
        <Button variant="ghost" className="mt-3.5" onPress={doSignOut}>
          <Text className="text-[15px] font-semibold text-destructive">Sign out</Text>
        </Button>
      </View>
    </ScrollView>
  );
}
