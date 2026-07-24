import { Tabs } from "expo-router";
import { FlagTriangleRight, Medal, Mountain, User } from "lucide-react-native";
import { BrandHeader } from "../../components/BrandHeader";
import { TrailTabBar } from "../../components/TrailTabBar";

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TrailTabBar {...props} />}
      screenOptions={{ headerShown: true, header: () => <BrandHeader /> }}
    >
      <Tabs.Screen
        name="events"
        options={{
          title: "Events",
          tabBarIcon: ({ color, size, focused }) => (
            <Mountain color={color} size={size} strokeWidth={focused ? 2.4 : 2} />
          ),
        }}
      />
      <Tabs.Screen
        name="orgs"
        options={{
          title: "Orgs",
          tabBarIcon: ({ color, size, focused }) => (
            <FlagTriangleRight color={color} size={size} strokeWidth={focused ? 2.4 : 2} />
          ),
        }}
      />
      <Tabs.Screen
        name="races"
        options={{
          title: "My Races",
          tabBarIcon: ({ color, size, focused }) => (
            <Medal color={color} size={size} strokeWidth={focused ? 2.4 : 2} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          headerShown: false,
          tabBarIcon: ({ color, size, focused }) => (
            <User color={color} size={size} strokeWidth={focused ? 2.4 : 2} />
          ),
        }}
      />
    </Tabs>
  );
}
