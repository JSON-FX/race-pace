import { Image, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Bell } from "lucide-react-native";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";

const MARK = require("../assets/topnav-logo.png");
const BAR_HEIGHT = 52;

// App brand bar shown across the tab shell: mark + app name grouped on the left,
// a notifications action on the right. Owns the top safe-area inset (screens
// below use a small top padding).
export function BrandHeader() {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-row items-center justify-between border-b border-divider bg-background px-[22px]"
      style={{ paddingTop: insets.top, height: BAR_HEIGHT + insets.top }}
    >
      <View className="flex-row items-center gap-2.5">
        <Image source={MARK} style={{ width: 30, height: 30 }} resizeMode="contain" />
        <Text className="text-[17px] font-bold tracking-[-0.3px] text-foreground">Race Pace</Text>
      </View>
      <Pressable className="p-1" accessibilityRole="button" accessibilityLabel="Notifications" hitSlop={10} onPress={() => {}}>
        <Icon as={Bell} size={24} strokeWidth={1.8} />
      </Pressable>
    </View>
  );
}
