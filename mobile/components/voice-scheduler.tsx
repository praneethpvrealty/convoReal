import { Ionicons } from '@expo/vector-icons';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError, apiFetch } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { radius, spacing, useTheme } from '@/lib/theme';
import {
  formatRecordingDuration,
  prefillFromParse,
  type ParsedEventResponse,
  type VoicePrefill,
} from '@/lib/voice-event';

interface VoiceSchedulerProps {
  onParsed: (prefill: VoicePrefill) => void;
  onInfo: (message: string) => void;
  onError: (message: string) => void;
}

/**
 * Mobile counterpart of the web calendar's SmartAddBar voice path
 * (src/components/calendar/smart-add-bar.tsx): hold a conversation-free
 * flow — tap, speak the whole appointment in any language, tap to
 * finish — and the same /api/ai/parse-event endpoint fills the form.
 */
export function VoiceScheduler({ onParsed, onInfo, onError }: VoiceSchedulerProps) {
  const { colors, fonts: f } = useTheme();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 500);
  const [phase, setPhase] = useState<'idle' | 'recording' | 'parsing'>('idle');

  async function start() {
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (!granted) {
        onError('Microphone access is needed to speak an appointment — enable it in Settings.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      haptic.tap();
      setPhase('recording');
    } catch {
      onError("Couldn't start the microphone — it may be in use by another app.");
    }
  }

  async function stopAndParse() {
    setPhase('parsing');
    haptic.send();
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri;
      if (!uri) throw new Error('Recording unavailable');
      const base64 = await new File(uri).base64();
      if (base64.length < 2000) {
        onInfo('That was too short — speak the full appointment: what, who, and when.');
        return;
      }
      const { data } = await apiFetch<{ data: ParsedEventResponse }>('/api/ai/parse-event', {
        method: 'POST',
        body: JSON.stringify({ audio: { base64, mimeType: 'audio/mp4' } }),
      });
      const prefill = prefillFromParse(data);
      if (!prefill) {
        onInfo("Couldn't find an appointment in that. Try including what, who, and when.");
        return;
      }
      haptic.success();
      onParsed(prefill);
    } catch (err) {
      haptic.warn();
      if (err instanceof ApiError && err.status === 402) {
        onError("You're out of AI credits — top up from the web app to keep using voice.");
      } else {
        onError(err instanceof Error ? err.message : 'Could not understand that. Please try again.');
      }
    } finally {
      setPhase('idle');
    }
  }

  if (phase === 'parsing') {
    return (
      <View style={[styles.bar, { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={[styles.label, { fontFamily: f.semibold, color: colors.primary }]}>
          Understanding…
        </Text>
      </View>
    );
  }

  if (phase === 'recording') {
    return (
      <Pressable
        onPress={stopAndParse}
        accessibilityRole="button"
        accessibilityLabel="Stop recording and understand the appointment"
        style={[styles.bar, { backgroundColor: colors.dangerSoft, borderColor: colors.danger }]}
      >
        <View style={[styles.recordDot, { backgroundColor: colors.danger }]} />
        <Text style={[styles.label, { flex: 1, fontFamily: f.semibold, color: colors.danger }]}>
          Listening… {formatRecordingDuration(recorderState.durationMillis)} — tap to finish
        </Text>
        <Ionicons name="stop-circle" size={22} color={colors.danger} />
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={start}
      accessibilityRole="button"
      accessibilityLabel="Speak the appointment"
      style={[styles.bar, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={[styles.micBadge, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name="mic-outline" size={18} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, { fontFamily: f.semibold, color: colors.text }]}>
          Speak the appointment
        </Text>
        <Text style={{ fontSize: 12, color: colors.textFaint }} numberOfLines={1}>
          “Site visit with Varun tomorrow 4pm at JP Nagar”
        </Text>
      </View>
      <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    minHeight: 54,
  },
  micBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 14 },
  recordDot: { width: 10, height: 10, borderRadius: 5 },
});
