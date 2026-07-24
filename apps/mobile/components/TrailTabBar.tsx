import type { BottomTabBarProps } from "expo-router/build/react-navigation/bottom-tabs";
import { useColorScheme } from "nativewind";
import { Pressable, Text, View } from "react-native";

// Trailhead-float tab bar — a floating rounded capsule lifted off the bottom
// edge; the active tab is a solid green coin with its icon knocked out.
//
// Layout is done with NativeWind `className` (flex-row / flex-1), not
// StyleSheet: this app styles through NativeWind's jsx transform, and an
// earlier StyleSheet-based `flex`/`width` row distributed unevenly here while
// className flex rows (the filter chips, cards) lay out correctly. Theme
// adaptation uses `dark:` variants; the lucide icon colour is the one thing
// that must be a real value, so it comes from useColorScheme.
//
// `BottomTabBarProps` is a type-only import from expo-router's vendored React
// Navigation fork (SDK 57 bundles bottom-tabs internally; see lib/nav-theme.ts).
const ICON_LIGHT = { onActive: "#FFFFFF", inactive: "#8A8A8E" };
const ICON_DARK = { onActive: "#06120B", inactive: "#9A9AA0" };

export function TrailTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const { colorScheme } = useColorScheme();
  const ic = colorScheme === "dark" ? ICON_DARK : ICON_LIGHT;

  return (
    <View className="px-4 pt-1.5" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
      <View
        className="flex-row items-center rounded-[26px] border border-[#ECECEE] bg-white py-2 dark:border-[#2A302C] dark:bg-[#141916]"
        style={{
          shadowColor: "#000",
          shadowOpacity: 0.12,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 6 },
          elevation: 10,
        }}
      >
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const focused = state.index === index;
          const label =
            typeof options.tabBarLabel === "string"
              ? options.tabBarLabel
              : (options.title ?? route.name);
          const iconColor = focused ? ic.onActive : ic.inactive;

          const onPress = () => {
            const event = navigation.emit({
              type: "tabPress",
              target: route.key,
              canPreventDefault: true,
            });
            if (!focused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };
          const onLongPress = () => {
            navigation.emit({ type: "tabLongPress", target: route.key });
          };

          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
              testID={options.tabBarButtonTestID}
              onPress={onPress}
              onLongPress={onLongPress}
              className="flex-1 items-center justify-center active:opacity-60"
              style={{ gap: 3 }}
            >
              <View className="h-10 w-10 items-center justify-center">
                {focused ? (
                  <View className="h-[38px] w-[38px] items-center justify-center rounded-full bg-[#159A55] dark:bg-[#2FB56A]">
                    {options.tabBarIcon?.({ focused, color: iconColor, size: 20 })}
                  </View>
                ) : (
                  options.tabBarIcon?.({ focused, color: iconColor, size: 23 })
                )}
              </View>
              <Text
                numberOfLines={1}
                style={{ fontSize: 11, fontWeight: focused ? "600" : "500" }}
                className={
                  focused
                    ? "text-[#159A55] dark:text-[#2FB56A]"
                    : "text-[#8A8A8E] dark:text-[#9A9AA0]"
                }
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
