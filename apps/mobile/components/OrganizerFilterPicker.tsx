import { useMemo, useState } from "react";
import { View, Pressable, SectionList } from "react-native";
import { ChevronLeft, Search, X } from "lucide-react-native";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { Checkbox } from "@/components/ui/checkbox";
import { OrgAvatar } from "./OrgAvatar";
import type { OrgRow } from "@/lib/events";

function sectionOrgs(orgs: OrgRow[]): { title: string; data: OrgRow[] }[] {
  const sorted = [...orgs].sort((a, b) => a.name.localeCompare(b.name));
  const sections = new Map<string, OrgRow[]>();
  for (const org of sorted) {
    const char = org.name[0]?.toUpperCase() ?? "#";
    const letter = /[A-Z]/.test(char) ? char : "#";
    if (!sections.has(letter)) sections.set(letter, []);
    sections.get(letter)!.push(org);
  }
  return Array.from(sections, ([title, data]) => ({ title, data }));
}

export function OrganizerFilterPicker({ orgs, selectedIds, onChangeSelectedIds, onBack }: {
  orgs: OrgRow[]; selectedIds: string[]; onChangeSelectedIds: (ids: string[]) => void; onBack: () => void;
}) {
  const [q, setQ] = useState("");

  const withEvents = useMemo(() => orgs.filter((o) => (o.event_count ?? 0) > 0), [orgs]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? withEvents.filter((o) => o.name.toLowerCase().includes(needle)) : withEvents;
  }, [withEvents, q]);
  const sections = useMemo(() => sectionOrgs(filtered), [filtered]);
  const selectedOrgs = useMemo(() => orgs.filter((o) => selectedIds.includes(o.id)), [orgs, selectedIds]);

  function toggle(id: string) {
    onChangeSelectedIds(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  return (
    <View className="flex-1">
      <View className="flex-row items-center gap-[10px] mb-4">
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
          <Icon as={ChevronLeft} size={20} className="text-primary" />
        </Pressable>
        <Text className="text-[17px] font-bold text-foreground">Organizer</Text>
      </View>

      <View className="flex-row items-center gap-2 bg-muted rounded-[11px] py-2.5 px-[12px] mb-3">
        <Icon as={Search} size={16} className="text-muted-foreground" />
        <Input
          className="flex-1 border-0 bg-transparent h-auto p-0 shadow-none"
          value={q}
          onChangeText={setQ}
          placeholder="Search organizers"
          autoCapitalize="none"
          accessibilityLabel="Search organizers"
        />
      </View>

      {selectedOrgs.length > 0 ? (
        <View className="flex-row flex-wrap gap-[7px] mb-3">
          {selectedOrgs.map((o) => (
            <Pressable
              key={o.id}
              onPress={() => toggle(o.id)}
              accessibilityRole="button"
              className="flex-row items-center gap-[6px] bg-secondary rounded-full px-[10px] py-[5px]"
            >
              <Text className="text-[12px] font-semibold text-secondary-foreground">{o.name}</Text>
              <Icon as={X} size={12} className="text-secondary-foreground/70" />
            </Pressable>
          ))}
        </View>
      ) : null}

      <SectionList
        sections={sections}
        keyExtractor={(o) => o.id}
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) => (
          <Text className="text-[12px] font-bold text-primary bg-background pt-2 pb-1">{section.title}</Text>
        )}
        renderItem={({ item }) => {
          const checked = selectedIds.includes(item.id);
          return (
            <Pressable onPress={() => toggle(item.id)} accessibilityRole="button" className="flex-row items-center gap-3 py-[11px]">
              <OrgAvatar name={item.name} color={item.brand_color} size={32} radius={9} />
              <View className="flex-1">
                <Text className="text-[14.5px] text-foreground">{item.name}</Text>
                <Text className="text-[11.5px] text-muted-foreground">{item.event_count} {item.event_count === 1 ? "event" : "events"}</Text>
              </View>
              <Checkbox checked={checked} onCheckedChange={() => toggle(item.id)} accessibilityLabel={item.name} />
            </Pressable>
          );
        }}
        ListEmptyComponent={<Text className="text-muted-foreground py-6 text-center">{q.trim() ? `No organizers match "${q}"` : "No organizers to show"}</Text>}
      />
    </View>
  );
}
