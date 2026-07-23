import { Image, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Bell } from "lucide-react-native";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useUnreadCount } from "@/lib/notifications";

const MARK = require("../assets/topnav-logo.png");
const BAR_HEIGHT = 52;

// App brand bar shown across the tab shell: mark + app name on the left, a notifications
// bell (with unread badge) on the right. Owns the top safe-area inset.
export function BrandHeader() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data: unread } = useUnreadCount();
  return (
    <View
      className="flex-row items-center justify-between border-b border-divider bg-background px-[22px]"
      style={{ paddingTop: insets.top, height: BAR_HEIGHT + insets.top }}
    >
      <View className="flex-row items-center gap-2.5">
        <Image source={MARK} style={{ width: 30, height: 30 }} resizeMode="contain" />
        <Text className="text-[17px] font-bold tracking-[-0.3px] text-foreground">Race Pace</Text>
      </View>
      <Pressable className="p-1" accessibilityRole="button" accessibilityLabel="Notifications" hitSlop={10}
        onPress={() => router.push("/notifications")}>
        <Icon as={Bell} size={24} strokeWidth={1.8} />
        {unread ? (
          <View className="absolute -right-1 -top-1 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1" style={{ height: 16 }}>
            <Text className="text-[10px] font-semibold text-white">{unread > 99 ? "99+" : unread}</Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}
