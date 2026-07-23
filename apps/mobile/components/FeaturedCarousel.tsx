import { useRef, useState } from "react";
import { View, FlatList, useWindowDimensions, type ViewToken } from "react-native";
import type { EventRow } from "@/lib/events";
import { EventCard } from "./EventCard";

export function FeaturedCarousel({ events, onPressEvent }: { events: EventRow[]; onPressEvent: (event: EventRow) => void }) {
  const { width } = useWindowDimensions();
  const cardWidth = width - 44; // matches the screen's 22px horizontal padding on each side
  const [activeIndex, setActiveIndex] = useState(0);
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index != null) setActiveIndex(first.index);
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  if (events.length === 0) return null;

  return (
    <View testID="featured-carousel" className="mb-2">
      <FlatList
        data={events}
        keyExtractor={(e) => e.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardWidth}
        decelerationRate="fast"
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        renderItem={({ item }) => (
          <View style={{ width: cardWidth }}>
            <EventCard event={item} onPress={() => onPressEvent(item)} />
          </View>
        )}
      />
      {events.length > 1 ? (
        <View className="flex-row justify-center gap-[6px] -mt-1">
          {events.map((e, i) => (
            <View
              key={e.id}
              testID={`featured-dot-${i}`}
              className={i === activeIndex ? "h-[3px] w-4 rounded-full bg-primary" : "h-[6px] w-[6px] rounded-full bg-border"}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
