import { View, SectionList, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";
import { useNotifications, useMarkAllRead, useMarkRead, type NotificationRow } from "../lib/notifications";
import { routeFor, iconFor, accentFor } from "../lib/notificationMeta";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

function isToday(iso: string) {
  return new Date(iso).toDateString() === new Date().toDateString();
}
function relative(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { data, isLoading } = useNotifications();
  const markAll = useMarkAllRead();
  const markRead = useMarkRead();

  const list = data ?? [];
  const sections = [
    { title: "Today", data: list.filter((n) => isToday(n.created_at)) },
    { title: "Earlier", data: list.filter((n) => !isToday(n.created_at)) },
  ].filter((s) => s.data.length > 0);

  const onRow = (n: NotificationRow) => {
    if (!n.read_at) markRead.mutate(n.id);
    const route = routeFor(n.type, n.data);
    router.push((route ?? "/(tabs)/events") as never);
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center justify-between border-b border-divider px-[18px] py-2.5">
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={10} className="p-1">
          <Icon as={ChevronLeft} size={24} />
        </Pressable>
        <Text className="text-[16px] font-semibold text-foreground">Notifications</Text>
        <Pressable onPress={() => markAll.mutate()} accessibilityRole="button" hitSlop={10} className="p-1">
          <Text className="text-[13px] text-primary">Mark all read</Text>
        </Pressable>
      </View>

      {isLoading && !data ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator className="text-primary" /></View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(n) => n.id}
          showsVerticalScrollIndicator={false}
          contentContainerClassName="pb-8"
          ListEmptyComponent={
            <View className="items-center pt-24">
              <Text className="text-lg font-semibold text-foreground">You're all caught up</Text>
              <Text className="mt-1.5 max-w-[240px] text-center text-sm text-muted-foreground">
                Registrations, payments, and race-day updates will show up here.
              </Text>
            </View>
          }
          renderSectionHeader={({ section }) => (
            <Text className="bg-background px-[22px] pb-1 pt-3 text-xs font-medium text-muted-foreground">{section.title}</Text>
          )}
          renderItem={({ item }) => (
            <Pressable onPress={() => onRow(item)} accessibilityRole="button"
              className={cn("flex-row items-start gap-3 px-[22px] py-3 border-t border-border", !item.read_at && "bg-primary/5")}>
              <View className="mt-0.5 h-9 w-9 items-center justify-center rounded-full bg-secondary">
                <Icon as={iconFor(item.type)} size={18} className={accentFor(item.type)} />
              </View>
              <View className="flex-1">
                <Text className="text-[14px] font-semibold text-foreground">{item.title}</Text>
                <Text className="mt-0.5 text-[13px] text-muted-foreground">{item.body}</Text>
                <Text className="mt-1 text-[11px] text-muted-foreground/70">{relative(item.created_at)}</Text>
              </View>
              {!item.read_at ? <View className="mt-2 h-2 w-2 rounded-full bg-primary" /> : null}
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
