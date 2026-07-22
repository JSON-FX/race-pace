import { Text } from "react-native";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
// Initials are a fixed-white, dynamically-sized overlay on a saturated org
// color — use plain RN Text, not @/components/ui/text (its base text-foreground
// + text-base classes would fight the inline white color and font size).

export function initials(name?: string | null): string {
  if (!name) return "?";
  const words = name.replace(/[^A-Za-z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean);
  const two = (words[0]?.[0] ?? "") + (words[1]?.[0] ?? "");
  return (two || words[0]?.slice(0, 2) || "?").toUpperCase();
}

export function OrgAvatar({ name, color, size = 24, radius }: {
  name?: string | null; color?: string | null; size?: number; radius?: number;
}) {
  const borderRadius = radius ?? size / 2;
  return (
    <Avatar alt={name ? `${name} logo` : "Organization logo"} style={{ width: size, height: size, borderRadius }}>
      <AvatarFallback style={{ backgroundColor: color || "#159A55" /* trail-green brand default */, borderRadius }}>
        <Text style={{ color: "#fff", fontWeight: "700", fontSize: Math.max(9, Math.round(size * 0.4)) }}>{initials(name)}</Text>
      </AvatarFallback>
    </Avatar>
  );
}
