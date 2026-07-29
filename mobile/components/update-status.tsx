import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, spacing, useTheme } from '@/lib/theme';

/**
 * What over-the-air update this install is actually running.
 *
 * Without this, confirming a published update landed means relaunching
 * the app twice and guessing from whether the change appears. The two
 * things that silently stop an update — a build on a different channel,
 * or a runtime version that no longer matches after a native change —
 * are both invisible from inside the app otherwise, so both are printed
 * here verbatim to compare against `eas update:list`.
 *
 * The button is deliberately manual: the app's default check is
 * ON_LOAD, which downloads in the background and applies on the NEXT
 * launch. This lets you do all three steps — check, download, restart —
 * without leaving the screen.
 */
export function UpdateStatus() {
  const { colors, fonts: f } = useTheme();
  const {
    currentlyRunning,
    availableUpdate,
    isUpdateAvailable,
    isUpdatePending,
    isChecking,
    isDownloading,
    isRestarting,
    downloadProgress,
    lastCheckForUpdateTimeSinceRestart,
    checkError,
    downloadError,
  } = Updates.useUpdates();
  const [manualError, setManualError] = useState<string | null>(null);

  const busy = isChecking || isDownloading || isRestarting;

  async function onPress() {
    setManualError(null);
    try {
      if (isUpdatePending) {
        await Updates.reloadAsync();
        return;
      }
      if (isUpdateAvailable) {
        await Updates.fetchUpdateAsync();
        return;
      }
      await Updates.checkForUpdateAsync();
    } catch (err) {
      setManualError(err instanceof Error ? err.message : String(err));
    }
  }

  // Dev clients and Expo Go run the bundle from Metro — there is no
  // update channel to report, and every action below would throw.
  if (!Updates.isEnabled) {
    return (
      <View style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
        <Row label="App updates" value="Off in this build" colors={colors} f={f} />
        <Text style={[styles.hint, { color: colors.textFaint }]}>
          Over-the-air updates are disabled in development builds. Install a preview or
          production build to test them.
        </Text>
      </View>
    );
  }

  const running = currentlyRunning.isEmbeddedLaunch
    ? 'Bundle shipped with the build'
    : `${shortId(currentlyRunning.updateId)}${published(currentlyRunning.createdAt)}`;

  const status = isUpdatePending
    ? 'Downloaded — restart to apply'
    : isDownloading
      ? `Downloading…${downloadProgress ? ` ${Math.round(downloadProgress * 100)}%` : ''}`
      : isChecking
        ? 'Checking…'
        : isUpdateAvailable
          ? `Update available${availableUpdate ? ` · ${shortId(availableUpdate.updateId)}` : ''}`
          : 'Up to date';

  const actionLabel = isUpdatePending
    ? 'Restart now'
    : isUpdateAvailable
      ? 'Download'
      : 'Check for update';

  const error = manualError || checkError?.message || downloadError?.message || null;

  return (
    <View style={[styles.card, { backgroundColor: colors.glass, borderColor: colors.glassBorder }]}>
      <Row label="Running" value={running} colors={colors} f={f} />
      <Row label="Channel" value={currentlyRunning.channel || '—'} colors={colors} f={f} />
      <Row
        label="Runtime"
        value={shortId(currentlyRunning.runtimeVersion)}
        colors={colors}
        f={f}
      />
      <Row
        label="Status"
        value={status}
        colors={colors}
        f={f}
        tint={isUpdatePending || isUpdateAvailable ? colors.success : undefined}
      />
      {lastCheckForUpdateTimeSinceRestart && (
        <Row
          label="Last checked"
          value={lastCheckForUpdateTimeSinceRestart.toLocaleTimeString()}
          colors={colors}
          f={f}
        />
      )}

      {currentlyRunning.isEmergencyLaunch && (
        <Text style={[styles.hint, { color: colors.danger }]}>
          Emergency launch: a downloaded update failed to start, so the build&apos;s own bundle
          is running instead.
          {currentlyRunning.emergencyLaunchReason
            ? ` ${currentlyRunning.emergencyLaunchReason}`
            : ''}
        </Text>
      )}

      {error && (
        <Text style={[styles.hint, { color: colors.danger }]} numberOfLines={3}>
          {error}
        </Text>
      )}

      <Pressable
        disabled={busy}
        onPress={onPress}
        style={({ pressed }) => [
          styles.action,
          { borderTopColor: colors.border, opacity: pressed || busy ? 0.6 : 1 },
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Ionicons
            name={isUpdatePending ? 'refresh-outline' : 'cloud-download-outline'}
            size={17}
            color={colors.primary}
          />
        )}
        <Text style={{ color: colors.primary, fontSize: 14.5, fontFamily: f.bold }}>
          {actionLabel}
        </Text>
      </Pressable>
    </View>
  );
}

/** When the running update was published — the fastest way to tell a
 *  fresh update from a stale one. */
function published(createdAt: Date | undefined): string {
  return createdAt ? ` · ${createdAt.toLocaleDateString()}` : '';
}

/** Update and runtime ids are long; the head is enough to match a
 *  dashboard entry by eye. */
function shortId(value: string | null | undefined): string {
  if (!value) return '—';
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

function Row({
  label,
  value,
  colors,
  f,
  tint,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useTheme>['colors'];
  f: ReturnType<typeof useTheme>['fonts'];
  tint?: string;
}) {
  return (
    <View style={[styles.row, { borderTopColor: colors.border }]}>
      <Text style={{ flex: 1, fontSize: 14.5, color: colors.textMuted }}>{label}</Text>
      <Text
        style={{
          fontSize: 13.5,
          fontFamily: f.semibold,
          color: tint || colors.text,
          maxWidth: '62%',
          textAlign: 'right',
        }}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  hint: {
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
