import { View, Text, Pressable, StyleSheet } from "react-native";
import { theme } from "../lib/theme";

export function PillSelect({ label, value, options, onChange, accessibilityLabel }: {
  label: string; value: string | null; options: readonly string[];
  onChange: (v: string) => void; accessibilityLabel?: string;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label} accessibilityLabel={accessibilityLabel}>{label}</Text>
      <View style={styles.options}>
        {options.map((opt) => {
          const active = value === opt;
          return (
            <Pressable key={opt} onPress={() => onChange(opt)} style={[styles.opt, active && styles.optActive]}
              accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={opt}>
              <Text style={[styles.optText, active && styles.optTextActive]}>{opt}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 14 },
  label: { fontSize: 11, fontWeight: "600", letterSpacing: 0.4, color: theme.inkMuted, marginBottom: 8 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  opt: { borderWidth: 1, borderColor: theme.hairline, borderRadius: theme.radius.pill, paddingVertical: 8, paddingHorizontal: 14 },
  optActive: { backgroundColor: theme.primary, borderColor: theme.primary },
  optText: { color: theme.ink, fontSize: 14 },
  optTextActive: { color: theme.onPrimary, fontWeight: "600" },
});
