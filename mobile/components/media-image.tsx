import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';

import { absoluteMediaUrl, authHeaders } from '@/lib/api';
import { radius, useTheme } from '@/lib/theme';

/**
 * Renders a WhatsApp image through the auth-gated media proxy
 * (`/api/whatsapp/media/{id}` — see the implementation plan's media
 * section). Headers are resolved async (bearer token), and expired
 * Meta media (404 MEDIA_UNAVAILABLE) degrades to a placeholder.
 */
export function MediaImage({ relativeUrl }: { relativeUrl: string }) {
  const { colors } = useTheme();
  const [headers, setHeaders] = useState<Record<string, string> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authHeaders().then((h) => {
      if (!cancelled) setHeaders(h);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
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

  if (!headers) {
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
      source={{ uri: absoluteMediaUrl(relativeUrl), headers }}
      style={{ width: 210, height: 210, borderRadius: radius.md }}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}
