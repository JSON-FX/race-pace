import { useState } from "react";
import { View, Image, ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import type { NativeSyntheticEvent, NativeScrollEvent } from "react-native";
import { ElevationHero } from "./ElevationHero";

/** Horizontal paging carousel of an event's images with a dots indicator.
 *  Falls back to the ElevationHero placeholder when there are no images. */
export function EventGallery({ images, height }: { images: (string | null | undefined)[]; height: number }) {
  const urls = Array.from(new Set(images.filter((u): u is string => !!u)));
  const { width } = useWindowDimensions();
  const [idx, setIdx] = useState(0);

  if (urls.length === 0) return <ElevationHero height={height} />;

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIdx(width > 0 ? Math.round(e.nativeEvent.contentOffset.x / width) : 0);
  };

  return (
    <View style={{ height }}>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={onScroll} scrollEventThrottle={16}>
        {urls.map((uri) => (
          <Image key={uri} testID="gallery-image" source={{ uri }} style={{ width, height }} resizeMode="cover" />
        ))}
      </ScrollView>
      {urls.length > 1 ? (
        <View style={styles.dots} pointerEvents="none">
          {urls.map((uri, i) => (
            <View key={uri} style={[styles.dot, i === idx ? styles.dotOn : styles.dotOff]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  dots: { position: "absolute", bottom: 12, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dotOn: { backgroundColor: "#fff" },
  dotOff: { backgroundColor: "rgba(255,255,255,0.5)" },
});
