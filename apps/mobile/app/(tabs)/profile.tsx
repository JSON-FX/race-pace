import { useEffect, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../../lib/auth";
import { getProfile, upsertProfile } from "../../lib/profile";
import { initials } from "../../components/OrgAvatar";
import { theme } from "../../lib/theme";
import { PillSelect } from "../../components/PillSelect";
import { PsgcAddressPicker } from "../../components/PsgcAddressPicker";
import { BLOOD_TYPES, SHIRT_SIZES, GENDERS, formatAddress, type PsgcAddress } from "@race-pace/shared";

const MENU = ["Payment methods", "Notifications", "Help & support"];

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
    <ScrollView style={styles.c} contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
      <View style={styles.head}>
        <View style={styles.avatar}><Text style={styles.avatarT}>{initials(name)}</Text></View>
        <Text style={styles.name}>{name}</Text>
        {address?.city_name ? <Text style={styles.sub}>{formatAddress(address)}</Text> : null}
      </View>

      <View style={styles.pad}>
        <Text style={styles.section}>Profile</Text>
        <View style={{ gap: 12 }}>
          <View><Text style={styles.label}>FULL NAME</Text><TextInput style={styles.input} value={fullName} onChangeText={setFullName} placeholder="Full name" placeholderTextColor={theme.inkFaint} accessibilityLabel="Full name" /></View>
          <View><Text style={styles.label}>BIB NAME</Text><TextInput style={styles.input} value={bibName} onChangeText={setBibName} placeholder="Bib name" placeholderTextColor={theme.inkFaint} autoCapitalize="characters" accessibilityLabel="Bib name" /></View>
          <PsgcAddressPicker label="CITY" value={address} onChange={setAddress} />
        </View>

        <Text style={[styles.section, { marginTop: 26 }]}>Race details</Text>
        <Text style={styles.hint}>Fill these once — we'll add them to every race you register for.</Text>
        <View style={{ gap: 12 }}>
          <View><Text style={styles.label}>DATE OF BIRTH</Text><TextInput style={styles.input} value={dob} onChangeText={setDob} placeholder="YYYY-MM-DD" placeholderTextColor={theme.inkFaint} autoCapitalize="none" accessibilityLabel="Date of birth" /></View>
          <PillSelect label="GENDER" value={gender} options={GENDERS} onChange={setGender} />
          <PillSelect label="SHIRT SIZE" value={shirtSize} options={SHIRT_SIZES} onChange={setShirtSize} />
          <PillSelect label="BLOOD TYPE" value={bloodType} options={BLOOD_TYPES} onChange={setBloodType} />
          <View><Text style={styles.label}>EMERGENCY CONTACT</Text><TextInput style={styles.input} value={emergency} onChangeText={setEmergency} placeholder="Name & mobile number" placeholderTextColor={theme.inkFaint} accessibilityLabel="Emergency contact" /></View>
        </View>

        <Pressable style={[styles.save, busy && { opacity: 0.6 }]} disabled={busy} onPress={save} accessibilityRole="button"><Text style={styles.saveT}>{busy ? "Saving…" : "Save changes"}</Text></Pressable>

        <View style={styles.menu}>
          {MENU.map((m) => (
            <View key={m} style={styles.menuRow}><Text style={styles.menuT}>{m}</Text><Text style={styles.chevron}>›</Text></View>
          ))}
        </View>
        <Pressable onPress={doSignOut} accessibilityRole="button"><Text style={styles.signout}>Sign out</Text></Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, backgroundColor: theme.canvas },
  head: { alignItems: "center", paddingHorizontal: 22 },
  avatar: { width: 82, height: 82, borderRadius: 41, backgroundColor: theme.forest, alignItems: "center", justifyContent: "center" },
  avatarT: { color: "#fff", fontSize: 28, fontWeight: "700" },
  name: { fontSize: 22, fontWeight: "700", letterSpacing: -0.3, color: theme.ink, marginTop: 12 },
  sub: { fontSize: 13, color: theme.inkMuted, marginTop: 2 },
  pad: { paddingHorizontal: 22, marginTop: 24 },
  section: { fontSize: 15, fontWeight: "600", color: theme.ink, marginBottom: 12 },
  hint: { fontSize: 13, color: theme.inkMuted, marginTop: -6, marginBottom: 12, lineHeight: 18 },
  label: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4, color: theme.inkMuted, marginBottom: 6 },
  input: { backgroundColor: theme.canvas, borderWidth: 1, borderColor: theme.hairline, borderRadius: theme.radius.md, paddingVertical: 13, paddingHorizontal: 14, fontSize: 15, color: theme.ink },
  save: { backgroundColor: theme.primary, borderRadius: theme.radius.pill, padding: 15, alignItems: "center", marginTop: 20 },
  saveT: { color: "#fff", fontSize: 16, fontWeight: "600" },
  menu: { marginTop: 20 },
  menuRow: { flexDirection: "row", alignItems: "center", paddingVertical: 15, borderTopWidth: 1, borderTopColor: theme.divider },
  menuT: { flex: 1, fontSize: 14, color: theme.ink },
  chevron: { color: theme.inkFaint, fontSize: 18 },
  signout: { color: theme.danger, fontSize: 15, fontWeight: "600", textAlign: "center", marginTop: 14 },
});
