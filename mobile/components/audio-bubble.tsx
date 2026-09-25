import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { formatDuration } from '@/lib/attachments';
import { haptic } from '@/lib/haptics';
import { mediaSource } from '@/lib/media-source';
import { useTheme } from '@/lib/theme';
import { mediaFileMissing, useMediaFile } from '@/lib/use-media-file';

/**
 * A playable voice note or audio clip.
 *
 * Inbound audio came through the thread as an icon and the word "audio",
 * which is not something an agent can act on — the whole point of a
 * voice note is that it is faster than reading. Playback uses the same
 * source resolver the rest of the thread uses, so an inbound clip is
 * downloaded through the auth-gated Meta proxy and an outbound one
 * streams straight off public storage.
 */
export function AudioBubble({
  mediaUrl,
  outgoing,
}: {
  mediaUrl: string;
  outgoing: boolean;
}) {
  const { colors, fonts: f } = useTheme();
  const resolved = useMemo(() => mediaSource(mediaUrl), [mediaUrl]);
  const proxied = useMediaFile(
    resolved?.kind === 'proxy' ? resolved.path : null
  );

  const source = !resolved
    ? null
    : resolved.kind === 'public'
      ? { uri: resolved.uri }
      : proxied.data
        ? { uri: proxied.data }
        : null;
  const failed = !resolved || proxied.isError;

  const ensurePlayable = () => {
    if (!proxied.data || !mediaFileMissing(proxied.data)) return true;
    void proxied.refetch();
    return false;
  };

  const meta = outgoing ? colors.outgoingMeta : colors.textMuted;
  const accent = outgoing ? colors.outgoingText : colors.primary;

  if (failed) {
    return (
      <View style={styles.row}>
        <Ionicons name="alert-circle-outline" size={18} color={meta} />
        <Text style={{ fontSize: 12.5, color: meta }}>Audio unavailable</Text>
      </View>
    );
  }

  if (!source) {
    return (
      <View style={styles.row}>
        <ActivityIndicator size="small" color={meta} />
        <Text style={{ fontSize: 12.5, color: meta }}>Loading…</Text>
      </View>
    );
  }

  return (
    <AudioPlayerRow
      key={proxied.dataUpdatedAt}
      source={source}
      accent={accent}
      meta={meta}
      bold={f.semibold}
      ensurePlayable={ensurePlayable}
    />
  );
}

/** Split out so the player hook is only mounted once there is a real
 *  source — expo-audio has no notion of "not yet". */
function AudioPlayerRow({
  source,
  accent,
  meta,
  bold,
  ensurePlayable,
}: {
  source: { uri: string };
  accent: string;
  meta: string;
  bold: string;
  ensurePlayable: () => boolean;
}) {
  const player = useAudioPlayer(source);
  const status = useAudioPlayerStatus(player);

  const playing = status.playing;
  const durationMs = (status.duration ?? 0) * 1000;
  const positionMs = (status.currentTime ?? 0) * 1000;
  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;

  function toggle() {
    haptic.tap();
    if (playing) {
      player.pause();
      return;
    }
    if (!ensurePlayable()) return;
    // A clip played to the end stays parked there; without the rewind
    // the second tap plays nothing.
    if (
      status.didJustFinish ||
      (durationMs > 0 && positionMs >= durationMs - 150)
    ) {
      player.seekTo(0);
    }
    player.play();
  }

  return (
    <Pressable
      onPress={toggle}
      style={styles.row}
      accessibilityRole="button"
      accessibilityLabel={playing ? 'Pause voice note' : 'Play voice note'}
    >
      <Ionicons
        name={playing ? 'pause-circle' : 'play-circle'}
        size={30}
        color={accent}
      />
      <View style={{ flex: 1, gap: 5 }}>
        <View style={[styles.track, { backgroundColor: meta }]}>
          <View
            style={[
              styles.fill,
              {
                backgroundColor: accent,
                width: `${Math.round(progress * 100)}%`,
              },
            ]}
          />
        </View>
        <Text style={{ fontSize: 10.5, fontFamily: bold, color: meta }}>
          {formatDuration(positionMs > 0 ? positionMs : durationMs)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 190,
    paddingVertical: 2,
  },
  track: {
    height: 3,
    borderRadius: 2,
    opacity: 0.45,
    overflow: 'hidden',
  },
  fill: {
    height: 3,
    borderRadius: 2,
  },
});
