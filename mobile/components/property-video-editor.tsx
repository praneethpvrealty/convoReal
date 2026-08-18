import { Ionicons } from '@expo/vector-icons';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';

import { AppDialog, useAppDialog } from '@/components/app-dialog';
import { SectionLabel } from '@/components/ui';
import { apiFetch, ApiError } from '@/lib/api';
import {
  attachmentFilename,
  attachmentMimeType,
  ATTACHMENT_SIZE_LIMITS,
} from '@/lib/attachments';
import { haptic } from '@/lib/haptics';
import { queryClient } from '@/lib/query';
import { storagePublicUrl } from '@/lib/storage-url';
import { radius, spacing, useTheme } from '@/lib/theme';
import type { Property } from '@/lib/types';

type VideoState = Pick<
  Property,
  | 'video_url'
  | 'video_status'
  | 'video_generated_at'
  | 'youtube_video_id'
  | 'youtube_status'
  | 'youtube_error'
>;

export function PropertyVideoEditor({
  propertyId,
  initialState,
}: {
  propertyId: string;
  initialState: VideoState;
}) {
  const { colors, fonts: f } = useTheme();
  const { show, dialogProps } = useAppDialog();
  const [state, setState] = useState(initialState);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);

  const ready = state.video_status === 'ready' && Boolean(state.video_url);
  const generated = ready && Boolean(state.video_generated_at);
  const processing =
    state.video_status === 'queued' || state.video_status === 'processing';
  const youtubeBusy =
    state.youtube_status === 'queued' || state.youtube_status === 'uploading';

  async function upload() {
    if (busy || processing || youtubeBusy) return;
    let ImagePicker: typeof import('expo-image-picker');
    try {
      ImagePicker = await import('expo-image-picker');
    } catch {
      show({
        title: 'Update the app',
        message:
          'Video uploads need the latest ConvoReal build. Install the newest version, then try again.',
      });
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      show({
        title: 'Permission needed',
        message: 'Allow video access to add a walkthrough.',
      });
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      quality: 1,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const mimeType = attachmentMimeType(
      asset.mimeType,
      asset.fileName ?? asset.uri
    );
    if (mimeType !== 'video/mp4') {
      show({
        title: 'MP4 required',
        message: 'Only MP4 walkthrough videos are supported.',
      });
      return;
    }
    if (asset.fileSize && asset.fileSize > ATTACHMENT_SIZE_LIMITS.video) {
      show({ title: 'Video too large', message: 'Maximum size is 16 MB.' });
      return;
    }

    const form = new FormData();
    form.append('file', {
      uri: asset.uri,
      name: attachmentFilename(asset.fileName, asset.uri, mimeType),
      type: mimeType,
    } as unknown as Blob);

    setBusy('upload');
    haptic.tap();
    try {
      const response = await apiFetch<{ data: VideoState }>(
        `/api/properties/${propertyId}/video-upload`,
        { method: 'POST', body: form }
      );
      setState(response.data);
      queryClient.invalidateQueries({ queryKey: ['property', propertyId] });
      queryClient.invalidateQueries({
        queryKey: ['property-edit', propertyId],
      });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      haptic.success();
      show({
        title: 'Walkthrough uploaded',
        message:
          response.data.youtube_status === 'queued'
            ? 'The property is updated and its YouTube upload is queued.'
            : 'The video is now attached to this property.',
      });
    } catch (error) {
      haptic.warn();
      show({
        title: 'Upload failed',
        message:
          error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!ready || busy) return;
    setBusy('remove');
    haptic.tap();
    try {
      await apiFetch(`/api/properties/${propertyId}/generate-video`, {
        method: 'DELETE',
      });
      setState((current) => ({
        ...current,
        video_url: null,
        video_status: null,
        video_generated_at: null,
      }));
      queryClient.invalidateQueries({ queryKey: ['property', propertyId] });
      queryClient.invalidateQueries({
        queryKey: ['property-edit', propertyId],
      });
      queryClient.invalidateQueries({ queryKey: ['properties'] });
      haptic.success();
    } catch (error) {
      haptic.warn();
      show({
        title: 'Could not remove video',
        message:
          error instanceof ApiError ? error.message : 'Please try again.',
      });
    } finally {
      setBusy(null);
    }
  }

  async function openVideo() {
    const url =
      state.youtube_status === 'ready' && state.youtube_video_id
        ? `https://youtu.be/${state.youtube_video_id}`
        : storagePublicUrl(state.video_url ?? '');
    if (url) await Linking.openURL(url);
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <SectionLabel text="Video" />
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
          <Ionicons
            name={processing ? 'hourglass-outline' : 'videocam-outline'}
            size={22}
            color={colors.primary}
          />
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text
            style={{ fontSize: 14, fontFamily: f.bold, color: colors.text }}
          >
            {processing
              ? 'Video is being prepared'
              : ready
                ? generated
                  ? 'Generated listing video'
                  : 'Walkthrough video'
                : 'No walkthrough video'}
          </Text>
          <Text style={{ fontSize: 11.5, color: colors.textMuted }}>
            {state.youtube_status === 'queued' ||
            state.youtube_status === 'uploading'
              ? 'YouTube upload in progress'
              : state.youtube_status === 'ready'
                ? 'Saved to YouTube and the property showcase'
                : ready
                  ? 'Shown in the property showcase'
                  : 'Upload one MP4 up to 16 MB'}
          </Text>
        </View>
        {ready ? (
          <Pressable
            onPress={() => void openVideo()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Play property video"
          >
            <Ionicons
              name="play-circle-outline"
              size={24}
              color={colors.primary}
            />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.actions}>
        <Pressable
          onPress={() => void upload()}
          disabled={Boolean(busy) || processing || youtubeBusy}
          accessibilityRole="button"
          accessibilityLabel={
            ready ? 'Replace walkthrough video' : 'Upload walkthrough video'
          }
        >
          <Text
            style={{
              fontSize: 12.5,
              fontFamily: f.bold,
              color: colors.primary,
            }}
          >
            {busy === 'upload'
              ? 'Uploading…'
              : ready
                ? 'Replace video'
                : 'Upload video'}
          </Text>
        </Pressable>
        {ready ? (
          <Pressable
            onPress={() => void remove()}
            disabled={Boolean(busy) || youtubeBusy}
            accessibilityRole="button"
            accessibilityLabel="Remove walkthrough video"
          >
            <Text
              style={{
                fontSize: 12.5,
                fontFamily: f.bold,
                color: colors.danger,
              }}
            >
              {busy === 'remove' ? 'Removing…' : 'Remove'}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <AppDialog {...dialogProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  icon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.lg,
    paddingHorizontal: spacing.xs,
  },
});
