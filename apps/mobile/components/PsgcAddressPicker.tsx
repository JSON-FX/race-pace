import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import { usePsgcRegions, usePsgcProvinces, usePsgcCities } from "../lib/psgc";
import { formatAddress, type PsgcAddress } from "@race-pace/shared";
import { theme } from "../lib/theme";

type Node = { code: string; name: string };

export function PsgcAddressPicker({ value, onChange, label = "LOCATION" }: {
  value: PsgcAddress | null; onChange: (a: PsgcAddress) => void; label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [region, setRegion] = useState<Node | null>(null);
  const [province, setProvince] = useState<Node | null>(null);
  const [search, setSearch] = useState("");

  const regions = usePsgcRegions();
  const provinces = usePsgcProvinces(region?.code);
  const noProvinces = !!region && provinces.isSuccess && (provinces.data?.length ?? 0) === 0;
  const cities = usePsgcCities({ provinceCode: province?.code, regionCode: noProvinces ? region?.code : undefined, search });

  function reset() { setRegion(null); setProvince(null); setSearch(""); }
  function backToProvince() { setProvince(null); setSearch(""); }
  function pickCity(c: Node) {
    onChange({ city_psgc_code: c.code, city_name: c.name, province_name: province?.name ?? null, region_name: region?.name ?? null });
    setOpen(false); reset();
  }

  const atCity = !!province || noProvinces;

  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <Pressable style={styles.field} onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityLabel={label}>
        <Text style={value?.city_name ? styles.val : styles.placeholder}>
          {value?.city_name ? formatAddress(value) : "Select region → province → city"}
        </Text>
      </Pressable>

      {open && (
        <View style={styles.panel}>
          {!region ? (
            <>
              <Text style={styles.step}>Region</Text>
              {(regions.data ?? []).map((r) => (
                <Pressable key={r.code} style={styles.opt} onPress={() => setRegion(r)} accessibilityRole="button"><Text style={styles.optT}>{r.name}</Text></Pressable>
              ))}
            </>
          ) : !atCity ? (
            <>
              <Pressable onPress={reset} accessibilityRole="button"><Text style={styles.crumb}>‹ {region.name}</Text></Pressable>
              {!provinces.isSuccess ? (
                <Text style={styles.loading} accessibilityLabel="Loading">Loading…</Text>
              ) : (
                <>
                  <Text style={styles.step}>Province</Text>
                  {(provinces.data ?? []).map((p) => (
                    <Pressable key={p.code} style={styles.opt} onPress={() => setProvince(p)} accessibilityRole="button"><Text style={styles.optT}>{p.name}</Text></Pressable>
                  ))}
                </>
              )}
            </>
          ) : (
            <>
              <Pressable onPress={() => (province ? backToProvince() : reset())} accessibilityRole="button"><Text style={styles.crumb}>‹ {province?.name ?? region.name}</Text></Pressable>
              <Text style={styles.step}>City / Municipality</Text>
              <TextInput style={styles.search} value={search} onChangeText={setSearch} placeholder="Search city…" placeholderTextColor={theme.inkFaint} accessibilityLabel="Search city" />
              {(cities.data ?? []).map((c) => (
                <Pressable key={c.code} style={styles.opt} onPress={() => pickCity(c)} accessibilityRole="button"><Text style={styles.optT}>{c.name}</Text></Pressable>
              ))}
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4, color: theme.inkMuted, marginBottom: 6 },
  field: { backgroundColor: theme.canvas, borderWidth: 1, borderColor: theme.hairline, borderRadius: theme.radius.md, paddingVertical: 13, paddingHorizontal: 14 },
  val: { fontSize: 15, color: theme.ink }, placeholder: { fontSize: 15, color: theme.inkFaint },
  panel: { borderWidth: 1, borderColor: theme.hairline, borderRadius: theme.radius.md, marginTop: 8, padding: 8, maxHeight: 320 },
  step: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4, color: theme.inkMuted, paddingHorizontal: 6, paddingVertical: 6 },
  loading: { fontSize: 14, color: theme.inkMuted, paddingHorizontal: 6, paddingVertical: 10 },
  crumb: { color: theme.primary, fontSize: 14, fontWeight: "500", paddingHorizontal: 6, paddingVertical: 4 },
  search: { borderWidth: 1, borderColor: theme.hairline, borderRadius: theme.radius.sm, paddingVertical: 9, paddingHorizontal: 12, fontSize: 14, color: theme.ink, marginBottom: 6, marginHorizontal: 4 },
  opt: { paddingVertical: 11, paddingHorizontal: 10, borderTopWidth: 1, borderTopColor: theme.divider },
  optT: { fontSize: 14, color: theme.ink },
});
