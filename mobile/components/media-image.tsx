import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Image, Text, View } from 'react-native';

import { mediaSource } from '@/lib/media-source';
import { radius, useTheme } from '@/lib/theme';
import { discardCachedMedia, useMediaFile } from '@/lib/use-media-file';

export function MediaImage({ mediaUrl }: { mediaUrl: string }) {
  const { colors } = useTheme();
  const resolved = useMemo(() => mediaSource(mediaUrl), [mediaUrl]);
  const proxied = useMediaFile(
    resolved?.kind === 'proxy' ? resolved.path : null
  );
  const [failed, setFailed] = useState(false);
  const [redownloaded, setRedownloaded] = useState(false);

  const onImageError = () => {
    if (resolved?.kind !== 'proxy' || redownloaded) {
      setFailed(true);
      return;
    }
    setRedownloaded(true);
    discardCachedMedia(resolved.path);
    void proxied.refetch();
  };

  const uri =
    resolved?.kind === 'public'
      ? resolved.uri
      : resolved?.kind === 'proxy'
        ? proxied.data
        : undefined;

  if (!resolved || failed || proxied.isError) {
    return (
      <View
        style={{
          width: 210,
          height: 130,
          borderRadius: radius.md,
          backgroundColor: colors.surface,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        <Ionicons name="image-outline" size={26} color={colors.textFaint} />
        <Text style={{ fontSize: 11.5, color: colors.textFaint }}>
          Media no longer available
        </Text>
      </View>
    );
  }

  if (!uri) {
    return (
      <View
        style={{
          width: 210,
          height: 210,
          borderRadius: radius.md,
          backgroundColor: colors.surface,
        }}
      />
    );
  }

  return (
    <Image
      key={proxied.dataUpdatedAt}
      source={{ uri }}
      style={{ width: 210, height: 210, borderRadius: radius.md }}
      resizeMode="cover"
      onError={onImageError}
    />
  );
}
