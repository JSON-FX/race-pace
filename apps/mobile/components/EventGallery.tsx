import { useState } from "react";
import { View, Text, Image, ScrollView, Pressable, Modal, FlatList, useWindowDimensions } from "react-native";
import type { NativeSyntheticEvent, NativeScrollEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import { ElevationHero } from "./ElevationHero";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/** Horizontal paging carousel of an event's images with a dots indicator.
 *  Tapping a slide opens a full-screen viewer (swipeable carousel) at that image.
 *  Falls back to the ElevationHero placeholder when there are no images. */
export function EventGallery({ images, height }: { images: (string | null | undefined)[]; height: number }) {
  const urls = Array.from(new Set(images.filter((u): u is string => !!u)));
  const { width, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [idx, setIdx] = useState(0);
  const [errored, setErrored] = useState<Record<string, boolean>>({});
  // Index of the image open in the full-screen viewer, or null when closed.
  const [viewer, setViewer] = useState<number | null>(null);

  if (urls.length === 0) return <ElevationHero height={height} />;

  const pageOf = (e: NativeSyntheticEvent<NativeScrollEvent>) =>
    width > 0 ? Math.round(e.nativeEvent.contentOffset.x / width) : 0;

  return (
    <View style={{ height }}>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={(e) => setIdx(pageOf(e))} scrollEventThrottle={16}>
        {urls.map((uri, i) => (
          errored[uri] ? (
            <View key={uri} style={{ width, height }}><ElevationHero height={height} /></View>
          ) : (
            <Pressable key={uri} onPress={() => setViewer(i)} accessibilityRole="button" accessibilityLabel="View image">
              <Image testID="gallery-image" source={{ uri }} style={{ width, height }} resizeMode="cover" onError={() => setErrored((e) => ({ ...e, [uri]: true }))} />
            </Pressable>
          )
        ))}
      </ScrollView>
      {urls.length > 1 ? (
        <View className="absolute bottom-3 left-0 right-0 flex-row justify-center gap-1.5" pointerEvents="none">
          {urls.map((uri, i) => (
            <View key={uri} className={cn("h-[7px] w-[7px] rounded-[4px]", i === idx ? "bg-primary" : "bg-muted")} />
          ))}
        </View>
      ) : null}

      {viewer !== null ? (
        <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => setViewer(null)}>
          <View testID="gallery-viewer" style={{ flex: 1, backgroundColor: "#000" }}>
            <FlatList
              data={urls}
              keyExtractor={(uri) => uri}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              initialScrollIndex={viewer}
              getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
              onMomentumScrollEnd={(e) => setViewer(pageOf(e))}
              renderItem={({ item }) => (
                <Image source={{ uri: item }} style={{ width, height: winH }} resizeMode="contain" />
              )}
            />
            <Pressable
              onPress={() => setViewer(null)}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={{ position: "absolute", top: insets.top + 8, right: 16, height: 40, width: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.5)" }}
            >
              <Icon as={X} size={22} className="text-white" />
            </Pressable>
            {urls.length > 1 ? (
              <View style={{ position: "absolute", bottom: insets.bottom + 20, left: 0, right: 0, alignItems: "center" }} pointerEvents="none">
                <View style={{ borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: "rgba(0,0,0,0.5)" }}>
                  <Text style={{ color: "#fff", fontSize: 13, fontWeight: "500" }}>{viewer + 1} / {urls.length}</Text>
                </View>
              </View>
            ) : null}
          </View>
        </Modal>
      ) : null}
    </View>
  );
}
