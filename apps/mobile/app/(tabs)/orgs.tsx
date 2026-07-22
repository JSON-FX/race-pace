import { useMemo, useState } from "react";
import { View, TextInput, FlatList, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { Search } from "lucide-react-native";
import { useOrgs } from "../../lib/events";
import { OrgAvatar } from "../../components/OrgAvatar";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";

export default function Orgs() {
  const { data, isLoading, isError, refetch } = useOrgs();
  const router = useRouter();
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const list = data ?? [];
    const n = q.trim().toLowerCase();
    return n ? list.filter((o) => o.name.toLowerCase().includes(n) || (o.description ?? "").toLowerCase().includes(n)) : list;
  }, [data, q]);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator className="text-primary" />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Button variant="ghost" onPress={() => refetch()}>
          <Text className="text-destructive">Couldn't load. Tap to retry.</Text>
        </Button>
      </View>
    );
  }

  return (
    <FlatList
      className="flex-1 bg-background"
      data={rows}
      keyExtractor={(o) => o.id}
      contentContainerClassName="pt-2 pb-8"
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={
        <View className="px-[22px] mb-2">
          <Text className="text-3xl font-bold tracking-[-0.5px] text-foreground">Organizations</Text>
          <View className="flex-row items-center gap-2 bg-muted rounded-[11px] py-3 px-[14px] mt-[14px]">
            <Icon as={Search} size={17} className="text-muted-foreground" />
            <TextInput
              className="flex-1 p-0 text-[15px] text-foreground placeholder:text-muted-foreground"
              value={q}
              onChangeText={setQ}
              placeholder="Search organizations"
              autoCapitalize="none"
              accessibilityLabel="Search organizations"
            />
          </View>
        </View>
      }
      ListEmptyComponent={<Text className="text-muted-foreground px-[22px]">No organizations yet.</Text>}
      renderItem={({ item }) => {
        const count = item.event_count ?? 0;
        return (
          <Pressable
            className="flex-row items-center gap-[14px] py-[15px] px-[22px] border-t border-divider"
            onPress={() => router.push(`/org/${item.id}`)}
            accessibilityRole="button"
          >
            <OrgAvatar name={item.name} color={item.brand_color} size={48} radius={14} />
            <View className="flex-1">
              <Text className="text-[15px] font-semibold text-foreground">{item.name}</Text>
              <Text className="text-[13px] text-muted-foreground mt-0.5">{count} {count === 1 ? "event" : "events"}</Text>
            </View>
            <Text className="text-muted-foreground/40 text-xl">›</Text>
          </Pressable>
        );
      }}
    />
  );
}
