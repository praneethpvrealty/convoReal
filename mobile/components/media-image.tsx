import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Image, Text, View } from 'react-native';

import { authHeaders } from '@/lib/api';
import { mediaSource } from '@/lib/media-source';
import { radius, useTheme } from '@/lib/theme';

export function MediaImage({ mediaUrl }: { mediaUrl: string }) {
  const { colors } = useTheme();
  const resolved = useMemo(() => mediaSource(mediaUrl), [mediaUrl]);
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!resolved || resolved.kind !== 'proxy') return;
    let cancelled = false;
    authHeaders()
      .then((next) => {
        if (!cancelled) setHeaders(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [resolved]);

  if (!resolved || failed) {
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

  if (resolved.kind === 'proxy' && !headers) {
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
      source={
        resolved.kind === 'public'
          ? { uri: resolved.uri }
          : { uri: resolved.uri, headers: headers ?? undefined }
      }
      style={{ width: 210, height: 210, borderRadius: radius.md }}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}
