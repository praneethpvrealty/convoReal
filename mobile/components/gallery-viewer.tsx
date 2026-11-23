import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ImageSourcePropType,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fonts, spacing } from '@/lib/theme';

/**
 * Full-screen photo viewer: paged, pinch-to-zoom on iOS (ScrollView
 * zoom props are iOS-only; Android gets full-screen contain), photo
 * counter when there is more than one, and a safe-area close button.
 */
export function GalleryViewer({
  images,
  initialIndex = 0,
  onClose,
}: {
  images: ImageSourcePropType[];
  initialIndex?: number;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(initialIndex);

  return (
    <Modal
      visible
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <FlatList
          data={images}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, i) => ({
            length: width,
            offset: width * i,
            index: i,
          })}
          keyExtractor={(_, i) => String(i)}
          onMomentumScrollEnd={(e) =>
            setIndex(
              Math.round(
                e.nativeEvent.contentOffset.x /
                  Math.max(1, e.nativeEvent.layoutMeasurement.width)
              )
            )
          }
          renderItem={({ item }) => (
            <ScrollView
              style={{ width, height }}
              contentContainerStyle={{ width, height }}
              minimumZoomScale={1}
              maximumZoomScale={4}
              bouncesZoom
            >
              <Image
                source={item}
                style={{ width, height }}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
              />
            </ScrollView>
          )}
        />
        <View style={[styles.topBar, { top: insets.top + spacing.sm }]}>
          {images.length > 1 ? (
            <Text style={styles.counter}>
              {index + 1} / {images.length}
            </Text>
          ) : (
            <View />
          )}
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close gallery"
            style={styles.close}
          >
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  topBar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  counter: {
    color: '#fff',
    fontSize: 14,
    fontFamily: fonts.bold,
    backgroundColor: 'rgba(0,0,0,0.45)',
    overflow: 'hidden',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
