import { Tabs } from "expo-router";
import { Building2, Compass, Ticket, User } from "lucide-react-native";
import { useColorScheme } from "nativewind";
import { BrandHeader } from "../../components/BrandHeader";
import { NAV_DARK, NAV_LIGHT } from "../../lib/nav-theme";

// Inactive tint isn't part of React Navigation's theme `colors` (see
// lib/nav-theme.ts), so it's picked here to match the app's muted-foreground
// design token (global.css --muted-foreground) for both color schemes.
const INACTIVE_TINT_LIGHT = "#7A7A7A";
const INACTIVE_TINT_DARK = "#A1A1A6";

export default function TabsLayout() {
  const { colorScheme } = useColorScheme();
  const dark = colorScheme === "dark";
  const navColors = (dark ? NAV_DARK : NAV_LIGHT).colors;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: navColors.primary,
        tabBarInactiveTintColor: dark ? INACTIVE_TINT_DARK : INACTIVE_TINT_LIGHT,
        headerShown: true,
        header: () => <BrandHeader />,
      }}
    >
      <Tabs.Screen
        name="events"
        options={{ title: "Events", tabBarIcon: ({ color, size }) => <Compass color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="orgs"
        options={{ title: "Orgs", tabBarIcon: ({ color, size }) => <Building2 color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="races"
        options={{ title: "My Races", tabBarIcon: ({ color, size }) => <Ticket color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: "Profile", headerShown: false, tabBarIcon: ({ color, size }) => <User color={color} size={size} /> }}
      />
    </Tabs>
  );
}
