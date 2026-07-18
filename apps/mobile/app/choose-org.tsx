import { useEffect } from "react";
import { View, Text, FlatList, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useOrg } from "../lib/org";

export default function ChooseOrg() {
  const { orgs, refreshOrgs, selectOrg } = useOrg();
  const router = useRouter();

  useEffect(() => { refreshOrgs(); }, []);

  async function pick(id: string) {
    await selectOrg(id);
    router.replace("/(tabs)/events");
  }

  return (
    <View style={styles.c}>
      <Text style={styles.h}>Choose an organization</Text>
      <FlatList
        data={orgs}
        keyExtractor={(o) => o.id}
        ListEmptyComponent={<Text style={styles.empty}>No organizations yet.</Text>}
        renderItem={({ item }) => (
          <Pressable style={[styles.card, { borderLeftColor: item.brand_color ?? "#1F6248" }]} onPress={() => pick(item.id)} accessibilityRole="button">
            <Text style={styles.name}>{item.name}</Text>
            <Text style={styles.slug}>{item.slug}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, padding: 20, paddingTop: 72 },
  h: { fontSize: 24, fontWeight: "600", marginBottom: 16 },
  card: { borderWidth: 1, borderColor: "#E2DCCC", borderLeftWidth: 5, borderRadius: 12, padding: 16, marginBottom: 12 },
  name: { fontSize: 18, fontWeight: "600" },
  slug: { color: "#8A968C", marginTop: 2, fontFamily: "Courier" },
  empty: { color: "#8A968C" },
});
